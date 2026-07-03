import { Router, Request, Response, text } from 'express';
import { createVerify } from 'crypto';
import { updateEmailEvent, logEmailFromSMTP } from '../services/emailLog';
import { pool } from '../services/db';
import nodemailer from 'nodemailer';

const router = Router();

// Cache signing certs to avoid re-fetching on every request
const certCache = new Map<string, string>();

async function fetchSigningCert(url: string): Promise<string> {
  // Only allow certs from AWS SNS domains — prevents SSRF
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith('.amazonaws.com')) {
    throw new Error(`Untrusted cert URL: ${url}`);
  }

  if (certCache.has(url)) return certCache.get(url)!;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch SNS cert: ${res.status}`);
  const cert = await res.text();
  certCache.set(url, cert);
  return cert;
}

function buildStringToSign(body: Record<string, string>): string {
  const fields =
    body.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

  return fields
    .filter(f => body[f] !== undefined)
    .map(f => `${f}\n${body[f]}\n`)
    .join('');
}

async function verifySNSSignature(body: Record<string, string>): Promise<boolean> {
  try {
    if (body.SignatureVersion !== '1') return false;

    const cert = await fetchSigningCert(body.SigningCertURL);
    const verifier = createVerify('SHA1');
    verifier.update(buildStringToSign(body));
    return verifier.verify(cert, body.Signature, 'base64');
  } catch (err) {
    console.error('[webhook] signature verification error:', (err as Error).message);
    return false;
  }
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.REPORT_SMTP_USER,
    pass: process.env.REPORT_SMTP_PASS,
  },
});

async function sendBounceAlert(to: string, bounceType: 'Hard' | 'Soft', recipient: string, subject: string, reason: string | undefined, sentAt: string) {
  const color = bounceType === 'Hard' ? '#ef4444' : '#f59e0b';
  const timeIST = new Date(new Date(sentAt).getTime() + 5.5 * 60 * 60 * 1000)
    .toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

  await transporter.sendMail({
    from: `LumosMails Alerts <${process.env.REPORT_SMTP_USER}>`,
    to,
    subject: `${bounceType} Bounce Alert — ${recipient}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <div style="background:${color}15;border-left:4px solid ${color};padding:16px 20px;border-radius:8px;margin-bottom:20px">
          <h2 style="margin:0 0 4px;color:${color};font-size:16px">${bounceType} Bounce Detected</h2>
          <p style="margin:0;color:#666;font-size:13px">This email could not be delivered.</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888;width:140px">Recipient</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:500">${recipient}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Subject</td><td style="padding:10px 0;border-bottom:1px solid #eee">${subject || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Bounce Type</td><td style="padding:10px 0;border-bottom:1px solid #eee"><span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${bounceType}</span></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Reason</td><td style="padding:10px 0;border-bottom:1px solid #eee;color:#ef4444;font-size:13px">${reason || 'No reason provided'}</td></tr>
          <tr><td style="padding:10px 0;color:#888">Time (IST)</td><td style="padding:10px 0">${timeIST}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#aaa">Sent by LumosMails · lumosmails.lumoslogic.com</p>
      </div>
    `,
  });
}

// SNS sends Content-Type: text/plain
router.use('/ses', text({ type: '*/*' }));

// POST /api/webhooks/ses
router.post('/ses', async (req: Request, res: Response) => {
  try {
    const body: Record<string, string> =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Verify SNS signature before trusting the payload
    const valid = await verifySNSSignature(body);
    if (!valid) {
      console.warn('[webhook] SNS signature verification failed — request rejected');
      res.status(403).send('Forbidden');
      return;
    }

    // Auto-confirm SNS subscription
    if (body.Type === 'SubscriptionConfirmation') {
      console.log('[webhook] SNS subscription confirmation, confirming...');
      await fetch(body.SubscribeURL);
      res.status(200).send('OK');
      return;
    }

    if (body.Type !== 'Notification') {
      res.status(200).send('OK');
      return;
    }

    const message = JSON.parse(body.Message);
    const eventType: string = message.eventType || message.notificationType;
    const mail = message.mail;

    if (!mail?.messageId) {
      res.status(200).send('OK');
      return;
    }

    console.log(`[webhook] SES event: ${eventType} for messageId: ${mail.messageId}`);

    if (eventType === 'Send') {
      const configSet = mail.tags?.['ses:configuration-set']?.[0];
      if (configSet) {
        const recipients: string[] = mail.destination ?? [];
        const subject: string = mail.commonHeaders?.subject ?? '(no subject)';
        await Promise.all(
          recipients.map(recipient =>
            logEmailFromSMTP({
              messageId: mail.messageId,
              recipient,
              subject,
              sentAt: mail.timestamp ?? new Date().toISOString(),
              configSet,
            })
          )
        );
      }
    } else if (eventType === 'Delivery') {
      await updateEmailEvent(mail.messageId, 'delivered');
    } else if (eventType === 'Open') {
      await updateEmailEvent(mail.messageId, 'opened');
    } else if (eventType === 'Bounce') {
      const bounceData = message.bounce;
      const bounceType: string = bounceData?.bounceType ?? 'Undetermined'; // Permanent | Transient | Undetermined
      const diagnosticCode: string | undefined = bounceData?.bouncedRecipients?.[0]?.diagnosticCode || bounceData?.errorMessage;
      await updateEmailEvent(mail.messageId, 'bounced', diagnosticCode, bounceType);

      // Send bounce alert notifications if configured
      try {
        const isHard = bounceType === 'Permanent';
        const isSoft = bounceType === 'Transient';
        const bounceLabel: 'Hard' | 'Soft' = isHard ? 'Hard' : 'Soft';

        // Fetch client notify emails via message_id → client_id → api_keys
        const { rows } = await pool.query(
          `SELECT ak.notify_hard_bounce_email, ak.notify_soft_bounce_email, el.recipient, el.subject, el.sent_at
           FROM email_logs el
           JOIN api_keys ak ON ak.id = el.client_id
           WHERE el.message_id = $1
           LIMIT 1`,
          [mail.messageId]
        );

        if (rows.length > 0) {
          const { notify_hard_bounce_email, notify_soft_bounce_email, recipient, subject, sent_at } = rows[0];
          const alertTarget = isHard ? notify_hard_bounce_email : isSoft ? notify_soft_bounce_email : null;
          if (alertTarget) {
            await sendBounceAlert(alertTarget, bounceLabel, recipient, subject, diagnosticCode, sent_at);
          }
        }
      } catch (alertErr) {
        console.error('[webhook] bounce alert error:', (alertErr as Error).message);
      }
    } else if (eventType === 'Complaint') {
      // log only — no suppression
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[webhook] error:', err);
    res.status(200).send('OK'); // Always 200 to SNS so it doesn't retry
  }
});

export default router;
