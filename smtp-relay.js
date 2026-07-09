require("dotenv").config();
const { randomUUID } = require("crypto");
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

const MAX_TOTAL_SIZE = 512 * 1024; // 512KB — total email size including attachments
const RELAY_PORT = 2525;
const DRY_RUN = process.env.RELAY_DRY_RUN === "true";
const SEND_RATE_PER_SEC = parseInt(process.env.SES_SEND_RATE || "14");

// One pooled, rate-limited transporter per client SMTP config — reused across
// emails instead of opening a fresh SES connection for every single message.
const transporterCache = new Map();

function getTransporter(smtp) {
  const cacheKey = `${smtp.host}:${smtp.port}:${smtp.user}`;
  if (!transporterCache.has(cacheKey)) {
    transporterCache.set(cacheKey, nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: true,
      auth: { user: smtp.user, pass: smtp.pass },
      pool: true,
      maxConnections: 5,
      rateDelta: 1000,
      rateLimit: SEND_RATE_PER_SEC,
    }));
  }
  return transporterCache.get(cacheKey);
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

function smtpError(code, message) {
  const err = new Error(message);
  err.responseCode = code;
  return err;
}

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://recruitx:recruitx123@localhost:5432/recruitx";
const pool = new Pool({ connectionString: DATABASE_URL });

async function findClientByRelayLogin(username, password) {
  const { rows } = await pool.query(
    `SELECT id, client_name, smtp_host, smtp_port, smtp_user, smtp_pass, ses_config_set
     FROM api_keys
     WHERE relay_username = $1 AND relay_password = $2 AND is_active = TRUE
     LIMIT 1`,
    [username, password]
  );
  return rows[0] || null;
}

async function logAttempt({ clientId, recipient, subject, status, jobId, messageId }) {
  await pool.query(
    `INSERT INTO email_logs (id, message_id, recipient, subject, sent_at, status, job_id, client_id)
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)`,
    [randomUUID(), messageId || null, recipient || "(unknown)", subject || "(no subject)", status, jobId, clientId || null]
  ).catch((err) => console.error("Failed to write email_logs row:", err.message));
}

const server = new SMTPServer({
  authOptional: false,
  disabledCommands: ["STARTTLS"],

  onAuth(auth, session, callback) {
    findClientByRelayLogin(auth.username, auth.password)
      .then((client) => {
        if (!client) {
          return callback(smtpError(535, "Invalid relay username or password"));
        }
        console.log(`AUTH OK — client=${client.client_name}`);
        session.client = client;
        callback(null, { user: client.client_name });
      })
      .catch((err) => {
        console.error("Auth lookup failed:", err.message);
        callback(smtpError(454, "Temporary auth failure"));
      });
  },

  onData(stream, session, callback) {
    const chunks = [];
    let totalSize = 0;
    let rejected = false;

    stream.on("data", (chunk) => {
      totalSize += chunk.length;

      if (totalSize > MAX_TOTAL_SIZE) {
        rejected = true; // stop buffering further chunks — no need to hold an oversized email in memory
        return;
      }
      chunks.push(chunk);
    });

    stream.on("end", async () => {
      const client = session.client;

      if (rejected) {
        console.log(`REJECTED — ${client?.client_name || "unknown"}: size ${formatBytes(totalSize)} exceeds ${formatBytes(MAX_TOTAL_SIZE)} limit`);
        await logAttempt({
          clientId: client?.id, recipient: "(unknown — rejected before parsing)", subject: "(unknown — rejected before parsing)",
          status: "failed", jobId: "relay-rejected-size",
        });
        return callback(smtpError(552, `Mail size limit exceeded (${formatBytes(MAX_TOTAL_SIZE)} max). Email not sent - please try again with a mail under ${formatBytes(MAX_TOTAL_SIZE)}.`));
      }

      if (!client) {
        return callback(smtpError(530, "Authentication required"));
      }

      if (!DRY_RUN && (!client.smtp_host || !client.smtp_user || !client.smtp_pass)) {
        console.log(`REJECTED — ${client.client_name} has no SMTP credentials configured in the DB`);
        return callback(smtpError(554, "Relay not configured for this client"));
      }

      const smtp = { host: client.smtp_host, port: client.smtp_port || 465, user: client.smtp_user, pass: client.smtp_pass, configSet: client.ses_config_set };

      const raw = Buffer.concat(chunks);
      let parsed;

      try {
        parsed = await simpleParser(raw);
        const attachments = parsed.attachments || [];

        console.log(`OK — client=${client.client_name} from=${parsed.from?.text} to=${parsed.to?.text} size=${(totalSize / 1024).toFixed(1)}KB attachments=${attachments.length}`);

        if (DRY_RUN) {
          console.log(`DRY RUN — would forward to SES via host=${smtp.host || "(none configured)"} — no real email sent.`);
          await logAttempt({
            clientId: client.id, recipient: parsed.to?.text, subject: parsed.subject,
            status: "sent", jobId: "relay-dryrun",
          });
          return callback();
        }

        const sesTransporter = getTransporter(smtp);

        const info = await sesTransporter.sendMail({
          from: parsed.from?.text,
          to: parsed.to?.text,
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
          headers: smtp.configSet ? { "X-SES-CONFIGURATION-SET": smtp.configSet } : undefined,
        });

        // SES embeds its own message ID in the raw SMTP response (e.g. "250 Ok <ses-id>") —
        // that's the ID SNS will report later for delivery/bounce events, so we must store
        // that exact value, not nodemailer's self-generated Message-ID header.
        const sesMatch = /250\s+Ok\s+(\S+)/i.exec(info.response || "");
        const sesMessageId = sesMatch ? sesMatch[1] : info.messageId;

        console.log(`Forwarded to SES successfully for ${client.client_name}. SES message id: ${sesMessageId}`);
        await logAttempt({
          clientId: client.id, recipient: parsed.to?.text, subject: parsed.subject,
          status: "sent", jobId: "relay", messageId: sesMessageId,
        });
        callback();
      } catch (err) {
        console.error("Relay error:", err.message);
        await logAttempt({
          clientId: client.id, recipient: parsed?.to?.text, subject: parsed?.subject,
          status: "failed", jobId: "relay-error",
        });
        callback(smtpError(554, "Internal relay error"));
      }
    });
  },
});

server.listen(RELAY_PORT, () => {
  console.log(`SMTP relay listening on localhost:${RELAY_PORT}`);
  console.log(`Rules: max ${formatBytes(MAX_TOTAL_SIZE)} per email (including attachments)`);
  console.log(`Per-client auth against: ${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}`);
});
