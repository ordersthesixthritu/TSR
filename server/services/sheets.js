import { google } from 'googleapis';
import db from '../db/index.js';

let sheets = null;
let spreadsheetId = null;

export function initSheets() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!keyJson || !spreadsheetId) {
    console.log('Sheets: Google Sheets not configured — sync disabled');
    return;
  }

  try {
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    console.log('Sheets: Google Sheets sync initialized');
  } catch (err) {
    console.error('Sheets: Failed to initialize —', err.message);
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function parseItemNames(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    const names = [];
    for (const i of items) {
      const product = await db.prepare('SELECT name FROM products WHERE slug = ?').get(i.slug);
      names.push(`${product?.name || i.slug} × ${i.qty}`);
    }
    return names.join(', ');
  } catch { return ''; }
}

export async function syncOrderToSheet(order) {
  if (!sheets || !spreadsheetId) return;

  try {
    const row = [
      order.order_number,
      formatDate(order.created_at),
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      await parseItemNames(order.items),
      (order.subtotal / 100).toFixed(2),
      (order.discount / 100).toFixed(2),
      (order.total / 100).toFixed(2),
      order.payment_method === 'cod' ? 'COD' : 'Prepaid',
      order.payment_status,
      order.status,
      order.tracking_number || '',
      order.courier || '',
      order.invoice_number || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Orders!A:O',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.error('Sheets: Failed to sync order', order.order_number, '—', err.message);
    await db.prepare(
      "INSERT INTO failed_jobs (job_type, order_id, error, payload) VALUES (?, ?, ?, ?)"
    ).run('sheets_sync', order.id, err.message, JSON.stringify({ order_number: order.order_number }));
  }
}

export async function updateOrderInSheet(orderNumber, updates) {
  if (!sheets || !spreadsheetId) return;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Orders!A:A',
    });

    const rows = res.data.values || [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === orderNumber) { rowIndex = i; break; }
    }
    if (rowIndex < 0) return;

    const rangeRow = rowIndex + 1;

    if (updates.status) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Orders!L${rangeRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.status]] },
      });
    }
    if (updates.payment_status) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Orders!K${rangeRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.payment_status]] },
      });
    }
    if (updates.tracking_number) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Orders!M${rangeRow}:N${rangeRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.tracking_number, updates.courier || '']] },
      });
    }
  } catch (err) {
    console.error('Sheets: Failed to update order', orderNumber, '—', err.message);
  }
}

export async function ensureSheetHeaders() {
  if (!sheets || !spreadsheetId) return;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Orders!A1:O1',
    });

    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Orders!A1:O1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Order #', 'Date', 'Customer', 'Email', 'Phone', 'Items', 'Subtotal', 'Discount', 'Total', 'Payment Method', 'Payment Status', 'Status', 'Tracking #', 'Courier', 'Invoice #']],
        },
      });
      console.log('Sheets: Header row created');
    }
  } catch (err) {
    console.error('Sheets: Failed to check headers —', err.message);
  }
}
