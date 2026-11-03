import PDFDocument from 'pdfkit';
import db from '../db/index.js';

const SELLER = {
  legalName: 'Gandhi Kishorbhai Gulabbhai',
  tradeName: 'The Sixth Ritu',
  address: 'Ground Floor, 10122650/0, Laxmi Nagar Society, Gandevi Road',
  city: 'Navsari',
  state: 'Gujarat',
  pincode: '396445',
  gstin: '24AJWPG1884D1Z2',
  stateCode: '24',
  email: 'thesixthritu@gmail.com',
};

const HSN_CODE = '3303';
const GST_RATE = 18;

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

function isIntraState(shippingState) {
  return (shippingState || '').trim().toLowerCase() === 'gujarat';
}

export async function generateInvoice(order) {
  const invoiceNumber = await getNextInvoiceNumber();
  const items = await parseItems(order.items);
  const intraState = isIntraState(order.shipping_state);

  const taxableAmount = Math.round(order.total * 100 / (100 + GST_RATE));
  const totalTax = order.total - taxableAmount;
  let cgst = 0, sgst = 0, igst = 0;
  if (intraState) {
    cgst = Math.round(totalTax / 2);
    sgst = totalTax - cgst;
  } else {
    igst = totalTax;
  }

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
    const lightBg = '#f0ece5';

    doc.fontSize(22).fillColor(gold).text('THE SIXTH RITU', 50, 50, { align: 'center' });
    doc.fontSize(9).fillColor(grey).text('The Season of Luxury', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(charcoal).text('TAX INVOICE', { align: 'center' });
    doc.moveDown(1);

    const topY = doc.y;
    doc.fontSize(9).fillColor(grey);
    doc.text(`Invoice No: ${invoiceNumber}`, 50, topY);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 50);
    doc.text(`Order No: ${order.order_number}`, 50);
    doc.text(`Payment: ${order.payment_method === 'cod' ? 'Cash on Delivery' : 'Prepaid (Online)'}`, 50);

    doc.fontSize(9).fillColor(grey).text('Sold By:', 350, topY);
    doc.fillColor(charcoal).text(SELLER.legalName, 350);
    doc.fillColor(grey).text(`T/A ${SELLER.tradeName}`, 350);
    doc.text(`${SELLER.address}`, 350, undefined, { width: 200 });
    doc.text(`${SELLER.city}, ${SELLER.state} — ${SELLER.pincode}`);
    doc.text(`GSTIN: ${SELLER.gstin}`);
    doc.text(`State: ${SELLER.state} (${SELLER.stateCode})`);
    doc.moveDown(1.5);

    const buyerY = doc.y;
    doc.fillColor(grey).text('Bill To / Ship To:', 50, buyerY);
    doc.fillColor(charcoal).fontSize(10).text(order.customer_name, 50);
    doc.fontSize(9).fillColor(grey);
    doc.text(order.shipping_address, 50, undefined, { width: 250 });
    doc.text(`${order.shipping_city}, ${order.shipping_state} — ${order.shipping_pincode}`);
    doc.text(`Phone: ${order.customer_phone}`);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`);
    doc.text(`Place of Supply: ${order.shipping_state}`);
    doc.moveDown(1.5);

    const tableTop = doc.y;
    const colX = { item: 50, hsn: 240, qty: 290, rate: 330, taxable: 390, tax: 450, amount: 500 };

    doc.rect(50, tableTop, 500, 20).fill(lightBg);
    doc.fontSize(7).fillColor(charcoal);
    doc.text('Item', colX.item + 4, tableTop + 6);
    doc.text('HSN', colX.hsn + 4, tableTop + 6);
    doc.text('Qty', colX.qty + 4, tableTop + 6);
    doc.text('Rate', colX.rate + 4, tableTop + 6);
    doc.text('Taxable', colX.taxable + 4, tableTop + 6);
    doc.text('Tax', colX.tax + 4, tableTop + 6);
    doc.text('Amount', colX.amount + 4, tableTop + 6);

    let rowY = tableTop + 22;
    let totalItemTaxable = 0;
    for (const item of items) {
      const lineTotal = item.price * item.qty;
      const itemTaxable = Math.round(lineTotal * 100 / (100 + GST_RATE));
      const itemTax = lineTotal - itemTaxable;
      totalItemTaxable += itemTaxable;
      doc.fontSize(8).fillColor(charcoal);
      doc.text(item.name, colX.item + 4, rowY, { width: 185 });
      doc.text(HSN_CODE, colX.hsn + 4, rowY);
      doc.text(String(item.qty), colX.qty + 4, rowY);
      doc.text(p(item.price), colX.rate + 4, rowY);
      doc.text(p(itemTaxable), colX.taxable + 4, rowY);
      doc.text(p(itemTax), colX.tax + 4, rowY);
      doc.text(p(lineTotal), colX.amount + 4, rowY);
      rowY += 18;
    }

    doc.moveTo(50, rowY).lineTo(550, rowY).stroke('#e8e4dd');
    rowY += 10;

    const labelX = 350;
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

    doc.fillColor(grey).text('Taxable Value', labelX, rowY);
    doc.fillColor(charcoal).text(p(taxableAmount), valX, rowY, { align: 'right', width: 90 });
    rowY += 16;

    if (intraState) {
      doc.fillColor(grey).text(`CGST @ ${GST_RATE / 2}%`, labelX, rowY);
      doc.fillColor(charcoal).text(p(cgst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
      doc.fillColor(grey).text(`SGST @ ${GST_RATE / 2}%`, labelX, rowY);
      doc.fillColor(charcoal).text(p(sgst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    } else {
      doc.fillColor(grey).text(`IGST @ ${GST_RATE}%`, labelX, rowY);
      doc.fillColor(charcoal).text(p(igst), valX, rowY, { align: 'right', width: 90 });
      rowY += 16;
    }

    doc.fillColor(grey).text('Shipping', labelX, rowY);
    doc.fillColor(charcoal).text('Complimentary', valX, rowY, { align: 'right', width: 90 });
    rowY += 18;

    doc.moveTo(labelX, rowY).lineTo(550, rowY).stroke(charcoal);
    rowY += 6;
    doc.fontSize(11).fillColor(charcoal).text('Total', labelX, rowY);
    doc.text(p(order.total), valX, rowY, { align: 'right', width: 90 });
    rowY += 24;

    doc.fontSize(7).fillColor(grey);
    doc.text(`HSN: ${HSN_CODE} | GST Rate: ${GST_RATE}% | All prices are inclusive of applicable taxes`, 50, rowY, { width: 500 });
    rowY += 14;
    doc.text(`Registered under GST as per GSTIN: ${SELLER.gstin}`, 50, rowY, { width: 500 });

    doc.fontSize(8).fillColor(grey);
    doc.text('This is a computer-generated invoice. No signature required.', 50, 750, { align: 'center', width: 500 });
    doc.text(`${SELLER.tradeName} | ${SELLER.email}`, 50, 762, { align: 'center', width: 500 });

    doc.end();
  });

  const pdfBase64 = pdfBuffer.toString('base64');

  await db.prepare(
    `INSERT INTO invoices (invoice_number, order_id, order_number, customer_name, customer_email, taxable_amount, cgst, sgst, igst, total_amount, pdf_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(invoiceNumber, order.id, order.order_number, order.customer_name, order.customer_email, taxableAmount, cgst, sgst, igst, order.total, pdfBase64);

  await db.prepare(
    "UPDATE orders SET invoice_number = ?, invoice_url = ?, updated_at = NOW() WHERE id = ?"
  ).run(invoiceNumber, `/api/payments/invoice/${order.order_number}`, order.id);

  return { invoiceNumber, pdfBuffer };
}
