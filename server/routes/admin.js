import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { authenticate, requireRole, verifyPassword, hashPassword, generateToken } from '../middleware/auth.js';
import { updateOrderInSheet } from '../services/sheets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch { /* serverless: no persistent filesystem */ }

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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.prepare("UPDATE admins SET last_login = NOW() WHERE id = ?").run(admin.id);
    const token = generateToken(admin);
    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.admin);
});

router.get('/dashboard', authenticate, async (_req, res) => {
  try {
    const orderStats = await db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status IN ('confirmed','paid','shipped','delivered') THEN total ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_orders
      FROM orders
    `).get();

    const productCount = (await db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1').get()).count;
    const leadCount = (await db.prepare('SELECT COUNT(*) as count FROM leads').get()).count;
    const reviewCount = (await db.prepare('SELECT COUNT(*) as count FROM reviews WHERE approved = 1').get()).count;

    const recentOrders = await db.prepare(
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
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch dashboard' });
  }
});

router.get('/products', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM products ORDER BY sort_order ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch products' });
  }
});

router.get('/products/:id', authenticate, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch product' });
  }
});

router.post('/products', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { slug, name, subtitle, character, notes, description, price, image, mood, sort_order } = req.body;
    if (!slug || !name) return res.status(400).json({ error: 'Slug and name required' });

    const result = await db.prepare(
      'INSERT INTO products (slug, name, subtitle, character, notes, description, price, image, mood, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(slug, name, subtitle || '', character || '', notes || '', description || '', price || 0, image || '', mood || '', sort_order || 0);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create product' });
  }
});

router.put('/products/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
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

    sets.push("updated_at = NOW()");
    vals.push(req.params.id);
    await db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update product' });
  }
});

router.delete('/products/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete product' });
  }
});

router.get('/orders', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const { status, payment_method, payment_status, search, date } = req.query;

    let where = [];
    let params = [];

    if (status) { where.push('status = ?'); params.push(status); }
    if (payment_method) { where.push('payment_method = ?'); params.push(payment_method); }
    if (payment_status) { where.push('payment_status = ?'); params.push(payment_status); }
    if (date === 'today') {
      where.push("created_at >= CURRENT_DATE");
    }
    if (search) {
      where.push("(order_number ILIKE ? OR customer_name ILIKE ? OR customer_email ILIKE ? OR customer_phone ILIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await db.prepare(`SELECT * FROM orders ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = (await db.prepare(`SELECT COUNT(*) as count FROM orders ${clause}`).get(...params)).count;
    res.json({ orders: rows, total });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch orders' });
  }
});

router.get('/orders/export/csv', authenticate, async (_req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const headers = ['Order Number','Date','Customer Name','Email','Phone','Address','City','State','Pincode','Items','Subtotal','Discount','Coupon','Total','Payment Method','Payment Status','Order Status','Razorpay Order ID','Razorpay Payment ID','Invoice','Tracking','Courier'];
    const csvRows = [headers.join(',')];
    for (const o of rows) {
      let itemNames = '';
      try { const items = JSON.parse(o.items || '[]'); itemNames = items.map(i => `${i.slug} x${i.qty}`).join('; '); } catch {}
      csvRows.push([
        o.order_number, o.created_at ? new Date(o.created_at).toISOString().slice(0,10) : '',
        `"${(o.customer_name||'').replace(/"/g,'""')}"`, o.customer_email, o.customer_phone,
        `"${(o.shipping_address||'').replace(/"/g,'""')}"`, o.shipping_city, o.shipping_state, o.shipping_pincode,
        `"${itemNames}"`, (o.subtotal/100).toFixed(2), (o.discount/100).toFixed(2), o.coupon_used,
        (o.total/100).toFixed(2), o.payment_method, o.payment_status, o.status,
        o.razorpay_order_id||'', o.razorpay_payment_id||'', o.invoice_number||'',
        o.tracking_number||'', o.courier||''
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tsr-orders-' + new Date().toISOString().slice(0,10) + '.csv');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: 'Could not export orders' });
  }
});

router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Order not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch order' });
  }
});

router.put('/orders/:id/status', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    await db.prepare("UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?").run(status, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update order status' });
  }
});

router.put('/orders/:id/tracking', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { tracking_number, courier } = req.body;
    if (!tracking_number) return res.status(400).json({ error: 'Tracking number required' });

    await db.prepare(
      "UPDATE orders SET tracking_number = ?, courier = ?, updated_at = NOW() WHERE id = ?"
    ).run(tracking_number, courier || '', req.params.id);

    const order = await db.prepare('SELECT order_number FROM orders WHERE id = ?').get(req.params.id);
    if (order) {
      updateOrderInSheet(order.order_number, { tracking_number, courier: courier || '' }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update tracking' });
  }
});

router.get('/coupons', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch coupons' });
  }
});

router.post('/coupons', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { code, discount_amount, discount_type, max_discount, min_cart, max_uses, active, expires_at } = req.body;
    if (!code || !discount_amount) return res.status(400).json({ error: 'Code and discount required' });
    const dtype = discount_type === 'percentage' ? 'percentage' : 'fixed';

    const result = await db.prepare(
      'INSERT INTO coupons (code, discount_amount, discount_type, max_discount, min_cart, max_uses, active, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(code.toUpperCase(), discount_amount, dtype, max_discount || 0, min_cart || 0, max_uses || 0, active ?? 1, expires_at || null);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create coupon' });
  }
});

router.put('/coupons/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const fields = ['code', 'discount_amount', 'discount_type', 'max_discount', 'min_cart', 'max_uses', 'active', 'expires_at'];
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
    await db.prepare(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update coupon' });
  }
});

router.delete('/coupons/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete coupon' });
  }
});

router.get('/reviews', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch reviews' });
  }
});

router.post('/reviews', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { product_slug, customer_name, rating, text, approved } = req.body;
    if (!product_slug || !customer_name) return res.status(400).json({ error: 'Product and customer name required' });

    const result = await db.prepare(
      'INSERT INTO reviews (product_slug, customer_name, rating, text, verified_purchase, approved) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(product_slug, customer_name, rating || 5, text || '', approved ?? 0);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create review' });
  }
});

router.put('/reviews/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { customer_name, rating, text, approved } = req.body;
    const sets = [];
    const vals = [];

    if (customer_name !== undefined) { sets.push('customer_name = ?'); vals.push(customer_name); }
    if (rating !== undefined) { sets.push('rating = ?'); vals.push(rating); }
    if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
    if (approved !== undefined) { sets.push('approved = ?'); vals.push(approved); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await db.prepare(`UPDATE reviews SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update review' });
  }
});

router.delete('/reviews/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete review' });
  }
});

router.get('/pages', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM pages ORDER BY created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch pages' });
  }
});

router.get('/pages/:id', authenticate, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Page not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch page' });
  }
});

router.post('/pages', authenticate, requireRole('super_admin', 'admin', 'editor'), async (req, res) => {
  try {
    const { slug, title, content, published } = req.body;
    if (!slug || !title) return res.status(400).json({ error: 'Slug and title required' });

    const result = await db.prepare(
      'INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, ?)'
    ).run(slug, title, JSON.stringify(content || {}), published ?? 0);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create page' });
  }
});

router.put('/pages/:id', authenticate, requireRole('super_admin', 'admin', 'editor'), async (req, res) => {
  try {
    const { slug, title, content, published } = req.body;
    const sets = [];
    const vals = [];

    if (slug !== undefined) { sets.push('slug = ?'); vals.push(slug); }
    if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
    if (content !== undefined) { sets.push('content = ?'); vals.push(JSON.stringify(content)); }
    if (published !== undefined) { sets.push('published = ?'); vals.push(published); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push("updated_at = NOW()");
    vals.push(req.params.id);
    await db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update page' });
  }
});

router.delete('/pages/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete page' });
  }
});

router.get('/popups', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM popups ORDER BY created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch popups' });
  }
});

router.post('/popups', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { title, type, content, active } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const result = await db.prepare(
      'INSERT INTO popups (title, type, content, active) VALUES (?, ?, ?, ?)'
    ).run(title, type || 'welcome', JSON.stringify(content || {}), active ?? 0);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create popup' });
  }
});

router.put('/popups/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { title, type, content, active } = req.body;
    const sets = [];
    const vals = [];

    if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
    if (type !== undefined) { sets.push('type = ?'); vals.push(type); }
    if (content !== undefined) { sets.push('content = ?'); vals.push(JSON.stringify(content)); }
    if (active !== undefined) { sets.push('active = ?'); vals.push(active); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push("updated_at = NOW()");
    vals.push(req.params.id);
    await db.prepare(`UPDATE popups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update popup' });
  }
});

router.delete('/popups/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM popups WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete popup' });
  }
});

router.get('/settings', authenticate, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM settings').all();
    const obj = {};
    for (const r of rows) obj[r.key] = JSON.parse(r.value);
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch settings' });
  }
});

router.put('/settings/:key', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { value } = req.body;
    await db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, NOW()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(req.params.key, JSON.stringify(value));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update setting' });
  }
});

router.get('/leads', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const rows = await db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    const total = (await db.prepare('SELECT COUNT(*) as count FROM leads').get()).count;
    res.json({ leads: rows, total });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch leads' });
  }
});

router.delete('/leads/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete lead' });
  }
});

router.get('/media', authenticate, async (req, res) => {
  try {
    res.json(await db.prepare('SELECT * FROM media ORDER BY created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch media' });
  }
});

router.post('/media/upload', authenticate, requireRole('super_admin', 'admin', 'editor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await db.prepare(
      'INSERT INTO media (filename, original_name, mime_type, size, path, alt_text) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, `/uploads/${req.file.filename}`, req.body.alt_text || '');

    res.status(201).json({
      id: result.lastInsertRowid,
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not upload media' });
  }
});

router.delete('/media/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(uploadsDir, row.filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* serverless: file may not exist */ }

    await db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete media' });
  }
});

router.get('/admins', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await db.prepare('SELECT id, email, name, role, created_at, last_login FROM admins ORDER BY created_at ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch admins' });
  }
});

router.post('/admins', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const validRoles = ['super_admin', 'admin', 'editor'];
    if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const hash = hashPassword(password);
    const result = await db.prepare(
      'INSERT INTO admins (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
    ).run(email, hash, name || '', role || 'editor');

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Could not create admin' });
  }
});

router.delete('/admins/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    if (req.admin.id === parseInt(req.params.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete admin' });
  }
});

export default router;
