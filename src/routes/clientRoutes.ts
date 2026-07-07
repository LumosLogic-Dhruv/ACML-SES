import { Router, Request, Response } from 'express';
import { pool } from '../services/db';
import { getStatsByClientId } from '../services/emailLog';
import { istMidnight, nextMidnightIST } from '../utils/time';

const router = Router();

// GET /client/info — returns the client's own company info
router.get('/info', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  const { rows } = await pool.query(
    'SELECT id, client_name, allowed_domain FROM api_keys WHERE id = $1',
    [clientId]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }
  res.json({ client: rows[0] });
});

// GET /client/budget — today's usage against the daily email limit
router.get('/budget', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  const { rows: clientRows } = await pool.query<{ daily_limit: number }>(
    'SELECT daily_limit FROM api_keys WHERE id = $1',
    [clientId]
  );
  if (clientRows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }

  const dailyLimit = clientRows[0].daily_limit ?? 0;

  const { rows: countRows } = await pool.query<{ today_count: string }>(
    `SELECT COUNT(*) AS today_count FROM email_logs
     WHERE client_id = $1 AND sent_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
    [clientId]
  );
  const sentToday = parseInt(countRows[0]?.today_count ?? '0', 10);

  res.json({
    dailyLimit,
    sentToday,
    remaining: dailyLimit > 0 ? Math.max(dailyLimit - sentToday, 0) : null,
    usagePct: dailyLimit > 0 ? Math.min(100, Math.round((sentToday / dailyLimit) * 1000) / 10) : null,
    resetsAt: nextMidnightIST(),
  });
});

// GET /client/stats?days=7
router.get('/stats', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  let from: Date;
  let to: Date = new Date();

  if (req.query.from && req.query.to) {
    from = new Date(req.query.from as string);
    to   = new Date(req.query.to as string);
    to.setHours(23, 59, 59, 999);
  } else {
    const days = Math.min(parseInt((req.query.days as string) || '7'), 365);
    from = istMidnight(days - 1); // days=1 ("Today") → today's IST midnight
  }

  const { summary, timeseries } = await getStatsByClientId(clientId, from, to);
  res.json({ summary, timeseries, from: from.toISOString(), to: to.toISOString() });
});

// GET /client/emails?limit=100&offset=0&search=&from=YYYY-MM-DD&to=YYYY-MM-DD&days=7
router.get('/emails', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  const limit  = Math.min(parseInt((req.query.limit  as string) || '100'), 10000);
  const offset = parseInt((req.query.offset as string) || '0');
  const search = (req.query.search as string | undefined)?.trim();
  const from   = req.query.from as string | undefined;
  const to     = req.query.to   as string | undefined;
  const days   = req.query.days ? parseInt(req.query.days as string) : undefined;

  const params: (string | number | Date)[] = [clientId];
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
            delivered, opened, bounced, bounce_reason AS "bounceReason", bounce_type AS "bounceType"
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

export default router;
