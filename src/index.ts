import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { initDb } from './services/db';
import { requireApiKey } from './middleware/auth';
import { requireAuth, requireAdminRole } from './middleware/jwt';
import { rateLimiter, dashboardLimiter } from './middleware/rateLimiter';
import sendRoutes from './routes/send';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/admin';
import clientRoutes from './routes/clientRoutes';
import emailRoutes from './routes/email';
import metricsRoutes from './routes/metrics';
import statsRoutes from './routes/stats';
import webhookRoutes from './routes/webhook';
import docsRoutes from './routes/docs';
import settingsRoutes from './routes/settings';
import suppressionRoutes from './routes/suppression';
import { startReportCron } from './workers/reportCron';

const app = express();

// Security headers (XSS, clickjacking, sniffing, etc.)
app.use(helmet());

// Restrict CORS to allowed origins only
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('CORS: origin not allowed'));
      }
    : false,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve admin panel HTML
app.get('/panel', (_req, res) => res.sendFile(path.join(__dirname, '../public/panel.html')));

// Public routes — no auth needed
app.use('/webhooks', webhookRoutes);      // SNS signature verified inside
app.use('/docs', docsRoutes);             // Swagger UI

// Auth routes — public
app.use('/auth', authRoutes);

// Admin routes — JWT + admin role required
app.use('/admin', requireAuth, requireAdminRole, adminRoutes);
app.use('/admin/suppression', requireAuth, requireAdminRole, suppressionRoutes);

// Client suppression — JWT only (scoped to their own emails)
app.use('/client/suppression', requireAuth, suppressionRoutes);

// Client self-service routes — JWT only (scoped to their own client_id)
app.use('/client', requireAuth, clientRoutes);
app.use('/client', requireAuth, settingsRoutes);

// Send routes — strict rate limit (multipart + JSON)
app.use('/api', rateLimiter, requireApiKey, sendRoutes);
// Dashboard read-only routes — relaxed rate limit
app.use('/api', dashboardLimiter, requireApiKey, emailRoutes);
app.use('/api', dashboardLimiter, requireApiKey, metricsRoutes);
app.use('/api', dashboardLimiter, requireApiKey, statsRoutes);

app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  // Multer file size exceeded
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'File too large. Maximum allowed size is 2MB per file.' });
    return;
  }
  // Multer too many files
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
    res.status(400).json({ error: 'Too many files. Maximum allowed is 3 attachments per email.' });
    return;
  }
  // Multer file type rejected
  if (err.message?.startsWith('File type not allowed')) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

initDb()
  .then(() => {
    console.log('[db] PostgreSQL ready');
    startReportCron();
  })
  .catch(err => console.error('[db] init failed:', err.message));

const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close();
});

export default app;
