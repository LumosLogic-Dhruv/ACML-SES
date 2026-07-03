import { Router, Request, Response } from 'express';
import { SESv2Client, ListSuppressedDestinationsCommand, DeleteSuppressedDestinationCommand } from '@aws-sdk/client-sesv2';
import { config } from '../config';

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

// GET /admin/suppression?nextToken=xxx
router.get('/', async (_req: Request, res: Response) => {
  try {
    const client = getSESClient();
    const result = await client.send(new ListSuppressedDestinationsCommand({ PageSize: 100 }));

    const items = (result.SuppressedDestinationSummaries ?? []).map(item => ({
      email: item.EmailAddress,
      reason: item.Reason,
      suppressedAt: item.LastUpdateTime?.toISOString(),
    }));

    res.json({ items, nextToken: result.NextToken ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[suppression] list error:', msg);
    res.status(500).json({ error: 'Failed to fetch suppression list' });
  }
});

// DELETE /admin/suppression/:email
router.delete('/:email', async (req: Request, res: Response) => {
  const email = decodeURIComponent(req.params.email);
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  try {
    const client = getSESClient();
    await client.send(new DeleteSuppressedDestinationCommand({ EmailAddress: email }));
    res.json({ success: true, message: `${email} removed from suppression list` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[suppression] delete error:', msg);
    res.status(500).json({ error: 'Failed to remove from suppression list' });
  }
});

export default router;
