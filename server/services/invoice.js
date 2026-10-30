import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoiceDir = path.join(__dirname, '..', 'data', 'invoices');

if (!fs.existsSync(invoiceDir)) fs.mkdirSync(invoiceDir, { recursive: true });

function getNextInvoiceNumber() {
  const counter = db.prepare('SELECT current_number, prefix, financial_year FROM invoice_counter WHERE id = 1').get();
  if (!counter) throw new Error('Invoice counter not initialized');

  const next = counter.current_number + 1;
  db.prepare('UPDATE invoice_counter SET current_number = ? WHERE id = 1').run(next);

  const fy = counter.financial_year.replace('-', '');
  return `${counter.prefix}/${fy}/${String(next).padStart(4, '0')}`;
}

function parseItems(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    return items.map(i => {
      const product = db.prepare('SELECT name, price FROM products WHERE slug = ?').get(i.slug);
      return { slug: i.slug, qty: i.qty, name: product?.name || i.slug, price: product?.price || 0 };
    });
  } catch { return []; }
}

// GST is INCLUSIVE in the price — reverse-calculate the taxable amount
function calculateGst(totalPaise, gstRate) {
  const taxableAmount = Math.round(totalPaise / (1 + gstRate / 100));
  const gstAmount = totalPaise - taxableAmount;
  return { taxableAmount, gstAmount };
}

export async function generateInvoice(order) {
  const gstin = process.env.GSTIN;
  const gstRate = parseFloat(process.env.GST_RATE || '0');
  const hsnCode = process.env.HSN_CODE || '3303';

  if (!gstin || gstRate <= 0) {
    console.log('Invoice: GST not configured — skipping invoice generation for', order.order_number);
    return null;
  }

  const invoiceNumber = getNextInvoiceNumber();
  const items = parseItems(order.items);
  const { taxableAmount, gstAmount } = calculateGst(order.total, gstRate);

  // Gujarat state code = 24, seller is Gujarat
  const sellerState = process.env.SELLER_STATE || 'Gujarat';
  const buyerState = order.shipping_state || '';
  const isIntraState = buyerState.toLowerCase() === sellerState.toLowerCase();

  let cgst = 0, sgst = 0, igst = 0;
  if (isIntraState) {
    cgst = Math.round(gstAmount / 2);
    sgst = gstAmount - cgst;
  } else {
    igst = gstAmount;
  }

  const pdfPath = path.join(invoiceDir, `${invoiceNumber.replace(/\//g, '-')}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const p = (paise) => '₹' + (paise / 100).toFixed(2);
    const gold = '#a27d4e';
    const charcoal = '#1a1815';
    const grey = '#6b6560';

    // Header
    doc.fontSize(22).fillColor(gold).text('THE SIXTH RITU', 50, 50, { align: 'center' });
    doc.fontSize(9).fillColor(grey).text('The Season of Luxury', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(charcoal).text('TAX INVOICE', { align: 'center' });

    doc.moveDown(1);

    // Invoice details
    const topY = doc.y;
    doc.fontSize(9).fillColor(grey);
    doc.text(`Invoice No: ${invoiceNumber}`, 50, topY);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 50);
    doc.text(`Order No: ${order.order_number}`, 50);

    // Seller details (right side)
    doc.fontSize(9).fillColor(grey);
    doc.text('Sold By:', 350, topY);
    doc.fillColor(charcoal).text(process.env.SELLER_NAME || 'The Sixth Ritu', 350);
    doc.fillColor(grey).text(process.env.SELLER_ADDRESS || '', 350, undefined, { width: 200 });
    doc.text(`GSTIN: ${gstin}`, 350);
    doc.text(`State: ${sellerState}`, 350);

    doc.moveDown(1.5);

    // Buyer details
    const buyerY = doc.y;
    doc.fillColor(grey).text('Bill To / Ship To:', 50, buyerY);
    doc.fillColor(charcoal).fontSize(10).text(order.customer_name, 50);
    doc.fontSize(9).fillColor(grey);
    doc.text(order.shipping_address, 50, undefined, { width: 250 });
    doc.text(`${order.shipping_city}, ${order.shipping_state} — ${order.shipping_pincode}`);
    doc.text(`Phone: ${order.customer_phone}`);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`);

    doc.moveDown(1.5);

    // Items table
    const tableTop = doc.y;
    const colX = { item: 50, hsn: 250, qty: 310, rate: 355, amount: 440 };

    // Header row
    doc.rect(50, tableTop, 500, 20).fill('#f0ece5');
    doc.fontSize(8).fillColor(charcoal);
    doc.text('Item', colX.item + 6, tableTop + 5);
    doc.text('HSN', colX.hsn + 6, tableTop + 5);
    doc.text('Qty', colX.qty + 6, tableTop + 5);
    doc.text('Rate', colX.rate + 6, tableTop + 5);
    doc.text('Amount', colX.amount + 6, tableTop + 5);

    let rowY = tableTop + 22;
    for (const item of items) {
      const lineTotal = item.price * item.qty;
      doc.fontSize(9).fillColor(charcoal);
      doc.text(item.name, colX.item + 6, rowY, { width: 190 });
      doc.text(hsnCode, colX.hsn + 6, rowY);
      doc.text(String(item.qty), colX.qty + 6, rowY);
      doc.text(p(item.price), colX.rate + 6, rowY);
      doc.text(p(lineTotal), colX.amount + 6, rowY);
      rowY += 18;
    }

    doc.moveTo(50, rowY).lineTo(550, rowY).stroke('#e8e4dd');
    rowY += 10;

    // Totals
    const labelX = 380;
    const valX = 460;

    doc.fontSize(9).fillColor(grey);
    doc.text('Subtotal (incl. GST)', labelX, rowY);
    doc.fillColor(charcoal).text(p(order.subtotal), valX, rowY, { align: 'right', width: 90 });
    rowY += 16;

    if (order.discount > 0) {
      doc.fillColor(grey).text('Discount', labelX, rowY);
      doc.fillColor(gold).text(`-${p(order.discount)}`, valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    }

    doc.fillColor(grey).text('Taxable Amount', labelX, rowY);
    doc.fillColor(charcoal).text(p(taxableAmount), valX, rowY, { align: 'right', width: 90 });
    rowY += 16;

    if (isIntraState) {
      doc.fillColor(grey).text(`CGST (${gstRate / 2}%)`, labelX, rowY);
      doc.fillColor(charcoal).text(p(cgst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
      doc.fillColor(grey).text(`SGST (${gstRate / 2}%)`, labelX, rowY);
      doc.fillColor(charcoal).text(p(sgst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    } else {
      doc.fillColor(grey).text(`IGST (${gstRate}%)`, labelX, rowY);
      doc.fillColor(charcoal).text(p(igst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    }

    doc.fontSize(9).fillColor(grey).text('Shipping', labelX, rowY);
    doc.fillColor(charcoal).text('Complimentary', valX, rowY, { align: 'right', width: 90 });
    rowY += 18;

    doc.moveTo(labelX, rowY).lineTo(550, rowY).stroke(charcoal);
    rowY += 6;
    doc.fontSize(11).fillColor(charcoal).text('Total', labelX, rowY);
    doc.text(p(order.total), valX, rowY, { align: 'right', width: 90 });

    // Footer
    doc.fontSize(8).fillColor(grey);
    doc.text('This is a computer-generated invoice. No signature required.', 50, 750, { align: 'center', width: 500 });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // Save invoice record
  db.prepare(
    `INSERT INTO invoices (invoice_number, order_id, order_number, customer_name, customer_email, taxable_amount, cgst, sgst, igst, total_amount, pdf_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(invoiceNumber, order.id, order.order_number, order.customer_name, order.customer_email, taxableAmount, cgst, sgst, igst, order.total, pdfPath);

  // Update order with invoice info
  db.prepare(
    "UPDATE orders SET invoice_number = ?, invoice_url = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(invoiceNumber, `/api/payments/invoice/${order.order_number}`, order.id);

  return { invoiceNumber, pdfPath };
}
