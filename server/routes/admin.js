import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { authenticate, requireRole, verifyPassword, hashPassword, generateToken } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
const distDir = path.join(__dirname, '..', '..', 'dist');

function generateRouteHtml(routePath) {
  const dir = path.join(distDir, routePath);
  const file = path.join(dir, 'index.html');
  if (fs.existsSync(file)) return;
  const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, template);
}
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|pdf)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
});

// ── Auth ──

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.prepare('UPDATE admins SET last_login = datetime(\'now\') WHERE id = ?').run(admin.id);
  const token = generateToken(admin);
  res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.admin);
});

// ── Dashboard ──

router.get('/dashboard', authenticate, (_req, res) => {
  const orderStats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(CASE WHEN status IN ('paid','shipped','delivered') THEN total ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_orders
    FROM orders
  `).get();

  const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1').get().count;
  const leadCount = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  const reviewCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE approved = 1').get().count;

  const recentOrders = db.prepare(
    'SELECT id, order_number, customer_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5'
  ).all();

  res.json({
    orders: orderStats.total_orders,
    revenue: orderStats.revenue,
    pending_orders: orderStats.pending_orders,
    products: productCount,
    leads: leadCount,
    reviews: reviewCount,
    recent_orders: recentOrders,
  });
});

// ── Products ──

router.get('/products', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY sort_order ASC').all();
  res.json(rows);
});

router.get('/products/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

router.post('/products', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { slug, name, subtitle, character, notes, description, price, image, mood, sort_order } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'Slug and name required' });

  const result = db.prepare(
    'INSERT INTO products (slug, name, subtitle, character, notes, description, price, image, mood, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(slug, name, subtitle || '', character || '', notes || '', description || '', price || 0, image || '', mood || '', sort_order || 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/products/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const fields = ['slug', 'name', 'subtitle', 'character', 'notes', 'description', 'price', 'image', 'mood', 'active', 'sort_order'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/products/:id', authenticate, requireRole('super_admin'), (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Orders ──

router.get('/orders', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  res.json({ orders: rows, total });
});

router.get('/orders/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(row);
});

router.put('/orders/:id/status', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// ── Coupons ──

router.get('/coupons', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all());
});

router.post('/coupons', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { code, discount_amount, min_cart, max_uses, active, expires_at } = req.body;
  if (!code || !discount_amount) return res.status(400).json({ error: 'Code and discount required' });

  const result = db.prepare(
    'INSERT INTO coupons (code, discount_amount, min_cart, max_uses, active, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(code.toUpperCase(), discount_amount, min_cart || 0, max_uses || 0, active ?? 1, expires_at || null);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/coupons/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const fields = ['code', 'discount_amount', 'min_cart', 'max_uses', 'active', 'expires_at'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === 'code' ? req.body[f].toUpperCase() : req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/coupons/:id', authenticate, requireRole('super_admin'), (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Reviews ──

router.get('/reviews', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/reviews', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { product_slug, customer_name, rating, text, approved } = req.body;
  if (!product_slug || !customer_name) return res.status(400).json({ error: 'Product and customer name required' });

  // verified_purchase is NEVER set to true from admin — only from order verification
  const result = db.prepare(
    'INSERT INTO reviews (product_slug, customer_name, rating, text, verified_purchase, approved) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(product_slug, customer_name, rating || 5, text || '', approved ?? 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/reviews/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { customer_name, rating, text, approved } = req.body;
  const sets = [];
  const vals = [];

  if (customer_name !== undefined) { sets.push('customer_name = ?'); vals.push(customer_name); }
  if (rating !== undefined) { sets.push('rating = ?'); vals.push(rating); }
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  if (approved !== undefined) { sets.push('approved = ?'); vals.push(approved); }
  // verified_purchase cannot be set through admin API

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE reviews SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/reviews/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Pages ──

router.get('/pages', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM pages ORDER BY created_at DESC').all());
});

router.get('/pages/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Page not found' });
  res.json(row);
});

router.post('/pages', authenticate, requireRole('super_admin', 'admin', 'editor'), (req, res) => {
  const { slug, title, content, published } = req.body;
  if (!slug || !title) return res.status(400).json({ error: 'Slug and title required' });

  const result = db.prepare(
    'INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, ?)'
  ).run(slug, title, JSON.stringify(content || {}), published ?? 0);

  if (published && content && content.type === 'journal') generateRouteHtml('journal/' + slug);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/pages/:id', authenticate, requireRole('super_admin', 'admin', 'editor'), (req, res) => {
  const { slug, title, content, published } = req.body;
  const sets = [];
  const vals = [];

  if (slug !== undefined) { sets.push('slug = ?'); vals.push(slug); }
  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  if (content !== undefined) { sets.push('content = ?'); vals.push(JSON.stringify(content)); }
  if (published !== undefined) { sets.push('published = ?'); vals.push(published); }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  if (published && content && content.type === 'journal' && slug) generateRouteHtml('journal/' + slug);

  res.json({ ok: true });
});

router.delete('/pages/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Popups ──

router.get('/popups', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM popups ORDER BY created_at DESC').all());
});

router.post('/popups', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { title, type, content, active } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const result = db.prepare(
    'INSERT INTO popups (title, type, content, active) VALUES (?, ?, ?, ?)'
  ).run(title, type || 'welcome', JSON.stringify(content || {}), active ?? 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/popups/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { title, type, content, active } = req.body;
  const sets = [];
  const vals = [];

  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  if (type !== undefined) { sets.push('type = ?'); vals.push(type); }
  if (content !== undefined) { sets.push('content = ?'); vals.push(JSON.stringify(content)); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active); }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE popups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/popups/:id', authenticate, requireRole('super_admin'), (req, res) => {
  db.prepare('DELETE FROM popups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Settings ──

router.get('/settings', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = JSON.parse(r.value);
  res.json(obj);
});

router.put('/settings/:key', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const { value } = req.body;
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(req.params.key, JSON.stringify(value));
  res.json({ ok: true });
});

// ── Leads ──

router.get('/leads', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  res.json({ leads: rows, total });
});

router.delete('/leads/:id', authenticate, requireRole('super_admin'), (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Media ──

router.get('/media', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/media/upload', authenticate, requireRole('super_admin', 'admin', 'editor'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const result = db.prepare(
    'INSERT INTO media (filename, original_name, mime_type, size, path, alt_text) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, `/uploads/${req.file.filename}`, req.body.alt_text || '');

  res.status(201).json({
    id: result.lastInsertRowid,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
  });
});

router.delete('/media/:id', authenticate, requireRole('super_admin', 'admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(uploadsDir, row.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Admin management (super_admin only) ──

router.get('/admins', authenticate, requireRole('super_admin'), (req, res) => {
  const rows = db.prepare('SELECT id, email, name, role, created_at, last_login FROM admins ORDER BY created_at ASC').all();
  res.json(rows);
});

router.post('/admins', authenticate, requireRole('super_admin'), (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const validRoles = ['super_admin', 'admin', 'editor'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const hash = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO admins (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, hash, name || '', role || 'editor');

  res.status(201).json({ id: result.lastInsertRowid });
});

router.delete('/admins/:id', authenticate, requireRole('super_admin'), (req, res) => {
  if (req.admin.id === parseInt(req.params.id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
