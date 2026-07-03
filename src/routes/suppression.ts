import { Router, Request, Response } from 'express';
import { SESv2Client, ListSuppressedDestinationsCommand, DeleteSuppressedDestinationCommand } from '@aws-sdk/client-sesv2';
import { config } from '../config';
import { pool } from '../services/db';

const router = Router();

function getSESClient(): SESv2Client {
  return new SESv2Client({
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
  });
}

async function fetchAllSuppressed(): Promise<{ email: string; reason: string; suppressedAt: string }[]> {
  const sesClient = getSESClient();
  const result = await sesClient.send(new ListSuppressedDestinationsCommand({ PageSize: 100 }));
  return (result.SuppressedDestinationSummaries ?? []).map((item: { EmailAddress?: string; Reason?: string; LastUpdateTime?: Date }) => ({
    email: item.EmailAddress ?? '',
    reason: item.Reason ?? '',
    suppressedAt: item.LastUpdateTime?.toISOString() ?? new Date().toISOString(),
  }));
}

// GET /admin/suppression — all suppressed emails (admin only)
router.get('/admin', async (_req: Request, res: Response) => {
  try {
    const items = await fetchAllSuppressed();
    res.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[suppression] list error:', msg);
    res.status(500).json({ error: 'Failed to fetch suppression list' });
  }
});

// GET /client/suppression — suppressed emails filtered to this client's recipients
router.get('/client', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) {
    res.status(403).json({ error: 'No client associated with this account' });
    return;
  }

  try {
    // Get all recipients this client has sent to
    const { rows } = await pool.query<{ recipient: string }>(
      `SELECT DISTINCT LOWER(recipient) AS recipient FROM email_logs WHERE client_id = $1`,
      [clientId]
    );
    const clientEmails = new Set(rows.map(r => r.recipient.toLowerCase()));

    if (clientEmails.size === 0) {
      res.json({ items: [] });
      return;
    }

    const allSuppressed = await fetchAllSuppressed();
    const items = allSuppressed.filter(item => clientEmails.has(item.email.toLowerCase()));

    res.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[suppression] client list error:', msg);
    res.status(500).json({ error: 'Failed to fetch suppression list' });
  }
});

// DELETE /admin/suppression/:email — remove from suppression (admin only)
router.delete('/:email', async (req: Request, res: Response) => {
  const email = decodeURIComponent(req.params.email);
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  try {
    const sesClient = getSESClient();
    await sesClient.send(new DeleteSuppressedDestinationCommand({ EmailAddress: email }));
    res.json({ success: true, message: `${email} removed from suppression list` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[suppression] delete error:', msg);
    res.status(500).json({ error: 'Failed to remove from suppression list' });
  }
});

export default router;
