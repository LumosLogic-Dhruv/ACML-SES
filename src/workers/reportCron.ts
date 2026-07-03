import cron from 'node-cron';
import { pool } from '../services/db';
import { sendReportEmail } from '../services/reportEmailer';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getTodayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0];
}

function getYesterdayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS - 86400000).toISOString().split('T')[0];
}

interface ClientRow {
  id: string;
  client_name: string;
  report_email: string;
}

async function getActiveClientsWithReportEmail(): Promise<ClientRow[]> {
  const { rows } = await pool.query<ClientRow>(
    `SELECT id, client_name, report_email
     FROM api_keys
     WHERE is_active = true
       AND report_email IS NOT NULL
       AND report_email != ''`
  );
  return rows;
}

async function runDailyReport(): Promise<void> {
  const yesterday = getYesterdayIST();
  console.log(`[reportCron] Running daily report for ${yesterday}`);

  const clients = await getActiveClientsWithReportEmail();
  console.log(`[reportCron] Found ${clients.length} client(s) with report email`);

  for (const client of clients) {
    try {
      await sendReportEmail({
        clientId: client.id,
        clientName: client.client_name,
        reportEmail: client.report_email,
        type: 'daily',
        fromDate: yesterday,
        toDate: yesterday,
      });
      console.log(`[reportCron] Daily report sent to ${client.report_email} for client ${client.client_name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reportCron] Failed to send daily report for client ${client.client_name}: ${msg}`);
    }
  }
}

async function runMonthlyReport(): Promise<void> {
  const todayIST = getTodayIST();
  const todayDate = new Date(todayIST);

  // Previous month
  const prevMonthYear = todayDate.getMonth() === 0 ? todayDate.getFullYear() - 1 : todayDate.getFullYear();
  const prevMonth = todayDate.getMonth() === 0 ? 12 : todayDate.getMonth(); // 1-indexed

  const fromDate = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-01`;
  // Last day of previous month = day before first of current month
  const lastDayOfPrevMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0);
  const toDate = `${lastDayOfPrevMonth.getFullYear()}-${String(lastDayOfPrevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfPrevMonth.getDate()).padStart(2, '0')}`;

  console.log(`[reportCron] Running monthly report for ${fromDate} to ${toDate}`);

  const clients = await getActiveClientsWithReportEmail();
  console.log(`[reportCron] Found ${clients.length} client(s) with report email`);

  for (const client of clients) {
    try {
      await sendReportEmail({
        clientId: client.id,
        clientName: client.client_name,
        reportEmail: client.report_email,
        type: 'monthly',
        fromDate,
        toDate,
      });
      console.log(`[reportCron] Monthly report sent to ${client.report_email} for client ${client.client_name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reportCron] Failed to send monthly report for client ${client.client_name}: ${msg}`);
    }
  }
}

export function startReportCron(): void {
  // Daily: 2:30 AM UTC = 8:00 AM IST, every day
  cron.schedule('30 2 * * *', () => {
    runDailyReport().catch(err => {
      console.error('[reportCron] Daily cron error:', err instanceof Error ? err.message : err);
    });
  });

  // Monthly: 2:30 AM UTC on 1st of month = 8:00 AM IST on 1st
  cron.schedule('30 2 1 * *', () => {
    runMonthlyReport().catch(err => {
      console.error('[reportCron] Monthly cron error:', err instanceof Error ? err.message : err);
    });
  });

  console.log('[reportCron] Daily and monthly report crons scheduled');
}
