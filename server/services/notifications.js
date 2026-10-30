import nodemailer from 'nodemailer';
import db from '../db/index.js';

let transporter = null;

export function initEmail() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log('Email: SMTP not configured — email queue will accumulate but not send');
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  transporter.verify()
    .then(() => console.log('Email: SMTP connection verified'))
    .catch(err => console.error('Email: SMTP verification failed —', err.message));
}

export function queueEmail({ type, recipient, subject, html, body = '', attachmentPath = '', orderId = null }) {
  db.prepare(
    `INSERT INTO email_queue (type, recipient, subject, body, html, attachment_path, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(type, recipient, subject, body, html, attachmentPath || '', orderId);
}

export async function processEmailQueue() {
  if (!transporter) return;

  const pending = db.prepare(
    "SELECT * FROM email_queue WHERE status = 'pending' AND attempts < max_attempts ORDER BY created_at ASC LIMIT 5"
  ).all();

  for (const email of pending) {
    try {
      const mailOpts = {
        from: `"The Sixth Ritu" <${process.env.SMTP_USER}>`,
        to: email.recipient,
        subject: email.subject,
        html: email.html || undefined,
        text: email.body || undefined,
      };

      if (email.attachment_path) {
        mailOpts.attachments = [{ path: email.attachment_path }];
      }

      await transporter.sendMail(mailOpts);

      db.prepare(
        "UPDATE email_queue SET status = 'sent', sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?"
      ).run(email.id);
    } catch (err) {
      db.prepare(
        "UPDATE email_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?"
      ).run(err.message, email.id);

      const updated = db.prepare('SELECT attempts, max_attempts FROM email_queue WHERE id = ?').get(email.id);
      if (updated && updated.attempts >= updated.max_attempts) {
        db.prepare("UPDATE email_queue SET status = 'failed' WHERE id = ?").run(email.id);
        db.prepare(
          "INSERT INTO failed_jobs (job_type, order_id, error, payload) VALUES (?, ?, ?, ?)"
        ).run('email', email.order_id, err.message, JSON.stringify({ type: email.type, recipient: email.recipient }));
      }
    }
  }
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPaise(paise) {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function parseItems(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    return items.map(i => {
      const product = db.prepare('SELECT name, price FROM products WHERE slug = ?').get(i.slug);
      return { ...i, name: product?.name || i.slug, price: product?.price || 0 };
    });
  } catch { return []; }
}

export function queueOrderConfirmation(order) {
  const items = parseItems(order.items);
  const itemRows = items.map(i =>
    `<tr>
      <td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;">${i.name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;text-align:center;">${i.qty}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;text-align:right;">${formatPaise(i.price * i.qty)}</td>
    </tr>`
  ).join('');

  const paymentLabel = order.payment_method === 'cod' ? 'Cash on Delivery' : 'Prepaid (Online)';

  const html = `
  <div style="max-width:600px;margin:0 auto;font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#1a1815;background:#faf8f4;">
    <div style="background:#1a1815;padding:32px;text-align:center;">
      <h1 style="color:#a27d4e;font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;margin:0;letter-spacing:2px;">THE SIXTH RITU</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;color:#1a1815;margin:0 0 8px;">Thank you for your order</h2>
      <p style="color:#6b6560;margin:0 0 24px;">Order <strong>${esc(order.order_number)}</strong> has been ${order.payment_method === 'cod' ? 'placed' : 'confirmed'}.</p>

      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
        <thead>
          <tr style="background:#f0ece5;">
            <th style="padding:10px 16px;text-align:left;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Item</th>
            <th style="padding:10px 16px;text-align:center;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Qty</th>
            <th style="padding:10px 16px;text-align:right;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <table style="width:100%;max-width:280px;margin-left:auto;margin-bottom:24px;">
        <tr><td style="padding:4px 0;color:#6b6560;">Subtotal</td><td style="text-align:right;">${formatPaise(order.subtotal)}</td></tr>
        ${order.discount > 0 ? `<tr><td style="padding:4px 0;color:#6b6560;">Discount</td><td style="text-align:right;color:#a27d4e;">-${formatPaise(order.discount)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#6b6560;">Shipping</td><td style="text-align:right;">Complimentary</td></tr>
        <tr style="font-weight:700;font-size:16px;"><td style="padding:8px 0;border-top:2px solid #1a1815;">Total</td><td style="text-align:right;padding:8px 0;border-top:2px solid #1a1815;">${formatPaise(order.total)}</td></tr>
      </table>

      <div style="background:#f0ece5;padding:20px;border-radius:4px;margin:0 0 24px;">
        <p style="margin:0 0 8px;font-weight:600;">Shipping Details</p>
        <p style="margin:0;color:#6b6560;line-height:1.6;">
          ${esc(order.customer_name)}<br>
          ${esc(order.shipping_address)}<br>
          ${esc(order.shipping_city)}, ${esc(order.shipping_state)} — ${esc(order.shipping_pincode)}<br>
          Phone: ${esc(order.customer_phone)}
        </p>
      </div>

      <p style="margin:0 0 4px;"><strong>Payment:</strong> ${paymentLabel}</p>
      ${order.payment_method === 'cod' ? '<p style="color:#6b6560;margin:0;font-size:13px;">Payment will be collected at delivery.</p>' : ''}

      <hr style="border:none;border-top:1px solid #e8e4dd;margin:24px 0;">
      <p style="color:#6b6560;font-size:13px;margin:0;">If you have any questions, reply to this email or reach us at care@thesixthritu.in</p>
    </div>
    <div style="background:#1a1815;padding:20px;text-align:center;">
      <p style="color:#a27d4e;font-size:12px;margin:0;letter-spacing:1px;">THE SIXTH RITU — THE SEASON OF LUXURY</p>
    </div>
  </div>`;

  queueEmail({
    type: 'order_confirmation',
    recipient: order.customer_email,
    subject: `Order Confirmed — ${order.order_number} | The Sixth Ritu`,
    html,
    orderId: order.id,
  });
}

export function queueOwnerNotification(order) {
  const items = parseItems(order.items);
  const itemList = items.map(i => `${i.name} × ${i.qty}`).join(', ');
  const businessEmail = process.env.BUSINESS_EMAIL;
  if (!businessEmail) return;

  const paymentLabel = order.payment_method === 'cod' ? 'COD' : 'Prepaid';

  const html = `
  <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1815;">
    <h2 style="color:#a27d4e;">New Order — ${order.order_number}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;font-weight:600;width:120px;">Customer</td><td>${esc(order.customer_name)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Email</td><td>${esc(order.customer_email)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Phone</td><td>${esc(order.customer_phone)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Items</td><td>${esc(itemList)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Total</td><td>${formatPaise(order.total)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Payment</td><td>${paymentLabel}${order.payment_status === 'paid' ? ' ✓ Paid' : ' — Pending'}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Address</td><td>${esc(order.shipping_address)}, ${esc(order.shipping_city)}, ${esc(order.shipping_state)} — ${esc(order.shipping_pincode)}</td></tr>
    </table>
  </div>`;

  queueEmail({
    type: 'owner_notification',
    recipient: businessEmail,
    subject: `[TSR] New Order ${order.order_number} — ${formatPaise(order.total)} (${paymentLabel})`,
    html,
    orderId: order.id,
  });
}

export function queueInvoiceEmail(order, invoicePath) {
  if (!order.customer_email) return;

  const html = `
  <div style="max-width:600px;margin:0 auto;font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#1a1815;">
    <div style="background:#1a1815;padding:24px;text-align:center;">
      <h1 style="color:#a27d4e;font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;margin:0;">THE SIXTH RITU</h1>
    </div>
    <div style="padding:24px;">
      <p>Dear ${esc(order.customer_name)},</p>
      <p>Please find attached your GST invoice for order <strong>${esc(order.order_number)}</strong>.</p>
      <p style="color:#6b6560;font-size:13px;margin-top:24px;">This is an automatically generated invoice. For questions, reach us at care@thesixthritu.in</p>
    </div>
  </div>`;

  queueEmail({
    type: 'invoice',
    recipient: order.customer_email,
    subject: `Invoice — ${order.order_number} | The Sixth Ritu`,
    html,
    attachmentPath: invoicePath,
    orderId: order.id,
  });
}
