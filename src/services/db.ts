import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function initDb(): Promise<void> {
  // Run column migrations FIRST so indexes on new columns don't fail
  await pool.query(`ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS client_id UUID`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_msg_recipient ON email_logs (message_id, recipient) WHERE message_id IS NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS allowed_domain TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS smtp_host TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS smtp_port INTEGER`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS smtp_user TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS smtp_pass TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS ses_config_set TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE api_keys   ADD COLUMN IF NOT EXISTS report_email TEXT`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id           UUID PRIMARY KEY,
      message_id   TEXT,
      recipient    TEXT NOT NULL,
      subject      TEXT NOT NULL,
      sent_at      TIMESTAMPTZ NOT NULL,
      status       TEXT NOT NULL,
      job_id       TEXT,
      delivered    BOOLEAN NOT NULL DEFAULT FALSE,
      opened       BOOLEAN NOT NULL DEFAULT FALSE,
      bounced      BOOLEAN NOT NULL DEFAULT FALSE,
      client_id    UUID
    );
    CREATE INDEX IF NOT EXISTS idx_email_logs_message_id ON email_logs (message_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at    ON email_logs (sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_logs_client_id  ON email_logs (client_id);

    CREATE TABLE IF NOT EXISTS suppressed_emails (
      email          TEXT PRIMARY KEY,
      reason         TEXT NOT NULL,
      suppressed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key            TEXT UNIQUE NOT NULL,
      client_name    TEXT NOT NULL,
      allowed_domain TEXT NOT NULL DEFAULT '',
      smtp_host      TEXT,
      smtp_port      INTEGER,
      smtp_user      TEXT,
      smtp_pass      TEXT,
      ses_config_set TEXT,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys (key);

    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username      TEXT UNIQUE NOT NULL,
      email         TEXT,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'client',
      client_id     UUID,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
  `);

  // Bootstrap admin user from env vars if no admin exists yet
  if (config.adminUsername && config.adminPassword) {
    const { rows: adminRows } = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminRows.length === 0) {
      const { hashPassword } = await import('./authService');
      const hash = await hashPassword(config.adminPassword);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (username) DO NOTHING`,
        [config.adminUsername.toLowerCase(), config.adminEmail || null, hash]
      );
      console.log(`[db] Admin user "${config.adminUsername}" created`);
    } else if (config.adminEmail) {
      // Backfill email on existing admin if not set
      await pool.query(
        `UPDATE users SET email = $1 WHERE role = 'admin' AND email IS NULL`,
        [config.adminEmail.toLowerCase()]
      );
    }
  }

  // Auto-migrate legacy API_KEY as "default" client if table is empty
  if (config.apiKey) {
    const { rows } = await pool.query('SELECT 1 FROM api_keys LIMIT 1');
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO api_keys (key, client_name, allowed_domain) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
        [config.apiKey, 'default', '']
      );
      console.log('[db] Migrated legacy API_KEY as "default" client key');
    }
  }
}
