import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sendEmail } from '../services/mailer';
import { logEmail } from '../services/emailLog';
import { config } from '../config';
import { pool } from '../services/db';
import { istMidnight, istDateStart, istDateEnd } from '../utils/time';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max CSV
});

const singleEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  isHtml: z.boolean().optional().default(true),
});


// POST /api/send-email
// Sends immediately — best for single or small batches (< 50 emails)
router.post('/send-email', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = singleEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { to, subject, body, from, replyTo, isHtml } = parsed.data;
  const recipients = Array.isArray(to) ? to : [to];
  const sender = from || config.ses.defaultFrom;

  const results = await Promise.allSettled(
    recipients.map(email => sendEmail({ to: email, from: sender, subject, body, isHtml, replyTo, smtpConfig: req.smtpConfig }))
  );

  const report = results.map((r, i) => ({
    email: recipients[i],
    status: r.status === 'fulfilled' ? 'sent' : 'failed',
    ...(r.status === 'rejected' && { error: (r.reason as Error).message }),
  }));

  const sentCount = report.filter(r => r.status === 'sent').length;
  res.status(sentCount === 0 ? 500 : 200).json({
    sent: sentCount,
    failed: report.length - sentCount,
    results: report,
  });
});

// POST /api/send-with-attachment
// Send a single email with one file attachment (multipart/form-data)
router.post('/send-with-attachment', upload.single('attachment'), async (req: Request, res: Response, next: NextFunction) => {
  const { to, subject, body, from, replyTo, isHtml } = req.body;

  if (!to || !subject || !body) {
    res.status(400).json({ error: '"to", "subject", and "body" are required' });
    return;
  }

  try {
    const attachments = req.file ? [{
      filename: req.file.originalname,
      content: req.file.buffer,
      contentType: req.file.mimetype,
    }] : undefined;

    const messageId = await sendEmail({
      to,
      from: from || config.ses.defaultFrom,
      subject,
      body,
      isHtml: isHtml !== 'false',
      replyTo,
      attachments,
      smtpConfig: req.smtpConfig,
    });

    await logEmail({
      id: randomUUID(),
      messageId,
      recipient: to,
      subject,
      sentAt: new Date().toISOString(),
      status: 'sent',
      jobId: 'direct',
    });

    res.json({ status: 'sent', messageId, attachment: req.file?.originalname ?? null });
  } catch (err) {
    next(err);
  }
});

// GET /api/logs?page=1&limit=50&status=sent&from=2026-07-01&to=2026-07-03
router.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(parseInt((req.query.page  as string) || '1'), 1);
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 10000);
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const params: (string | number | Date)[] = [req.clientId];
    const conditions: string[] = ['client_id = $1'];

    if (req.query.from) {
      params.push(new Date(req.query.from as string));
      conditions.push(`sent_at >= $${params.length}`);
    }
    if (req.query.to) {
      const to = new Date(req.query.to as string);
      to.setHours(23, 59, 59, 999);
      params.push(to);
      conditions.push(`sent_at <= $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, message_id AS "messageId", recipient, subject,
                sent_at AS "sentAt", status,
                delivered, opened, bounced, bounce_reason AS "bounceReason", bounce_type AS "bounceType"
         FROM email_logs
         WHERE ${where}
         ORDER BY sent_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM email_logs WHERE ${where}`, params),
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      logs: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/recent-emails?limit=100&days=7
// GET /api/recent-emails?from=2026-06-01&to=2026-06-18
router.get('/recent-emails', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam === 'all' ? undefined : Math.min(parseInt(limitParam || '100'), 100000);
    const { getRecentEmails } = await import('../services/emailLog');

    let from: Date | undefined;
    let to: Date | undefined;

    if (req.query.from && req.query.to) {
      let fromStr = req.query.from as string;
      let toStr   = req.query.to as string;
      if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr]; // never let start be after end
      from = istDateStart(fromStr);
      to   = istDateEnd(toStr);
    } else if (req.query.days) {
      const days = parseInt(req.query.days as string);
      from = istMidnight(days - 1); // days=1 ("Today") → today's IST midnight
      to = new Date();
    }

    const emails = await getRecentEmails(req.clientId, limit, from, to);
    res.json({ emails });
  } catch (err) {
    next(err);
  }
});

export default router;
