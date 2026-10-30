import { Router } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import db from '../db/index.js';
import { queueOrderConfirmation, queueOwnerNotification, queueInvoiceEmail, processEmailQueue } from '../services/notifications.js';
import { syncOrderToSheet, updateOrderInSheet } from '../services/sheets.js';
import { generateInvoice } from '../services/invoice.js';

const router = Router();

let _razorpay;
function getRazorpay() {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials not configured');
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

async function validateCart(items) {
  let total = 0;
  for (const item of items) {
    const product = await db.prepare('SELECT price FROM products WHERE slug = ? AND active = 1').get(item.slug);
    if (!product) return null;
    if (item.qty < 1 || item.qty > 10) return null;
    total += product.price * item.qty;
  }
  return total;
}

async function validateCoupon(code, cartTotal) {
  if (!code) return 0;
  const c = await db.prepare('SELECT discount_amount, discount_type, max_discount, min_cart, max_uses, current_uses, active, expires_at FROM coupons WHERE code = ?').get(code.toUpperCase());
  if (!c || !c.active) return 0;
  if (c.max_uses > 0 && c.current_uses >= c.max_uses) return 0;
  if (c.expires_at && new Date(c.expires_at) < new Date()) return 0;
  if (cartTotal < c.min_cart) return 0;
  if (c.discount_type === 'percentage') {
    let discount = Math.round(cartTotal * c.discount_amount / 100);
    if (c.max_discount > 0 && discount > c.max_discount) discount = c.max_discount;
    return discount;
  }
  return c.discount_amount;
}

function generateOrderNumber() {
  return `TSR-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeCustomer(raw) {
  if (!raw) return null;
  const phone = (raw.phone || raw.mobile || '').replace(/\s/g, '');
  const addr1 = (raw.address || raw.address1 || '').trim();
  const addr2 = (raw.address2 || '').trim();
  const landmark = (raw.landmark || '').trim();
  const address = [addr1, addr2, landmark].filter(Boolean).join(', ');
  return {
    name: (raw.name || '').trim(),
    email: (raw.email || '').trim().toLowerCase(),
    phone,
    address,
    city: (raw.city || '').trim(),
    state: raw.state || '',
    pincode: raw.pincode || raw.pin || '',
  };
}

function validateCustomer(customer) {
  if (!customer) return 'Customer details required';
  if (!customer.name || customer.name.length < 2) return 'Full name is required';
  if (!customer.phone || !/^[6-9]\d{9}$/.test(customer.phone)) return 'Valid 10-digit Indian mobile number required';
  if (!customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return 'Valid email address required';
  if (!customer.address || customer.address.length < 5) return 'Shipping address required';
  if (!customer.city || customer.city.length < 2) return 'City is required';
  if (!customer.state) return 'State is required';
  if (!customer.pincode || !/^\d{6}$/.test(customer.pincode)) return 'Valid 6-digit pincode required';
  return null;
}

router.post('/create-order', async (req, res) => {
  try {
    const { items, coupon, customer: rawCustomer, paymentMethod } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const customer = normalizeCustomer(rawCustomer);
    const customerError = validateCustomer(customer);
    if (customerError) return res.status(400).json({ error: customerError });

    let total = await validateCart(items);
    if (total === null) return res.status(400).json({ error: 'Invalid cart' });

    const subtotal = total;
    const discount = await validateCoupon(coupon, total);
    total = Math.max(0, total - discount);

    const orderNumber = generateOrderNumber();

    if (paymentMethod === 'cod') {
      await db.prepare(
        `INSERT INTO orders (order_number, status, payment_method, payment_status, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_state, shipping_pincode, items, subtotal, discount, total, coupon_used)
         VALUES (?, 'confirmed', 'cod', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        orderNumber,
        customer.name, customer.email, customer.phone,
        customer.address, customer.city, customer.state, customer.pincode,
        JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
        subtotal, discount, total,
        coupon || ''
      );

      if (coupon) {
        await db.prepare('UPDATE coupons SET current_uses = current_uses + 1 WHERE code = ?').run(coupon.toUpperCase());
      }

      const order = await db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
      handlePostOrder(order);

      return res.json({
        success: true,
        orderNumber,
        paymentMethod: 'cod',
        total,
      });
    }

    const rzpOrder = await getRazorpay().orders.create({
      amount: total,
      currency: 'INR',
      receipt: orderNumber,
      notes: {
        items: JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
        coupon: coupon || '',
        customer_name: customer.name,
        customer_phone: customer.phone,
      },
    });

    await db.prepare(
      `INSERT INTO orders (order_number, razorpay_order_id, status, payment_method, payment_status, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_state, shipping_pincode, items, subtotal, discount, total, coupon_used)
       VALUES (?, ?, 'pending', 'prepaid', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderNumber, rzpOrder.id,
      customer.name, customer.email, customer.phone,
      customer.address, customer.city, customer.state, customer.pincode,
      JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
      subtotal, discount, total,
      coupon || ''
    );

    res.json({
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderNumber,
      prefill: {
        name: customer.name,
        email: customer.email,
        contact: customer.phone,
      },
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: 'Could not create order' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const existing = await db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.payment_status === 'paid') {
      return res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id, orderNumber: existing.order_number, note: 'Already verified' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(razorpay_signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    await db.prepare(
      "UPDATE orders SET razorpay_payment_id = ?, status = 'confirmed', payment_status = 'paid', updated_at = NOW() WHERE razorpay_order_id = ? AND status = 'pending'"
    ).run(razorpay_payment_id, razorpay_order_id);

    if (existing.coupon_used) {
      await db.prepare('UPDATE coupons SET current_uses = current_uses + 1 WHERE code = ?').run(existing.coupon_used);
    }

    const order = await db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(razorpay_order_id);
    handlePostOrder(order);

    res.json({ verified: true, orderId: razorpay_order_id, paymentId: razorpay_payment_id, orderNumber: order.order_number });
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature header' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    const eventId = event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.id || `evt_${Date.now()}`;
    const orderId = event.payload?.payment?.entity?.order_id;
    const paymentId = event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.payment_id;

    const dup = await db.prepare('SELECT id FROM webhook_events WHERE event_id = ?').get(eventId);
    if (dup) return res.json({ status: 'ok', note: 'duplicate' });

    await db.prepare(
      'INSERT INTO webhook_events (event_id, event_type, razorpay_order_id, razorpay_payment_id, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(eventId, event.event, orderId || '', paymentId || '', rawBody);

    switch (event.event) {
      case 'payment.captured': {
        const order = await db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(orderId);
        if (order && order.payment_status !== 'paid') {
          await db.prepare(
            "UPDATE orders SET status = 'confirmed', payment_status = 'paid', razorpay_payment_id = ?, updated_at = NOW() WHERE razorpay_order_id = ?"
          ).run(paymentId, orderId);

          const updated = await db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(orderId);
          handlePostOrder(updated);
        }
        break;
      }
      case 'payment.failed': {
        await db.prepare(
          "UPDATE orders SET status = 'failed', payment_status = 'failed', updated_at = NOW() WHERE razorpay_order_id = ? AND status = 'pending'"
        ).run(orderId);
        break;
      }
      case 'refund.created': {
        const refundPaymentId = event.payload.refund.entity.payment_id;
        await db.prepare(
          "UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE razorpay_payment_id = ?"
        ).run(refundPaymentId);

        const refundedOrder = await db.prepare('SELECT order_number FROM orders WHERE razorpay_payment_id = ?').get(refundPaymentId);
        if (refundedOrder) {
          updateOrderInSheet(refundedOrder.order_number, { payment_status: 'refunded' }).catch(() => {});
        }
        break;
      }
    }

    await db.prepare('UPDATE webhook_events SET processed = 1 WHERE event_id = ?').run(eventId);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.get('/order-status/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { email, phone } = req.query;

    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone required for verification' });
    }

    const order = await db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const emailMatch = email && order.customer_email === email.trim().toLowerCase();
    const phoneMatch = phone && order.customer_phone === phone.replace(/\s/g, '');
    if (!emailMatch && !phoneMatch) {
      return res.status(403).json({ error: 'Verification failed — email or phone does not match' });
    }

    const rawItems = JSON.parse(order.items || '[]');
    const items = [];
    for (const i of rawItems) {
      const product = await db.prepare('SELECT name, price, image FROM products WHERE slug = ?').get(i.slug);
      items.push({ slug: i.slug, qty: i.qty, name: product?.name || i.slug, price: product?.price || 0, image: product?.image || '' });
    }

    res.json({
      orderNumber: order.order_number,
      status: order.status,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      items,
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.total,
      trackingNumber: order.tracking_number || null,
      courier: order.courier || null,
      invoiceNumber: order.invoice_number || null,
      createdAt: order.created_at,
    });
  } catch (err) {
    console.error('order-status error:', err);
    res.status(500).json({ error: 'Could not fetch order status' });
  }
});

router.get('/invoice/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { email, phone } = req.query;
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone required for verification' });
    }
    const order = await db.prepare('SELECT customer_email, customer_phone FROM orders WHERE order_number = ?').get(orderNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const emailMatch = email && order.customer_email === email.trim().toLowerCase();
    const phoneMatch = phone && order.customer_phone === phone.replace(/\s/g, '');
    if (!emailMatch && !phoneMatch) {
      return res.status(403).json({ error: 'Verification failed' });
    }
    const invoice = await db.prepare('SELECT pdf_data, invoice_number FROM invoices WHERE order_number = ?').get(orderNumber);
    if (!invoice || !invoice.pdf_data) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const buffer = Buffer.from(invoice.pdf_data, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${orderNumber}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('invoice download error:', err);
    res.status(500).json({ error: 'Could not download invoice' });
  }
});

const _postOrderProcessed = new Set();

function handlePostOrder(order) {
  if (!order) return;
  if (_postOrderProcessed.has(order.order_number)) return;
  _postOrderProcessed.add(order.order_number);

  (async () => {
    try {
      const existing = await db.prepare('SELECT id FROM invoices WHERE order_number = ?').get(order.order_number);
      if (existing) {
        console.log(`post-order: already processed ${order.order_number} — skipping`);
        return;
      }

      await queueOrderConfirmation(order);
      await queueOwnerNotification(order);

      if (order.payment_status === 'paid') {
        const result = await generateInvoice(order);
        if (result) {
          await queueInvoiceEmail(order, result.pdfBuffer);
        }
      }

      await syncOrderToSheet(order);
    } catch (err) {
      console.error('post-order automation error:', err);
      try {
        await db.prepare(
          "INSERT INTO failed_jobs (job_type, order_id, error, payload) VALUES (?, ?, ?, ?)"
        ).run('post_order', order.id, err.message, JSON.stringify({ order_number: order.order_number }));
      } catch { /* best effort */ }
    } finally {
      setTimeout(() => _postOrderProcessed.delete(order.order_number), 60000);
    }
  })();
}

export default router;
