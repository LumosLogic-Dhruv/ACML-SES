import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  ses: {
    configSet: process.env.SES_CONFIG_SET || 'recruitx-config',
    defaultFrom: process.env.SES_DEFAULT_FROM || '',
    sendRate: parseInt(process.env.SES_SEND_RATE || '100'),
    allowedFromDomains: (process.env.ALLOWED_FROM_DOMAINS || '')
      .split(',').map(d => d.trim()).filter(Boolean),
  },
  maxRecipientsPerRequest: parseInt(process.env.MAX_RECIPIENTS || '10000'),
  bulkThreshold: parseInt(process.env.BULK_THRESHOLD || '50'),
  jwtSecret: process.env.JWT_SECRET || 'change-this-jwt-secret',
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://recruitx:recruitx123@localhost:5432/recruitx',
  apiKey: process.env.API_KEY || '',          // legacy fallback
  adminKey: process.env.ADMIN_KEY || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
  reportSmtp: {
    host: process.env.REPORT_SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.REPORT_SMTP_PORT || '587'),
    user: process.env.REPORT_SMTP_USER || '',
    pass: process.env.REPORT_SMTP_PASS || '',
    from: process.env.REPORT_FROM_EMAIL || '',
  },
};
