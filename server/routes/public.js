import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

router.post('/leads', async (req, res) => {
  const { name, phone, dob, source, consent } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
  if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' });
  if (!consent) return res.status(400).json({ error: 'Consent required' });

  try {
    const existing = await db.prepare('SELECT id FROM leads WHERE phone = ?').get(phone.trim());
    if (existing) return res.json({ ok: true, duplicate: true });

    await db.prepare(
      'INSERT INTO leads (name, phone, dob, source) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), phone.trim(), dob || '', source || 'popup');

    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not save lead' });
  }
});

router.get('/products', async (_req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT slug, name, subtitle, character, notes, description, price, image, mood FROM products WHERE active = 1 ORDER BY sort_order ASC'
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch products' });
  }
});

router.get('/reviews', async (req, res) => {
  try {
    const slug = req.query.product;
    let query = 'SELECT product_slug, customer_name, rating, text, verified_purchase, created_at FROM reviews WHERE approved = 1';
    const params = [];
    if (slug) {
      query += ' AND product_slug = ?';
      params.push(slug);
    }
    query += ' ORDER BY created_at DESC LIMIT 20';
    res.json(await db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch reviews' });
  }
});

router.get('/settings/:key', async (req, res) => {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key);
    if (!row) return res.status(404).json({ error: 'Setting not found' });
    res.json(JSON.parse(row.value));
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch setting' });
  }
});

router.get('/popups/active', async (_req, res) => {
  try {
    const row = await db.prepare(
      "SELECT id, title, type, content FROM popups WHERE active = 1 ORDER BY updated_at DESC LIMIT 1"
    ).get();
    if (!row) return res.json(null);
    try { row.content = JSON.parse(row.content); } catch { row.content = {}; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch popup' });
  }
});

router.get('/pages/:slug', async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT slug, title, content FROM pages WHERE slug = ? AND published = 1'
    ).get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Page not found' });
    try { row.content = JSON.parse(row.content); } catch { row.content = {}; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch page' });
  }
});

router.get('/pages', async (_req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT slug, title, content FROM pages WHERE published = 1 ORDER BY created_at DESC'
    ).all();
    rows.forEach(r => { try { r.content = JSON.parse(r.content); } catch { r.content = {}; } });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch pages' });
  }
});

router.get('/coupons/validate', async (req, res) => {
  try {
    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ error: 'Code required' });
    const row = await db.prepare(
      'SELECT code, discount_amount, min_cart, max_uses, current_uses, active, expires_at FROM coupons WHERE code = ?'
    ).get(code);
    if (!row || !row.active) return res.json({ valid: false });
    if (row.max_uses > 0 && row.current_uses >= row.max_uses) return res.json({ valid: false });
    if (row.expires_at && new Date(row.expires_at) < new Date()) return res.json({ valid: false });
    res.json({ valid: true, code: row.code, discount: row.discount_amount, minCart: row.min_cart });
  } catch (err) {
    res.status(500).json({ error: 'Could not validate coupon' });
  }
});

export default router;
