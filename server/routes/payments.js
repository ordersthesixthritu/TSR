import { Router } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import db from '../db/index.js';

const router = Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function validateCart(items) {
  let total = 0;
  for (const item of items) {
    const product = db.prepare('SELECT price FROM products WHERE slug = ? AND active = 1').get(item.slug);
    if (!product) return null;
    if (item.qty < 1 || item.qty > 10) return null;
    total += product.price * item.qty;
  }
  return total;
}

function validateCoupon(code, cartTotal) {
  if (!code) return 0;
  const c = db.prepare('SELECT discount_amount, min_cart, max_uses, current_uses, active, expires_at FROM coupons WHERE code = ?').get(code.toUpperCase());
  if (!c || !c.active) return 0;
  if (c.max_uses > 0 && c.current_uses >= c.max_uses) return 0;
  if (c.expires_at && new Date(c.expires_at) < new Date()) return 0;
  if (cartTotal < c.min_cart) return 0;
  return c.discount_amount;
}

router.post('/create-order', async (req, res) => {
  try {
    const { items, coupon } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let total = validateCart(items);
    if (total === null) return res.status(400).json({ error: 'Invalid cart' });

    const discount = validateCoupon(coupon, total);
    total = Math.max(0, total - discount);

    const order = await razorpay.orders.create({
      amount: total,
      currency: 'INR',
      receipt: `tsr_${Date.now()}`,
      notes: {
        items: JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
        coupon: coupon || '',
      },
    });

    const orderNumber = `TSR-${Date.now().toString(36).toUpperCase()}`;
    db.prepare(
      `INSERT INTO orders (order_number, razorpay_order_id, status, items, subtotal, discount, total, coupon_used)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
    ).run(
      orderNumber, order.id,
      JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
      total + discount,
      discount,
      total,
      coupon || ''
    );

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderNumber,
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: 'Could not create order' });
  }
});

router.post('/verify', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const existing = db.prepare('SELECT status FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.status === 'paid') {
      const saved = db.prepare('SELECT order_number FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
      return res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id, orderNumber: saved?.order_number, note: 'Already verified' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    db.prepare(
      "UPDATE orders SET razorpay_payment_id = ?, status = 'paid', updated_at = datetime('now') WHERE razorpay_order_id = ? AND status = 'pending'"
    ).run(razorpay_payment_id, razorpay_order_id);

    const savedOrder = db.prepare('SELECT order_number, coupon_used FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
    if (savedOrder?.coupon_used) {
      db.prepare('UPDATE coupons SET current_uses = current_uses + 1 WHERE code = ?').run(savedOrder.coupon_used);
    }

    res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id, orderNumber: savedOrder?.order_number });
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/webhook', (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    const orderId = event.payload?.payment?.entity?.order_id;
    const paymentId = event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.payment_id;

    switch (event.event) {
      case 'payment.captured': {
        const order = db.prepare('SELECT status FROM orders WHERE razorpay_order_id = ?').get(orderId);
        if (order && order.status !== 'paid') {
          db.prepare("UPDATE orders SET status = 'paid', razorpay_payment_id = ?, updated_at = datetime('now') WHERE razorpay_order_id = ?")
            .run(paymentId, orderId);
        }
        break;
      }
      case 'payment.failed':
        db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE razorpay_order_id = ? AND status = 'pending'")
          .run(orderId);
        break;
      case 'refund.created':
        db.prepare("UPDATE orders SET status = 'refunded', updated_at = datetime('now') WHERE razorpay_payment_id = ?")
          .run(event.payload.refund.entity.payment_id);
        break;
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
