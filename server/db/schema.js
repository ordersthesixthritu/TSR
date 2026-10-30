import db from './index.js';
import bcrypt from 'bcryptjs';

export async function initDatabase() {
  const schemaCheck = await db.prepare(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admins'"
  ).get();
  if (schemaCheck) {
    console.log('Database: schema already exists — running migrations');
    await runMigrations();
    return;
  }
  console.log('Database: creating schema...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('super_admin','admin','editor')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login TIMESTAMPTZ
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'fixed',
      max_discount INTEGER NOT NULL DEFAULT 0,
      min_cart INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      current_uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      product_slug TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
      text TEXT NOT NULL DEFAULT '',
      verified_purchase INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS popups (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'welcome',
      content TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{}',
      published INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      dob TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'popup',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL DEFAULT '',
      alt_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id SERIAL PRIMARY KEY,
      event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
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
      pdf_data TEXT NOT NULL DEFAULT '',
      email_sent INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS failed_jobs (
      id SERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      order_id INTEGER,
      error TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      retry_count INTEGER NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_counter (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      current_number INTEGER NOT NULL DEFAULT 0,
      prefix TEXT NOT NULL DEFAULT 'TSR',
      financial_year TEXT NOT NULL DEFAULT '2026-27'
    )
  `);

  const existing = await db.prepare('SELECT id FROM invoice_counter WHERE id = 1').get();
  if (!existing) {
    await db.prepare('INSERT INTO invoice_counter (id, current_number, prefix, financial_year) VALUES (1, 0, ?, ?)').run('TSR', '2026-27');
  }

  await seedAdmin();
  await seedProducts();
  await seedCoupons();
}

async function seedAdmin() {
  const existing = await db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (existing) return;

  const email = process.env.ADMIN_EMAIL || 'admin@thesixthritu.com';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = bcrypt.hashSync(password, 12);

  await db.prepare(
    'INSERT INTO admins (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, hash, 'Admin', 'super_admin');

  console.log(`Seeded admin: ${email}`);
}

async function seedProducts() {
  const existing = await db.prepare('SELECT id FROM products LIMIT 1').get();
  if (existing) return;

  const products = [
    ['dark-monsoon', 'Dark Monsoon', 'The Power After the Storm', 'Deep • Earthy • Mysterious', 'Rain • Earth • Oud', 'Deep, atmospheric and quietly commanding. Dark Monsoon captures the feeling of rain settling into the earth — where freshness meets depth and oud leaves behind a powerful, lingering presence.', 149900, '/products/dark Monsoon.png', 'bold', 1],
    ['royal-zafran-rose', 'Royal Zafran Rose', 'A Royal Evening Ritual', 'Rich • Floral • Opulent', 'Saffron • Rose • Amber', 'Opulent and regal. Royal Zafran Rose pairs the warmth of Indian saffron with the depth of heritage rose — a fragrance that lingers like a rich evening melody.', 149900, '/products/royal zefran rose.png', 'warm', 2],
    ['golden-ritual', 'Golden Ritual', 'The Evening You Deserve', 'Warm • Sensual • Enveloping', 'Amber • Vanilla • Sandalwood', 'Warm, enveloping and deeply personal. Golden Ritual captures the feeling of a perfect evening — where amber and vanilla meet sandalwood in a quiet celebration of presence.', 149900, '/products/golden ritual.png', 'warm', 3],
    ['golden-leaf', 'Golden Leaf', 'The Brightness of a New Day', 'Bright • Fresh • Uplifting', 'Citrus • Green Tea • Vetiver', 'Bright, optimistic and effortlessly uplifting. Golden Leaf captures the clarity of morning light — where citrus freshness meets green tea and settles into a grounded vetiver base.', 149900, '/products/golden leaf.png', 'fresh', 4],
    ['crystal-bloom', 'Crystal Bloom', 'The Clarity of Morning Light', 'Clean • Luminous • Airy', 'White Floral • Dew • Musk', 'Clean, luminous and quietly beautiful. Crystal Bloom captures the first light of morning — where white florals meet a delicate dewdrop freshness and settle into a soft, lasting musk.', 149900, '/products/crystal bloom.png', 'fresh', 5],
    ['flora-silk', 'Flora Silk', 'Where Softness Meets Strength', 'Soft • Floral • Graceful', 'Jasmine • Peony • Silk Musk', 'Soft, graceful and quietly confident. Flora Silk weaves jasmine and peony into a delicate bouquet — a fragrance that feels like wearing silk against the skin.', 149900, '/products/flora silk.png', 'floral', 6],
  ];

  for (const p of products) {
    await db.prepare(
      'INSERT INTO products (slug, name, subtitle, character, notes, description, price, image, mood, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(...p);
  }
  console.log('Seeded 6 products');
}

async function runMigrations() {
  try {
    const colCheck = await db.prepare(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'coupons' AND column_name = 'discount_type'"
    ).get();
    if (!colCheck) {
      await db.exec("ALTER TABLE coupons ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'fixed'");
      await db.exec("ALTER TABLE coupons ADD COLUMN max_discount INTEGER NOT NULL DEFAULT 0");
      console.log('Migration: added discount_type and max_discount to coupons');
    }
  } catch (err) {
    console.error('Migration error:', err.message);
  }
  await ensureAdmin();
  await seedCoupons();
}

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (existing) return;

  const admins = await db.prepare('SELECT id, email FROM admins').all();
  if (admins.length === 1 && admins[0].email === 'admin@thesixthritu.com') {
    const hash = bcrypt.hashSync(password, 12);
    await db.prepare('UPDATE admins SET email = ?, password_hash = ?, role = ? WHERE id = ?')
      .run(email, hash, 'super_admin', admins[0].id);
    console.log(`Updated default admin to ${email}`);
    return;
  }

  if (admins.length === 0) {
    const hash = bcrypt.hashSync(password, 12);
    await db.prepare('INSERT INTO admins (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(email, hash, 'Admin', 'super_admin');
    console.log(`Seeded admin: ${email}`);
  }
}

async function seedCoupons() {
  const existing = await db.prepare('SELECT id FROM coupons WHERE code = ?').get('TSR200');
  if (!existing) {
    await db.prepare(
      "INSERT INTO coupons (code, discount_amount, discount_type, min_cart, max_uses, active) VALUES (?, ?, 'fixed', ?, ?, ?)"
    ).run('TSR200', 20000, 149900, 0, 1);
    console.log('Seeded coupon TSR200');
  }

  const familyCoupons = [
    ['BST', 30],
    ['SKV', 30],
    ['PPV', 30],
  ];
  for (const [code, pct] of familyCoupons) {
    const exists = await db.prepare('SELECT id FROM coupons WHERE code = ?').get(code);
    if (!exists) {
      await db.prepare(
        "INSERT INTO coupons (code, discount_amount, discount_type, min_cart, max_uses, active) VALUES (?, ?, 'percentage', ?, ?, ?)"
      ).run(code, pct, 0, 0, 1);
      console.log(`Seeded family coupon ${code} (${pct}%)`);
    }
  }
}
