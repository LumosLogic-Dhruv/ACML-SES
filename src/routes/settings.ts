import { Router, Request, Response } from 'express';
import { pool } from '../services/db';

const router = Router();

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// GET /client/settings — returns report_email for the authenticated client
router.get('/settings', async (req: Request, res: Response) => {
  let clientId: string | null | undefined;

  if (req.user?.role === 'admin') {
    clientId = req.query.clientId as string | undefined;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query param required for admin' });
      return;
    }
  } else {
    clientId = req.user?.clientId;
    if (!clientId) {
      res.status(403).json({ error: 'No client associated with this account' });
      return;
    }
  }

  const { rows } = await pool.query(
    'SELECT report_email FROM api_keys WHERE id = $1',
    [clientId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  res.json({ report_email: rows[0].report_email ?? null });
});

// PUT /client/settings — updates report_email for the authenticated client
router.put('/settings', async (req: Request, res: Response) => {
  let clientId: string | null | undefined;

  if (req.user?.role === 'admin') {
    clientId = req.query.clientId as string | undefined;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query param required for admin' });
      return;
    }
  } else {
    clientId = req.user?.clientId;
    if (!clientId) {
      res.status(403).json({ error: 'No client associated with this account' });
      return;
    }
  }

  const { report_email } = req.body;

  if (report_email === undefined) {
    res.status(400).json({ error: 'report_email field is required' });
    return;
  }

  // Allow empty string to clear, otherwise validate format
  if (report_email !== '' && !EMAIL_REGEX.test(report_email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  const emailValue = report_email === '' ? null : report_email;

  const { rows } = await pool.query(
    'UPDATE api_keys SET report_email = $1 WHERE id = $2 RETURNING report_email',
    [emailValue, clientId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  res.json({ success: true, report_email: rows[0].report_email ?? null });
});

export default router;
