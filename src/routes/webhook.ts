import { Router, Request, Response, text } from 'express';
import { createVerify } from 'crypto';
import { updateEmailEvent, logEmailFromSMTP } from '../services/emailLog';

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
      await updateEmailEvent(mail.messageId, 'bounced');
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
