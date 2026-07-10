import { Router, Request, Response } from 'express';
import { pool } from '../services/db';
import { getStatsByClientId } from '../services/emailLog';
import { istMidnight, nextMidnightIST, istDateStart, istDateEnd, todayISTDateString } from '../utils/time';

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

// GET /client/budget?date=YYYY-MM-DD — usage for a given IST calendar day against the daily email limit (default: today)
router.get('/budget', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  const { rows: clientRows } = await pool.query<{ daily_limit: number }>(
    'SELECT daily_limit FROM api_keys WHERE id = $1',
    [clientId]
  );
  if (clientRows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }

  const dailyLimit = clientRows[0].daily_limit ?? 0;

  const todayStr = todayISTDateString();
  const date = ((req.query.date as string | undefined)?.trim()) || todayStr;
  const isToday = date === todayStr;
  const rangeEnd = date > todayStr ? new Date() : istDateEnd(date); // clamp future dates to "now"

  const { rows: countRows } = await pool.query<{ day_count: string }>(
    `SELECT COUNT(*) AS day_count FROM email_logs
     WHERE client_id = $1 AND sent_at >= $2 AND sent_at <= $3`,
    [clientId, istDateStart(date), rangeEnd]
  );
  const sent = parseInt(countRows[0]?.day_count ?? '0', 10);

  res.json({
    date,
    isToday,
    dailyLimit,
    sent,
    remaining: dailyLimit > 0 ? Math.max(dailyLimit - sent, 0) : null,
    usagePct: dailyLimit > 0 ? Math.min(100, Math.round((sent / dailyLimit) * 1000) / 10) : null,
    resetsAt: isToday ? nextMidnightIST() : null,
  });
});

// GET /client/stats?days=7
router.get('/stats', async (req: Request, res: Response) => {
  const clientId = req.user?.clientId;
  if (!clientId) { res.status(403).json({ error: 'No client associated with this account' }); return; }

  let from: Date;
  let to: Date = new Date();

  if (req.query.from && req.query.to) {
    let fromStr = req.query.from as string;
    let toStr   = req.query.to as string;
    if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr]; // never let start be after end
    from = istDateStart(fromStr);
    to   = istDateEnd(toStr);
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

  const limitParam = req.query.limit as string | undefined;
  const limit  = limitParam === 'all' ? 100000 : Math.min(parseInt(limitParam || '100'), 100000);
  const offset = parseInt((req.query.offset as string) || '0');
  const search = (req.query.search as string | undefined)?.trim();
  let   from   = req.query.from as string | undefined;
  let   to     = req.query.to   as string | undefined;
  const days   = req.query.days ? parseInt(req.query.days as string) : undefined;

  if (from && to && from > to) [from, to] = [to, from]; // never let start be after end

  const params: (string | number | Date)[] = [clientId];
  const whereClauses: string[] = [];

  if (search) {
    params.push(`%${search}%`);
    whereClauses.push(`(recipient ILIKE $${params.length} OR subject ILIKE $${params.length})`);
  }
  if (from && to) {
    params.push(istDateStart(from));
    whereClauses.push(`sent_at >= $${params.length}`);
    params.push(istDateEnd(to));
    whereClauses.push(`sent_at <= $${params.length}`);
  } else if (days) {
    params.push(istMidnight(days - 1)); // days=1 ("Today") → today's IST midnight
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
