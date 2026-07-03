import { Router, Request, Response } from 'express';
import { pool } from '../services/db';

const router = Router();

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function validateOptionalEmail(val: unknown): boolean {
  if (val === '' || val === null || val === undefined) return true;
  return typeof val === 'string' && EMAIL_REGEX.test(val);
}

function resolveClientId(req: Request, res: Response): string | null {
  if (req.user?.role === 'admin') {
    const clientId = req.query.clientId as string | undefined;
    if (!clientId) { res.status(400).json({ error: 'clientId query param required for admin' }); return null; }
    return clientId;
  }
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return null; }
  return clientId;
}

// GET /client/settings
router.get('/settings', async (req: Request, res: Response) => {
  const clientId = resolveClientId(req, res);
  if (!clientId) return;

  const { rows } = await pool.query(
    'SELECT report_email, notify_hard_bounce_email, notify_soft_bounce_email FROM api_keys WHERE id = $1',
    [clientId]
  );

  if (rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }

  res.json({
    report_email: rows[0].report_email ?? null,
    notify_hard_bounce_email: rows[0].notify_hard_bounce_email ?? null,
    notify_soft_bounce_email: rows[0].notify_soft_bounce_email ?? null,
  });
});

// PUT /client/settings
router.put('/settings', async (req: Request, res: Response) => {
  const clientId = resolveClientId(req, res);
  if (!clientId) return;

  const { report_email, notify_hard_bounce_email, notify_soft_bounce_email } = req.body;

  // Validate whichever fields are present
  if (report_email !== undefined && !validateOptionalEmail(report_email)) {
    res.status(400).json({ error: 'Invalid report email address' }); return;
  }
  if (notify_hard_bounce_email !== undefined && !validateOptionalEmail(notify_hard_bounce_email)) {
    res.status(400).json({ error: 'Invalid hard bounce email address' }); return;
  }
  if (notify_soft_bounce_email !== undefined && !validateOptionalEmail(notify_soft_bounce_email)) {
    res.status(400).json({ error: 'Invalid soft bounce email address' }); return;
  }

  // Build dynamic SET clause for only provided fields
  const updates: string[] = [];
  const values: (string | null)[] = [];
  let idx = 1;

  if (report_email !== undefined) {
    updates.push(`report_email = $${idx++}`);
    values.push(report_email === '' ? null : report_email);
  }
  if (notify_hard_bounce_email !== undefined) {
    updates.push(`notify_hard_bounce_email = $${idx++}`);
    values.push(notify_hard_bounce_email === '' ? null : notify_hard_bounce_email);
  }
  if (notify_soft_bounce_email !== undefined) {
    updates.push(`notify_soft_bounce_email = $${idx++}`);
    values.push(notify_soft_bounce_email === '' ? null : notify_soft_bounce_email);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields provided to update' }); return;
  }

  values.push(clientId);
  const { rows } = await pool.query(
    `UPDATE api_keys SET ${updates.join(', ')} WHERE id = $${idx} RETURNING report_email, notify_hard_bounce_email, notify_soft_bounce_email`,
    values
  );

  if (rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }

  res.json({
    success: true,
    report_email: rows[0].report_email ?? null,
    notify_hard_bounce_email: rows[0].notify_hard_bounce_email ?? null,
    notify_soft_bounce_email: rows[0].notify_soft_bounce_email ?? null,
  });
});

export default router;
