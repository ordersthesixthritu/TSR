import app from './app.js';
import { processEmailQueue } from './services/notifications.js';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.get('/admin/*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'index.html')));

setInterval(() => {
  processEmailQueue().catch(err => console.error('Email queue error:', err.message));
}, 30_000);

app.listen(PORT, () => console.log(`TSR server running on port ${PORT}`));
