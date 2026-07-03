import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { pool } from '../services/db';
import { evictKeyCache } from '../middleware/auth';
import { hashPassword } from '../services/authService';

const router = Router();

function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

function maskKey(key: string): string {
  return key.slice(0, 8) + '••••••••••••••••••••••••••••••••' + key.slice(-4);
}

// POST /admin/keys
// Body: { client_name, allowed_domain, smtp_host?, smtp_port?, smtp_user?, smtp_pass?, ses_config_set? }
router.post('/keys', async (req: Request, res: Response) => {
  const clientName    = (req.body.client_name    as string | undefined)?.trim();
  const allowedDomain = (req.body.allowed_domain as string | undefined)?.trim().toLowerCase();
  const smtpHost      = (req.body.smtp_host      as string | undefined)?.trim() || null;
  const smtpPort      = req.body.smtp_port ? parseInt(req.body.smtp_port) : null;
  const smtpUser      = (req.body.smtp_user      as string | undefined)?.trim() || null;
  const smtpPass      = (req.body.smtp_pass      as string | undefined)?.trim() || null;
  const sesConfigSet  = (req.body.ses_config_set as string | undefined)?.trim() || null;

  if (!clientName)    { res.status(400).json({ error: '"client_name" is required' }); return; }
  if (!allowedDomain) { res.status(400).json({ error: '"allowed_domain" is required (e.g. "mail.client1.com")' }); return; }

  // If any SMTP field provided, all are required
  if ((smtpHost || smtpUser || smtpPass) && !(smtpHost && smtpUser && smtpPass && sesConfigSet)) {
    res.status(400).json({ error: 'For custom SMTP, all fields required: smtp_host, smtp_port, smtp_user, smtp_pass, ses_config_set' });
    return;
  }

  const key = generateApiKey();
  await pool.query(
    'INSERT INTO api_keys (key, client_name, allowed_domain, smtp_host, smtp_port, smtp_user, smtp_pass, ses_config_set) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [key, clientName, allowedDomain, smtpHost, smtpPort, smtpUser, smtpPass, sesConfigSet]
  );

  res.status(201).json({
    client_name: clientName,
    allowed_domain: allowedDomain,
    smtp: smtpHost ? { host: smtpHost, port: smtpPort, user: smtpUser, config_set: sesConfigSet } : 'shared (default)',
    api_key: key,
    note: 'Save this key now. It will not be shown again.',
  });
});

// GET /admin/keys
router.get('/keys', async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`SELECT id, client_name, allowed_domain, key, is_active, created_at FROM api_keys ORDER BY created_at DESC`);
  res.json({ keys: rows.map(r => ({ id: r.id, client_name: r.client_name, allowed_domain: r.allowed_domain, key: r.key, key_preview: maskKey(r.key), is_active: r.is_active, created_at: r.created_at })) });
});

// PATCH /admin/keys/:id/revoke
router.patch('/keys/:id/revoke', async (req: Request, res: Response) => {
  const { rows } = await pool.query<{ key: string }>(`UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING key`, [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Key not found or already revoked' }); return; }
  evictKeyCache(rows[0].key);
  res.json({ message: 'Key revoked successfully' });
});

// PATCH /admin/keys/:id/activate
router.patch('/keys/:id/activate', async (req: Request, res: Response) => {
  const { rowCount } = await pool.query(`UPDATE api_keys SET is_active = TRUE WHERE id = $1 AND is_active = FALSE`, [req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'Key not found or already active' }); return; }
  res.json({ message: 'Key activated successfully' });
});

// DELETE /admin/keys/:id
router.delete('/keys/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query<{ key: string }>('DELETE FROM api_keys WHERE id = $1 RETURNING key', [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Key not found' }); return; }
  evictKeyCache(rows[0].key);
  res.json({ message: 'Key deleted permanently' });
});

// GET /admin/clients/:id/stats?days=7
router.get('/clients/:id/stats', async (req: Request, res: Response) => {
  const { id } = req.params;
  const days = Math.min(parseInt((req.query.days as string) || '7'), 365);
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const [summary, timeseries] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS sent,
              COUNT(*) FILTER (WHERE delivered=TRUE) AS delivered,
              COUNT(*) FILTER (WHERE bounced=TRUE)   AS bounced,
              COUNT(*) FILTER (WHERE status='failed') AS failed
       FROM email_logs WHERE client_id=$1 AND sent_at>=$2 AND sent_at<=$3`,
      [id, from, to]
    ),
    pool.query(
      `SELECT DATE_TRUNC('day', sent_at AT TIME ZONE 'UTC') AS day,
              COUNT(*) AS sent,
              COUNT(*) FILTER (WHERE delivered=TRUE) AS delivered,
              COUNT(*) FILTER (WHERE bounced=TRUE)   AS bounced,
              COUNT(*) FILTER (WHERE status='failed') AS failed
       FROM email_logs WHERE client_id=$1 AND sent_at>=$2 AND sent_at<=$3
       GROUP BY day ORDER BY day`,
      [id, from, to]
    ),
  ]);

  const s    = summary.rows[0];
  const sent = parseInt(s.sent) || 0;
  const del  = parseInt(s.delivered) || 0;
  const bnc  = parseInt(s.bounced) || 0;
  const fail = parseInt(s.failed) || 0;

  res.json({
    summary: { sent, delivered: del, bounced: bnc, failed: fail,
      delivery_rate: sent > 0 ? Math.round((del/sent)*1000)/10 : 0,
      bounce_rate:   sent > 0 ? Math.round((bnc/sent)*1000)/10 : 0 },
    timeseries: timeseries.rows.map(r => ({
      date: new Date(r.day).toISOString().split('T')[0],
      sent: parseInt(r.sent)||0, delivered: parseInt(r.delivered)||0,
      bounced: parseInt(r.bounced)||0, failed: parseInt(r.failed)||0,
    })),
  });
});

// GET /admin/clients/:id/emails?limit=50&offset=0&from=YYYY-MM-DD&to=YYYY-MM-DD&days=7
router.get('/clients/:id/emails', async (req: Request, res: Response) => {
  const { id }  = req.params;
  const limit   = Math.min(parseInt((req.query.limit  as string) || '50'),  500);
  const offset  = parseInt((req.query.offset as string) || '0');
  const search  = (req.query.search as string | undefined)?.trim();
  const from    = req.query.from as string | undefined;
  const to      = req.query.to   as string | undefined;
  const days    = req.query.days ? parseInt(req.query.days as string) : undefined;

  const params: (string | number | Date)[] = [id];
  const whereClauses: string[] = [];

  if (search) {
    params.push(`%${search}%`);
    whereClauses.push(`(recipient ILIKE $${params.length} OR subject ILIKE $${params.length})`);
  }
  if (from && to) {
    params.push(new Date(from));
    whereClauses.push(`sent_at >= $${params.length}`);
    params.push(new Date(to + 'T23:59:59.999Z'));
    whereClauses.push(`sent_at <= $${params.length}`);
  } else if (days) {
    params.push(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    whereClauses.push(`sent_at >= $${params.length}`);
  }

  const extraWhere = whereClauses.length ? 'AND ' + whereClauses.join(' AND ') : '';

  const { rows } = await pool.query(
    `SELECT id, message_id AS "messageId", recipient, subject,
            sent_at AS "sentAt", status, job_id AS "jobId",
            delivered, opened, bounced, bounce_reason AS "bounceReason"
     FROM email_logs
     WHERE client_id = $1 ${extraWhere}
     ORDER BY sent_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM email_logs WHERE client_id = $1 ${extraWhere}`,
    params.slice(0, params.length)
  );

  res.json({ total: parseInt(countRows[0].count), limit, offset, emails: rows });
});

// ── User management ──────────────────────────────────────────────────────────

// GET /admin/users
router.get('/users', async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.role, u.client_id, u.created_at,
            k.client_name, k.allowed_domain
     FROM users u
     LEFT JOIN api_keys k ON k.id = u.client_id
     ORDER BY u.created_at DESC`
  );
  res.json({ users: rows });
});

// POST /admin/users — create admin or client user
// Body: { username, email?, password, role: 'admin'|'client', client_id?: string }
router.post('/users', async (req: Request, res: Response) => {
  const username  = (req.body.username as string | undefined)?.trim().toLowerCase();
  const email     = (req.body.email as string | undefined)?.trim().toLowerCase() || null;
  const password  = (req.body.password as string | undefined);
  const role      = (req.body.role as string | undefined) || 'client';
  const client_id = (req.body.client_id as string | undefined) || null;

  if (!username || !password) { res.status(400).json({ error: 'username and password are required' }); return; }
  if (!['admin', 'client'].includes(role)) { res.status(400).json({ error: 'role must be "admin" or "client"' }); return; }
  if (role === 'client' && !client_id) { res.status(400).json({ error: 'client_id is required for client role' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'password must be at least 8 characters' }); return; }

  const hash = await hashPassword(password);

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, client_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, client_id, created_at`,
      [username, email, hash, role, client_id]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') { res.status(409).json({ error: 'Username or email already exists' }); return; }
    throw err;
  }
});

// PATCH /admin/users/:id/password — reset a user's password
router.patch('/users/:id/password', async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }

  const hash = await hashPassword(password);
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ message: 'Password updated successfully' });
});

// DELETE /admin/users/:id
router.delete('/users/:id', async (req: Request, res: Response) => {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ message: 'User deleted' });
});

export default router;
