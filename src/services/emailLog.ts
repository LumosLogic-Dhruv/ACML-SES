import { pool } from './db';

export interface EmailLogEntry {
  id: string;
  messageId: string;
  recipient: string;
  subject: string;
  sentAt: string;
  status: 'sent' | 'failed';
  jobId: string;
  clientId?: string;
  delivered?: boolean;
  opened?: boolean;
  bounced?: boolean;
}

export async function logEmail(entry: EmailLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO email_logs (id, message_id, recipient, subject, sent_at, status, job_id, client_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [entry.id, entry.messageId, entry.recipient, entry.subject, entry.sentAt, entry.status, entry.jobId, entry.clientId ?? null]
  );
}

export async function logEmailFromSMTP(entry: {
  messageId: string;
  recipient: string;
  subject: string;
  sentAt: string;
  configSet: string;
}): Promise<void> {
  // Look up client_id by ses_config_set name
  const { rows } = await pool.query(
    `SELECT id FROM api_keys WHERE ses_config_set = $1 AND is_active = TRUE LIMIT 1`,
    [entry.configSet]
  );
  if (rows.length === 0) {
    console.warn(`[emailLog] no client found for config set: ${entry.configSet}`);
    return;
  }
  const clientId = rows[0].id;

  const existing = await pool.query(
    `SELECT id FROM email_logs WHERE message_id = $1 AND recipient = $2 LIMIT 1`,
    [entry.messageId, entry.recipient]
  );
  if (existing.rows.length > 0) {
    console.log(`[emailLog] SMTP email already logged for messageId: ${entry.messageId}`);
    return;
  }

  await pool.query(
    `INSERT INTO email_logs (id, message_id, recipient, subject, sent_at, status, job_id, client_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sent', 'smtp', $5)`,
    [entry.messageId, entry.recipient, entry.subject, entry.sentAt, clientId]
  );
  console.log(`[emailLog] SMTP email logged for messageId: ${entry.messageId}, recipient: ${entry.recipient}`);
}

export async function updateEmailEvent(messageId: string, event: 'delivered' | 'opened' | 'bounced', bounceReason?: string): Promise<void> {
  let result;
  if (event === 'bounced' && bounceReason) {
    result = await pool.query(
      `UPDATE email_logs SET bounced = TRUE, bounce_reason = $2 WHERE message_id = $1`,
      [messageId, bounceReason]
    );
  } else {
    result = await pool.query(
      `UPDATE email_logs SET ${event} = TRUE WHERE message_id = $1`,
      [messageId]
    );
  }
  if (result.rowCount && result.rowCount > 0) {
    console.log(`[emailLog] updated ${event} for messageId: ${messageId}`);
  } else {
    console.warn(`[emailLog] no match for messageId: ${messageId}`);
  }
}

export async function getRecentEmails(
  clientId: string,
  limit: number = 100,
  from?: Date,
  to?: Date
): Promise<EmailLogEntry[]> {
  const params: (string | number | Date)[] = [clientId];
  const conditions: string[] = ['client_id = $1'];

  if (from && to) {
    params.push(from, to);
    conditions.push(`sent_at >= $${params.length - 1} AND sent_at <= $${params.length}`);
  }

  params.push(Math.min(limit, 1000));

  const { rows } = await pool.query(
    `SELECT id, message_id AS "messageId", recipient, subject,
            sent_at AS "sentAt", status, job_id AS "jobId",
            client_id AS "clientId", delivered, opened, bounced, bounce_reason AS "bounceReason"
     FROM email_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY sent_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getStatsByClientId(
  clientId: string,
  from: Date,
  to: Date
): Promise<{ summary: Record<string, number>; timeseries: Record<string, unknown>[] }> {
  const [summaryResult, timeseriesResult] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)                                      AS sent,
        COUNT(*) FILTER (WHERE delivered = TRUE)      AS delivered,
        COUNT(*) FILTER (WHERE bounced = TRUE)        AS bounced,
        COUNT(*) FILTER (WHERE status = 'failed')     AS failed
       FROM email_logs
       WHERE client_id = $1 AND sent_at >= $2 AND sent_at <= $3`,
      [clientId, from, to]
    ),
    pool.query(
      `SELECT
        DATE_TRUNC('day', sent_at AT TIME ZONE 'UTC') AS day,
        COUNT(*)                                       AS sent,
        COUNT(*) FILTER (WHERE delivered = TRUE)       AS delivered,
        COUNT(*) FILTER (WHERE bounced = TRUE)         AS bounced,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed
       FROM email_logs
       WHERE client_id = $1 AND sent_at >= $2 AND sent_at <= $3
       GROUP BY day ORDER BY day`,
      [clientId, from, to]
    ),
  ]);

  const s = summaryResult.rows[0];
  const sent      = parseInt(s.sent)      || 0;
  const delivered = parseInt(s.delivered) || 0;
  const bounced   = parseInt(s.bounced)   || 0;
  const failed    = parseInt(s.failed)    || 0;

  return {
    summary: {
      sent, delivered, bounced, failed,
      delivery_rate: sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0,
      bounce_rate:   sent > 0 ? Math.round((bounced   / sent) * 1000) / 10 : 0,
    },
    timeseries: timeseriesResult.rows.map(row => ({
      date:      new Date(row.day).toISOString().split('T')[0],
      sent:      parseInt(row.sent)      || 0,
      delivered: parseInt(row.delivered) || 0,
      bounced:   parseInt(row.bounced)   || 0,
      failed:    parseInt(row.failed)    || 0,
    })),
  };
}
