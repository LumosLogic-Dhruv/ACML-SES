import { Router, Request, Response, NextFunction } from 'express';
import { getStatsByClientId } from '../services/emailLog';
import { istMidnight } from '../utils/time';

const router = Router();

// GET /api/stats?days=7
// GET /api/stats?from=2026-06-01&to=2026-06-18
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const { summary, timeseries } = await getStatsByClientId(req.clientId, from, to);

    res.json({ summary, timeseries, from: from.toISOString(), to: to.toISOString() });
  } catch (err) {
    next(err);
  }
});

export default router;
