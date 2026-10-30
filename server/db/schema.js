import db from './index.js';
import bcrypt from 'bcryptjs';

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('super_admin','admin','editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      character TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT NOT NULL DEFAULT 'prepaid',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      shipping_address TEXT NOT NULL DEFAULT '',
      shipping_city TEXT NOT NULL DEFAULT '',
      shipping_state TEXT NOT NULL DEFAULT '',
      shipping_pincode TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      coupon_used TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      invoice_url TEXT NOT NULL DEFAULT '',
      tracking_number TEXT NOT NULL DEFAULT '',
      courier TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      min_cart INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      current_uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_slug TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
      text TEXT NOT NULL DEFAULT '',
      verified_purchase INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS popups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'welcome',
      content TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{}',
      published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      dob TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'popup',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL DEFAULT '',
      alt_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      taxable_amount INTEGER NOT NULL DEFAULT 0,
      cgst INTEGER NOT NULL DEFAULT 0,
      sgst INTEGER NOT NULL DEFAULT 0,
      igst INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      pdf_path TEXT NOT NULL DEFAULT '',
      email_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      attachment_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT NOT NULL DEFAULT '',
      order_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS failed_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      order_id INTEGER,
      error TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      retry_count INTEGER NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_counter (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      current_number INTEGER NOT NULL DEFAULT 0,
      prefix TEXT NOT NULL DEFAULT 'TSR',
      financial_year TEXT NOT NULL DEFAULT '2026-27'
    );
  `);

  // Seed invoice counter
  try {
    const existing = db.prepare('SELECT id FROM invoice_counter WHERE id = 1').get();
    if (!existing) {
      db.prepare('INSERT INTO invoice_counter (id, current_number, prefix, financial_year) VALUES (1, 0, ?, ?)').run('TSR', '2026-27');
    }
  } catch { /* already exists */ }

  migrateOrders();
  seedAdmin();
  seedProducts();
  seedCoupons();
}

function migrateOrders() {
  // Check if orders table has old CHECK constraint on status column
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes("CHECK(status IN")) {
      console.log('Migrating orders table: removing old CHECK constraint on status');
      db.exec(`
        CREATE TABLE orders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT UNIQUE NOT NULL,
          razorpay_order_id TEXT,
          razorpay_payment_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          payment_method TEXT NOT NULL DEFAULT 'prepaid',
          payment_status TEXT NOT NULL DEFAULT 'unpaid',
          customer_name TEXT NOT NULL DEFAULT '',
          customer_email TEXT NOT NULL DEFAULT '',
          customer_phone TEXT NOT NULL DEFAULT '',
          shipping_address TEXT NOT NULL DEFAULT '',
          shipping_city TEXT NOT NULL DEFAULT '',
          shipping_state TEXT NOT NULL DEFAULT '',
          shipping_pincode TEXT NOT NULL DEFAULT '',
          items TEXT NOT NULL DEFAULT '[]',
          subtotal INTEGER NOT NULL DEFAULT 0,
          discount INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          coupon_used TEXT NOT NULL DEFAULT '',
          invoice_number TEXT NOT NULL DEFAULT '',
          invoice_url TEXT NOT NULL DEFAULT '',
          tracking_number TEXT NOT NULL DEFAULT '',
          courier TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO orders_new (id, order_number, razorpay_order_id, razorpay_payment_id, status, customer_name, customer_email, customer_phone, shipping_address, items, subtotal, discount, total, coupon_used, created_at, updated_at)
          SELECT id, order_number, razorpay_order_id, razorpay_payment_id, status, customer_name, customer_email, customer_phone, shipping_address, items, subtotal, discount, total, coupon_used, created_at, updated_at FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_new RENAME TO orders;
      `);
      console.log('Orders table migrated successfully');
      return;
    }
  } catch { /* fresh database, no migration needed */ }

  // Add new columns to orders if they don't exist (safe for existing databases)
  const cols = ['payment_method', 'payment_status', 'shipping_city', 'shipping_state', 'shipping_pincode', 'invoice_number', 'invoice_url', 'tracking_number', 'courier', 'notes'];
  const defaults = {
    payment_method: "'prepaid'",
    payment_status: "'unpaid'",
    shipping_city: "''",
    shipping_state: "''",
    shipping_pincode: "''",
    invoice_number: "''",
    invoice_url: "''",
    tracking_number: "''",
    courier: "''",
    notes: "''",
  };

  for (const col of cols) {
    try {
      db.prepare(`SELECT ${col} FROM orders LIMIT 1`).get();
    } catch {
      try {
        db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${defaults[col]}`);
        console.log(`Migrated orders: added column ${col}`);
      } catch (e) {
        // Column might already exist in newer schema
      }
    }
  }
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (existing) return;

  const email = process.env.ADMIN_EMAIL || 'admin@thesixthritu.com';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = bcrypt.hashSync(password, 12);

  db.prepare(
    'INSERT INTO admins (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, hash, 'Admin', 'super_admin');

  console.log(`Seeded admin: ${email}`);
}

function seedProducts() {
  const existing = db.prepare('SELECT id FROM products LIMIT 1').get();
  if (existing) return;

  const insert = db.prepare(
    'INSERT INTO products (slug, name, subtitle, character, notes, description, price, image, mood, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const products = [
    ['dark-monsoon', 'Dark Monsoon', 'The Power After the Storm', 'Deep • Earthy • Mysterious', 'Rain • Earth • Oud', 'Deep, atmospheric and quietly commanding. Dark Monsoon captures the feeling of rain settling into the earth — where freshness meets depth and oud leaves behind a powerful, lingering presence.', 149900, '/products/dark Monsoon.png', 'bold', 1],
    ['royal-zafran-rose', 'Royal Zafran Rose', 'A Royal Evening Ritual', 'Rich • Floral • Opulent', 'Saffron • Rose • Amber', 'Opulent and regal. Royal Zafran Rose pairs the warmth of Indian saffron with the depth of heritage rose — a fragrance that lingers like a rich evening melody.', 149900, '/products/royal zefran rose.png', 'warm', 2],
    ['golden-ritual', 'Golden Ritual', 'The Evening You Deserve', 'Warm • Sensual • Enveloping', 'Amber • Vanilla • Sandalwood', 'Warm, enveloping and deeply personal. Golden Ritual captures the feeling of a perfect evening — where amber and vanilla meet sandalwood in a quiet celebration of presence.', 149900, '/products/golden ritual.png', 'warm', 3],
    ['golden-leaf', 'Golden Leaf', 'The Brightness of a New Day', 'Bright • Fresh • Uplifting', 'Citrus • Green Tea • Vetiver', 'Bright, optimistic and effortlessly uplifting. Golden Leaf captures the clarity of morning light — where citrus freshness meets green tea and settles into a grounded vetiver base.', 149900, '/products/golden leaf.png', 'fresh', 4],
    ['crystal-bloom', 'Crystal Bloom', 'The Clarity of Morning Light', 'Clean • Luminous • Airy', 'White Floral • Dew • Musk', 'Clean, luminous and quietly beautiful. Crystal Bloom captures the first light of morning — where white florals meet a delicate dewdrop freshness and settle into a soft, lasting musk.', 149900, '/products/crystal bloom.png', 'fresh', 5],
    ['flora-silk', 'Flora Silk', 'Where Softness Meets Strength', 'Soft • Floral • Graceful', 'Jasmine • Peony • Silk Musk', 'Soft, graceful and quietly confident. Flora Silk weaves jasmine and peony into a delicate bouquet — a fragrance that feels like wearing silk against the skin.', 149900, '/products/flora silk.png', 'floral', 6],
  ];

  const tx = db.transaction(() => {
    for (const p of products) insert.run(...p);
  });
  tx();
  console.log('Seeded 6 products');
}

function seedCoupons() {
  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get('TSR200');
  if (existing) return;

  db.prepare(
    'INSERT INTO coupons (code, discount_amount, min_cart, max_uses, active) VALUES (?, ?, ?, ?, ?)'
  ).run('TSR200', 20000, 149900, 0, 1);

  console.log('Seeded coupon TSR200');
}
