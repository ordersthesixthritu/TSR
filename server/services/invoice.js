import PDFDocument from 'pdfkit';
import db from '../db/index.js';

async function getNextInvoiceNumber() {
  const counter = await db.prepare(
    'UPDATE invoice_counter SET current_number = current_number + 1 WHERE id = 1 RETURNING current_number, prefix, financial_year'
  ).get();
  if (!counter) throw new Error('Invoice counter not initialized');

  const fy = counter.financial_year.replace('-', '');
  return `${counter.prefix}/${fy}/${String(counter.current_number).padStart(4, '0')}`;
}

async function parseItems(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    const resolved = [];
    for (const i of items) {
      const product = await db.prepare('SELECT name, price FROM products WHERE slug = ?').get(i.slug);
      resolved.push({ slug: i.slug, qty: i.qty, name: product?.name || i.slug, price: product?.price || 0 });
    }
    return resolved;
  } catch { return []; }
}

export async function generateInvoice(order) {
  const invoiceNumber = await getNextInvoiceNumber();
  const items = await parseItems(order.items);

  const pdfBuffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const p = (paise) => '₹' + (paise / 100).toFixed(2);
    const gold = '#a27d4e';
    const charcoal = '#1a1815';
    const grey = '#6b6560';

    doc.fontSize(22).fillColor(gold).text('THE SIXTH RITU', 50, 50, { align: 'center' });
    doc.fontSize(9).fillColor(grey).text('The Season of Luxury', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(charcoal).text('INVOICE', { align: 'center' });
    doc.moveDown(1);

    const topY = doc.y;
    doc.fontSize(9).fillColor(grey);
    doc.text(`Invoice No: ${invoiceNumber}`, 50, topY);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 50);
    doc.text(`Order No: ${order.order_number}`, 50);

    doc.fontSize(9).fillColor(grey);
    doc.text('Sold By:', 350, topY);
    doc.fillColor(charcoal).text(process.env.SELLER_NAME || 'The Sixth Ritu', 350);
    doc.fillColor(grey).text(process.env.SELLER_ADDRESS || '', 350, undefined, { width: 200 });
    doc.moveDown(1.5);

    const buyerY = doc.y;
    doc.fillColor(grey).text('Bill To / Ship To:', 50, buyerY);
    doc.fillColor(charcoal).fontSize(10).text(order.customer_name, 50);
    doc.fontSize(9).fillColor(grey);
    doc.text(order.shipping_address, 50, undefined, { width: 250 });
    doc.text(`${order.shipping_city}, ${order.shipping_state} — ${order.shipping_pincode}`);
    doc.text(`Phone: ${order.customer_phone}`);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`);
    doc.moveDown(1.5);

    const tableTop = doc.y;
    const colX = { item: 50, qty: 330, rate: 390, amount: 460 };

    doc.rect(50, tableTop, 500, 20).fill('#f0ece5');
    doc.fontSize(8).fillColor(charcoal);
    doc.text('Item', colX.item + 6, tableTop + 5);
    doc.text('Qty', colX.qty + 6, tableTop + 5);
    doc.text('Rate', colX.rate + 6, tableTop + 5);
    doc.text('Amount', colX.amount + 6, tableTop + 5);

    let rowY = tableTop + 22;
    for (const item of items) {
      const lineTotal = item.price * item.qty;
      doc.fontSize(9).fillColor(charcoal);
      doc.text(item.name, colX.item + 6, rowY, { width: 270 });
      doc.text(String(item.qty), colX.qty + 6, rowY);
      doc.text(p(item.price), colX.rate + 6, rowY);
      doc.text(p(lineTotal), colX.amount + 6, rowY);
      rowY += 18;
    }

    doc.moveTo(50, rowY).lineTo(550, rowY).stroke('#e8e4dd');
    rowY += 10;

    const labelX = 380;
    const valX = 460;

    doc.fontSize(9).fillColor(grey);
    doc.text('Subtotal', labelX, rowY);
    doc.fillColor(charcoal).text(p(order.subtotal), valX, rowY, { align: 'right', width: 90 });
    rowY += 16;

    if (order.discount > 0) {
      doc.fillColor(grey).text('Discount', labelX, rowY);
      doc.fillColor(gold).text(`-${p(order.discount)}`, valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    }

    doc.fillColor(grey).text('Shipping', labelX, rowY);
    doc.fillColor(charcoal).text('Complimentary', valX, rowY, { align: 'right', width: 90 });
    rowY += 18;

    doc.moveTo(labelX, rowY).lineTo(550, rowY).stroke(charcoal);
    rowY += 6;
    doc.fontSize(11).fillColor(charcoal).text('Total', labelX, rowY);
    doc.text(p(order.total), valX, rowY, { align: 'right', width: 90 });
    rowY += 18;

    doc.fontSize(8).fillColor(grey).text('All prices are inclusive of applicable taxes.', labelX, rowY);

    doc.fontSize(8).fillColor(grey);
    doc.text('This is a computer-generated invoice. No signature required.', 50, 750, { align: 'center', width: 500 });

    doc.end();
  });

  const pdfBase64 = pdfBuffer.toString('base64');

  await db.prepare(
    `INSERT INTO invoices (invoice_number, order_id, order_number, customer_name, customer_email, taxable_amount, cgst, sgst, igst, total_amount, pdf_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(invoiceNumber, order.id, order.order_number, order.customer_name, order.customer_email, 0, 0, 0, 0, order.total, pdfBase64);

  await db.prepare(
    "UPDATE orders SET invoice_number = ?, invoice_url = ?, updated_at = NOW() WHERE id = ?"
  ).run(invoiceNumber, `/api/payments/invoice/${order.order_number}`, order.id);

  return { invoiceNumber, pdfBuffer };
}
