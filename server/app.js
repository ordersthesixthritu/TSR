import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initDatabase } from './db/schema.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import { initEmail, processEmailQueue } from './services/notifications.js';
import { initSheets, ensureSheetHeaders } from './services/sheets.js';

const app = express();

initDatabase();
initEmail();
initSheets();

ensureSheetHeaders().catch(err => console.error('Sheets header check failed:', err.message));

app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:8765')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
}));

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/cron/process-emails', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await processEmailQueue();
    res.json({ status: 'ok', processed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
