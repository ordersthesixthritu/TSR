// ============================================================================
// THE SIXTH RITU — Google Apps Script Order Management + Email Notifications
// ============================================================================
// This script manages order data in Google Sheets AND sends all transactional
// emails (customer confirmation, owner notification, invoice) for The Sixth Ritu.
//
// NO SMTP NEEDED — emails are sent via GmailApp using the account that owns
// this script. Make sure this script is created from orders.thesixthritu@gmail.com
//
// SETUP:
//   1. Run initializeSheets() once from the Script Editor
//   2. Set AUTH_TOKEN in Script Properties (Project Settings > Script Properties)
//   3. Deploy as Web App (Execute as: Me, Access: Anyone)
//   4. Add the Web App URL + AUTH_TOKEN as env vars in Vercel
// ============================================================================

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

var SHEET_NAMES = {
  ORDERS: 'Orders',
  CUSTOMERS: 'Customers',
  PAYMENTS: 'Payments',
  INVOICES: 'Invoices',
  FAILED: 'Failed Automations',
  SETTINGS: 'Settings'
};

var ORDERS_HEADERS = [
  'Order ID', 'Order Date', 'Order Time', 'Customer Name', 'Email',
  'Mobile Number', 'Shipping Address', 'City', 'State', 'Pincode',
  'Product Names', 'SKU', 'Quantity', 'Item Subtotal', 'Discount',
  'Shipping Charges', 'Final Order Total', 'Payment Method', 'Payment Status',
  'Razorpay Order ID', 'Razorpay Payment ID', 'Order Status',
  'Invoice Number', 'Invoice Link', 'Tracking Number', 'Courier',
  'Last Updated'
];

var CUSTOMERS_HEADERS = [
  'Customer Name', 'Email', 'Mobile', 'City', 'State',
  'First Order Date', 'Total Orders', 'Total Spent'
];

var PAYMENTS_HEADERS = [
  'Order ID', 'Payment ID', 'Payment Method', 'Amount',
  'Payment Status', 'Payment Date', 'Refund Status'
];

var INVOICES_HEADERS = [
  'Invoice Number', 'Order ID', 'Customer', 'Invoice Date',
  'Invoice Total', 'PDF Link', 'Email Status'
];

var FAILED_HEADERS = [
  'Timestamp', 'Job Type', 'Order ID', 'Error', 'Retry Count', 'Resolved'
];

var SETTINGS_HEADERS = ['Setting', 'Value'];

var DEFAULT_SETTINGS = [
  ['Business Name', 'The Sixth Ritu'],
  ['Business Email', 'orders.thesixthritu@gmail.com'],
  ['Business Registration', '24AJWPG1884D1Z2'],
  ['Business Address', ''],
  ['Shipping Rate', '0'],
  ['COD Enabled', 'true'],
  ['Currency', 'INR']
];

// ---------------------------------------------------------------------------
// WEB ENDPOINT
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var token = payload.auth_token || '';
    var expectedToken = PropertiesService.getScriptProperties().getProperty('AUTH_TOKEN');

    if (!expectedToken || token !== expectedToken) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    var action = payload.action;
    var data = payload.data;

    if (!action || !data) {
      return jsonResponse({ success: false, error: 'Missing action or data' }, 400);
    }

    var result;
    switch (action) {
      case 'newOrder':
        result = processNewOrder(data);
        break;
      case 'addOrder':
        result = addOrderToSheet(data);
        break;
      case 'updateOrder':
        result = updateOrderStatus(data.orderNumber, data.status, data.paymentStatus);
        break;
      case 'updatePayment':
        result = updatePaymentRecord(data);
        break;
      case 'addInvoice':
        result = addInvoiceRecord(data);
        break;
      case 'logError':
        result = logFailedAutomation(data);
        break;
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action }, 400);
    }

    return jsonResponse({ success: true, result: result });
  } catch (err) {
    logFailedAutomation({
      jobType: 'doPost',
      orderId: '',
      error: err.message
    });
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', service: 'The Sixth Ritu Order Sync + Email' });
}

function jsonResponse(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// NEW ORDER PROCESSING (Sheet + All Emails)
// ---------------------------------------------------------------------------

function processNewOrder(data) {
  var results = { sheet: null, customerEmail: null, ownerEmail: null, invoiceEmail: null };

  // 1. Log order in Google Sheet
  try {
    results.sheet = addOrderToSheet(data);
  } catch (err) {
    results.sheet = { error: err.message };
    logFailedAutomation({ jobType: 'sheet_sync', orderId: data.orderNumber, error: err.message });
  }

  // 2. Send customer confirmation email
  try {
    results.customerEmail = sendCustomerConfirmation(data);
  } catch (err) {
    results.customerEmail = { error: err.message };
    logFailedAutomation({ jobType: 'customer_email', orderId: data.orderNumber, error: err.message });
  }

  // 3. Send owner notification email
  try {
    results.ownerEmail = sendOwnerNotification(data);
  } catch (err) {
    results.ownerEmail = { error: err.message };
    logFailedAutomation({ jobType: 'owner_email', orderId: data.orderNumber, error: err.message });
  }

  // 4. For paid orders: send invoice email + log invoice
  if (data.paymentStatus && data.paymentStatus.toUpperCase() === 'PAID' && data.invoiceNumber) {
    try {
      results.invoiceEmail = sendInvoiceEmail(data);
    } catch (err) {
      results.invoiceEmail = { error: err.message };
      logFailedAutomation({ jobType: 'invoice_email', orderId: data.orderNumber, error: err.message });
    }

    try {
      addInvoiceRecord({
        invoiceNumber: data.invoiceNumber,
        orderId: data.orderNumber,
        customer: data.customerName,
        invoiceTotal: data.finalTotal,
        pdfLink: data.invoiceLink || '',
        emailStatus: results.invoiceEmail && !results.invoiceEmail.error ? 'sent' : 'failed'
      });
    } catch (err) {
      logFailedAutomation({ jobType: 'invoice_record', orderId: data.orderNumber, error: err.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// EMAIL: CUSTOMER ORDER CONFIRMATION
// ---------------------------------------------------------------------------

function sendCustomerConfirmation(data) {
  var email = (data.email || '').trim();
  if (!email) return { skipped: true, reason: 'no email' };

  var items = data.items || [];
  var paymentLabel = (data.paymentMethod || '').toLowerCase() === 'cod' ? 'Cash on Delivery' : 'Prepaid (Online)';
  var isCod = (data.paymentMethod || '').toLowerCase() === 'cod';

  var itemRows = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var lineTotal = (item.price || 0) * (item.qty || 1) / 100;
    itemRows += '<tr>'
      + '<td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;">' + esc(item.name) + '</td>'
      + '<td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;text-align:center;">' + (item.qty || 1) + '</td>'
      + '<td style="padding:10px 16px;border-bottom:1px solid #e8e4dd;text-align:right;">' + formatRupees(lineTotal) + '</td>'
      + '</tr>';
  }

  var discountRow = '';
  if (data.discount && data.discount > 0) {
    discountRow = '<tr><td style="padding:4px 0;color:#6b6560;">Discount'
      + (data.couponCode ? ' (' + esc(data.couponCode) + ')' : '') + '</td>'
      + '<td style="text-align:right;color:#a27d4e;">-' + formatRupees(data.discount) + '</td></tr>';
  }

  var html = ''
    + '<div style="max-width:600px;margin:0 auto;font-family:\'DM Sans\',Helvetica,Arial,sans-serif;color:#1a1815;background:#faf8f4;">'
    + '  <div style="background:#1a1815;padding:32px;text-align:center;">'
    + '    <h1 style="color:#a27d4e;font-family:\'Cormorant Garamond\',Georgia,serif;font-size:28px;margin:0;letter-spacing:2px;">THE SIXTH RITU</h1>'
    + '  </div>'
    + '  <div style="padding:32px;">'
    + '    <h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:24px;color:#1a1815;margin:0 0 8px;">Thank you for your order</h2>'
    + '    <p style="color:#6b6560;margin:0 0 24px;">Order <strong>' + esc(data.orderNumber) + '</strong> has been ' + (isCod ? 'placed' : 'confirmed') + '.</p>'
    + '    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">'
    + '      <thead><tr style="background:#f0ece5;">'
    + '        <th style="padding:10px 16px;text-align:left;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Item</th>'
    + '        <th style="padding:10px 16px;text-align:center;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Qty</th>'
    + '        <th style="padding:10px 16px;text-align:right;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Amount</th>'
    + '      </tr></thead>'
    + '      <tbody>' + itemRows + '</tbody>'
    + '    </table>'
    + '    <table style="width:100%;max-width:280px;margin-left:auto;margin-bottom:24px;">'
    + '      <tr><td style="padding:4px 0;color:#6b6560;">Subtotal</td><td style="text-align:right;">' + formatRupees(data.itemSubtotal) + '</td></tr>'
    + discountRow
    + '      <tr><td style="padding:4px 0;color:#6b6560;">Shipping</td><td style="text-align:right;">Complimentary</td></tr>'
    + '      <tr style="font-weight:700;font-size:16px;"><td style="padding:8px 0;border-top:2px solid #1a1815;">Total</td><td style="text-align:right;padding:8px 0;border-top:2px solid #1a1815;">' + formatRupees(data.finalTotal) + '</td></tr>'
    + '      <tr><td colspan="2" style="padding:4px 0;color:#999;font-size:11px;text-align:right;">Inclusive of all applicable taxes</td></tr>'
    + '    </table>'
    + '    <div style="background:#f0ece5;padding:20px;border-radius:4px;margin:0 0 24px;">'
    + '      <p style="margin:0 0 8px;font-weight:600;">Shipping Details</p>'
    + '      <p style="margin:0;color:#6b6560;line-height:1.6;">'
    + esc(data.customerName) + '<br>'
    + esc(data.shippingAddress) + '<br>'
    + esc(data.city) + ', ' + esc(data.state) + ' — ' + esc(data.pincode) + '<br>'
    + 'Phone: ' + esc(data.mobile)
    + '      </p>'
    + '    </div>'
    + '    <p style="margin:0 0 4px;"><strong>Payment:</strong> ' + paymentLabel + '</p>'
    + (isCod ? '<p style="color:#6b6560;margin:0;font-size:13px;">Payment will be collected at delivery.</p>' : '')
    + '    <hr style="border:none;border-top:1px solid #e8e4dd;margin:24px 0;">'
    + '    <p style="color:#6b6560;font-size:13px;margin:0;">If you have any questions, reply to this email or reach us at orders.thesixthritu@gmail.com</p>'
    + '  </div>'
    + '  <div style="background:#1a1815;padding:20px;text-align:center;">'
    + '    <p style="color:#a27d4e;font-size:12px;margin:0;letter-spacing:1px;">THE SIXTH RITU — THE SEASON OF LUXURY</p>'
    + '  </div>'
    + '</div>';

  GmailApp.sendEmail(email,
    'Order Confirmed — ' + data.orderNumber + ' | The Sixth Ritu',
    'Thank you for your order ' + data.orderNumber + '. Total: ' + formatRupees(data.finalTotal),
    { htmlBody: html, name: 'The Sixth Ritu' }
  );

  return { sent: true, to: email };
}

// ---------------------------------------------------------------------------
// EMAIL: OWNER NOTIFICATION
// ---------------------------------------------------------------------------

function sendOwnerNotification(data) {
  var ownerEmail = getSettingValue('Business Email');
  if (!ownerEmail) ownerEmail = Session.getActiveUser().getEmail();
  if (!ownerEmail) return { skipped: true, reason: 'no owner email' };

  var items = data.items || [];
  var itemList = '';
  for (var i = 0; i < items.length; i++) {
    itemList += items[i].name + ' × ' + (items[i].qty || 1);
    if (i < items.length - 1) itemList += ', ';
  }

  var paymentLabel = (data.paymentMethod || '').toLowerCase() === 'cod' ? 'COD' : 'Prepaid';
  var paymentBadge = data.paymentStatus && data.paymentStatus.toUpperCase() === 'PAID'
    ? ' ✓ Paid' : ' — Pending';

  var html = ''
    + '<div style="font-family:\'DM Sans\',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1815;">'
    + '  <h2 style="color:#a27d4e;">New Order — ' + esc(data.orderNumber) + '</h2>'
    + '  <table style="width:100%;border-collapse:collapse;">'
    + '    <tr><td style="padding:6px 0;font-weight:600;width:120px;">Customer</td><td>' + esc(data.customerName) + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Email</td><td>' + esc(data.email) + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Phone</td><td>' + esc(data.mobile) + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Items</td><td>' + esc(itemList) + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Total</td><td>' + formatRupees(data.finalTotal) + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Payment</td><td>' + paymentLabel + paymentBadge + '</td></tr>'
    + '    <tr><td style="padding:6px 0;font-weight:600;">Address</td><td>' + esc(data.shippingAddress) + ', ' + esc(data.city) + ', ' + esc(data.state) + ' — ' + esc(data.pincode) + '</td></tr>'
    + '  </table>'
    + '</div>';

  GmailApp.sendEmail(ownerEmail,
    '[TSR] New Order ' + data.orderNumber + ' — ' + formatRupees(data.finalTotal) + ' (' + paymentLabel + ')',
    'New order ' + data.orderNumber + ' from ' + data.customerName + '. Total: ' + formatRupees(data.finalTotal),
    { htmlBody: html, name: 'The Sixth Ritu Orders' }
  );

  return { sent: true, to: ownerEmail };
}

// ---------------------------------------------------------------------------
// EMAIL: INVOICE (beautifully formatted HTML invoice)
// ---------------------------------------------------------------------------

function sendInvoiceEmail(data) {
  var email = (data.email || '').trim();
  if (!email) return { skipped: true, reason: 'no email' };
  if (!data.invoiceNumber) return { skipped: true, reason: 'no invoice number' };

  var sellerName = getSettingValue('Business Name') || 'The Sixth Ritu';
  var sellerAddress = getSettingValue('Business Address') || '';
  var invoiceDate = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy');

  var items = data.items || [];
  var itemRows = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var rate = (item.price || 0) / 100;
    var lineTotal = rate * (item.qty || 1);
    itemRows += '<tr>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #e8e4dd;">' + esc(item.name) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #e8e4dd;text-align:center;">' + (item.qty || 1) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #e8e4dd;text-align:right;">' + formatRupees(rate) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #e8e4dd;text-align:right;">' + formatRupees(lineTotal) + '</td>'
      + '</tr>';
  }

  var discountRow = '';
  if (data.discount && data.discount > 0) {
    discountRow = '<tr><td style="padding:4px 0;color:#6b6560;">Discount</td>'
      + '<td style="text-align:right;color:#a27d4e;">-' + formatRupees(data.discount) + '</td></tr>';
  }

  var html = ''
    + '<div style="max-width:650px;margin:0 auto;font-family:\'DM Sans\',Helvetica,Arial,sans-serif;color:#1a1815;background:#ffffff;">'
    // Header
    + '<div style="padding:32px 32px 16px;text-align:center;border-bottom:3px solid #a27d4e;">'
    + '  <h1 style="color:#a27d4e;font-family:\'Cormorant Garamond\',Georgia,serif;font-size:26px;margin:0;letter-spacing:2px;">THE SIXTH RITU</h1>'
    + '  <p style="color:#6b6560;font-size:10px;margin:4px 0 0;letter-spacing:1px;">THE SEASON OF LUXURY</p>'
    + '</div>'
    // Invoice title
    + '<div style="padding:24px 32px 0;">'
    + '  <h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:20px;color:#1a1815;margin:0 0 20px;text-align:center;letter-spacing:3px;">INVOICE</h2>'
    + '  <table style="width:100%;margin:0 0 20px;">'
    + '    <tr><td style="vertical-align:top;width:50%;">'
    + '      <p style="color:#6b6560;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Invoice No</p>'
    + '      <p style="margin:0 0 12px;font-weight:600;">' + esc(data.invoiceNumber) + '</p>'
    + '      <p style="color:#6b6560;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Date</p>'
    + '      <p style="margin:0 0 12px;">' + invoiceDate + '</p>'
    + '      <p style="color:#6b6560;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Order No</p>'
    + '      <p style="margin:0;">' + esc(data.orderNumber) + '</p>'
    + '    </td><td style="vertical-align:top;width:50%;text-align:right;">'
    + '      <p style="color:#6b6560;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Sold By</p>'
    + '      <p style="margin:0;font-weight:600;">' + esc(sellerName) + '</p>'
    + (sellerAddress ? '<p style="margin:4px 0 0;color:#6b6560;font-size:12px;">' + esc(sellerAddress) + '</p>' : '')
    + '    </td></tr>'
    + '  </table>'
    // Bill To
    + '  <div style="background:#f7f4ed;padding:14px 16px;border-radius:4px;margin:0 0 20px;">'
    + '    <p style="color:#6b6560;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Bill To / Ship To</p>'
    + '    <p style="margin:0;font-weight:600;">' + esc(data.customerName) + '</p>'
    + '    <p style="margin:4px 0 0;color:#6b6560;font-size:12px;line-height:1.6;">'
    + esc(data.shippingAddress) + '<br>'
    + esc(data.city) + ', ' + esc(data.state) + ' — ' + esc(data.pincode) + '<br>'
    + 'Phone: ' + esc(data.mobile)
    + (data.email ? '<br>Email: ' + esc(data.email) : '')
    + '    </p>'
    + '  </div>'
    // Items table
    + '  <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">'
    + '    <thead><tr style="background:#f0ece5;">'
    + '      <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Item</th>'
    + '      <th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Qty</th>'
    + '      <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Rate</th>'
    + '      <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b6560;">Amount</th>'
    + '    </tr></thead>'
    + '    <tbody>' + itemRows + '</tbody>'
    + '  </table>'
    // Totals
    + '  <table style="width:100%;max-width:260px;margin-left:auto;margin-bottom:16px;">'
    + '    <tr><td style="padding:4px 0;color:#6b6560;">Subtotal</td><td style="text-align:right;">' + formatRupees(data.itemSubtotal) + '</td></tr>'
    + discountRow
    + '    <tr><td style="padding:4px 0;color:#6b6560;">Shipping</td><td style="text-align:right;">Complimentary</td></tr>'
    + '    <tr style="font-weight:700;font-size:15px;"><td style="padding:8px 0;border-top:2px solid #1a1815;">Total</td><td style="text-align:right;padding:8px 0;border-top:2px solid #1a1815;">' + formatRupees(data.finalTotal) + '</td></tr>'
    + '    <tr><td colspan="2" style="padding:4px 0;color:#999;font-size:10px;text-align:right;">All prices are inclusive of applicable taxes</td></tr>'
    + '  </table>'
    + '  <p style="color:#999;font-size:10px;text-align:center;margin:20px 0 0;padding-top:16px;border-top:1px solid #e8e4dd;">This is a computer-generated invoice. No signature required.</p>'
    + '</div>'
    // Footer
    + '<div style="background:#1a1815;padding:16px;text-align:center;margin-top:24px;">'
    + '  <p style="color:#a27d4e;font-size:11px;margin:0;letter-spacing:1px;">THE SIXTH RITU — THE SEASON OF LUXURY</p>'
    + '</div>'
    + '</div>';

  GmailApp.sendEmail(email,
    'Invoice — ' + data.orderNumber + ' | The Sixth Ritu',
    'Your invoice ' + data.invoiceNumber + ' for order ' + data.orderNumber + '. Total: ' + formatRupees(data.finalTotal),
    { htmlBody: html, name: 'The Sixth Ritu' }
  );

  return { sent: true, to: email, invoiceNumber: data.invoiceNumber };
}

// ---------------------------------------------------------------------------
// SHEET INITIALIZATION
// ---------------------------------------------------------------------------

function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  createSheetWithHeaders(ss, SHEET_NAMES.ORDERS, ORDERS_HEADERS);
  createSheetWithHeaders(ss, SHEET_NAMES.CUSTOMERS, CUSTOMERS_HEADERS);
  createSheetWithHeaders(ss, SHEET_NAMES.PAYMENTS, PAYMENTS_HEADERS);
  createSheetWithHeaders(ss, SHEET_NAMES.INVOICES, INVOICES_HEADERS);
  createSheetWithHeaders(ss, SHEET_NAMES.FAILED, FAILED_HEADERS);

  var settingsSheet = createSheetWithHeaders(ss, SHEET_NAMES.SETTINGS, SETTINGS_HEADERS);
  if (settingsSheet && settingsSheet.getLastRow() <= 1) {
    settingsSheet.getRange(2, 1, DEFAULT_SETTINGS.length, 2).setValues(DEFAULT_SETTINGS);
  }

  applyConditionalFormatting(ss);

  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    var lastRow = defaultSheet.getLastRow();
    if (lastRow <= 1) {
      ss.deleteSheet(defaultSheet);
    }
  }

  SpreadsheetApp.flush();
  Logger.log('All sheets initialized successfully.');
}

function createSheetWithHeaders(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1815');
  headerRange.setFontColor('#f7f4ed');
  headerRange.setHorizontalAlignment('center');

  sheet.setFrozenRows(1);

  var colCount = Math.min(headers.length, 20);
  for (var i = 1; i <= colCount; i++) {
    sheet.autoResizeColumn(i);
  }

  return sheet;
}

function applyConditionalFormatting(ss) {
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) return;

  var paymentCol = 19;
  var lastRow = Math.max(ordersSheet.getMaxRows(), 500);
  var range = ordersSheet.getRange(2, paymentCol, lastRow - 1, 1);

  var rules = ordersSheet.getConditionalFormatRules();

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('PAID')
    .setBackground('#d4edda')
    .setFontColor('#155724')
    .setRanges([range])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('UNPAID')
    .setBackground('#fff3cd')
    .setFontColor('#856404')
    .setRanges([range])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('FAILED')
    .setBackground('#f8d7da')
    .setFontColor('#721c24')
    .setRanges([range])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('REFUNDED')
    .setBackground('#d1ecf1')
    .setFontColor('#0c5460')
    .setRanges([range])
    .build());

  var statusCol = 22;
  var statusRange = ordersSheet.getRange(2, statusCol, lastRow - 1, 1);

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('delivered')
    .setBackground('#d4edda')
    .setFontColor('#155724')
    .setRanges([statusRange])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('cancelled')
    .setBackground('#f8d7da')
    .setFontColor('#721c24')
    .setRanges([statusRange])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('shipped')
    .setBackground('#cce5ff')
    .setFontColor('#004085')
    .setRanges([statusRange])
    .build());

  ordersSheet.setConditionalFormatRules(rules);
}

// ---------------------------------------------------------------------------
// ORDER MANAGEMENT
// ---------------------------------------------------------------------------

function addOrderToSheet(orderData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) throw new Error('Orders sheet not found. Run initializeSheets() first.');

  var existingRow = findOrderRow(ordersSheet, orderData.orderNumber);
  if (existingRow > 0) {
    return { action: 'skipped', reason: 'duplicate', orderNumber: orderData.orderNumber };
  }

  var now = new Date();
  var orderDate = orderData.orderDate || Utilities.formatDate(now, 'Asia/Kolkata', 'dd/MM/yyyy');
  var orderTime = orderData.orderTime || Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');

  var row = [
    orderData.orderNumber || '',
    orderDate,
    orderTime,
    orderData.customerName || '',
    orderData.email || '',
    orderData.mobile || '',
    orderData.shippingAddress || '',
    orderData.city || '',
    orderData.state || '',
    orderData.pincode || '',
    orderData.productNames || '',
    orderData.sku || '',
    orderData.quantity || '',
    formatCurrency(orderData.itemSubtotal || 0),
    formatCurrency(orderData.discount || 0),
    formatCurrency(orderData.shippingCharges || 0),
    formatCurrency(orderData.finalTotal || 0),
    (orderData.paymentMethod || '').toUpperCase(),
    (orderData.paymentStatus || 'UNPAID').toUpperCase(),
    orderData.razorpayOrderId || '',
    orderData.razorpayPaymentId || '',
    orderData.orderStatus || 'pending',
    orderData.invoiceNumber || '',
    orderData.invoiceLink || '',
    orderData.trackingNumber || '',
    orderData.courier || '',
    Utilities.formatDate(now, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss')
  ];

  ordersSheet.appendRow(row);

  updateCustomerRecord(ss, orderData);

  addPaymentRecord(ss, {
    orderId: orderData.orderNumber,
    paymentId: orderData.razorpayPaymentId || '',
    paymentMethod: (orderData.paymentMethod || '').toUpperCase(),
    amount: orderData.finalTotal || 0,
    paymentStatus: (orderData.paymentStatus || 'UNPAID').toUpperCase(),
    paymentDate: orderData.paymentStatus === 'PAID'
      ? Utilities.formatDate(now, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss')
      : '',
    refundStatus: ''
  });

  return { action: 'added', orderNumber: orderData.orderNumber };
}

function updateOrderStatus(orderNumber, status, paymentStatus) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) throw new Error('Orders sheet not found.');

  var row = findOrderRow(ordersSheet, orderNumber);
  if (row <= 0) {
    return { action: 'not_found', orderNumber: orderNumber };
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');

  if (status) {
    ordersSheet.getRange(row, 22).setValue(status);
  }
  if (paymentStatus) {
    ordersSheet.getRange(row, 19).setValue(paymentStatus.toUpperCase());
  }
  ordersSheet.getRange(row, 27).setValue(now);

  if (paymentStatus) {
    updatePaymentStatus(ss, orderNumber, paymentStatus);
  }

  return { action: 'updated', orderNumber: orderNumber };
}

function updatePaymentRecord(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) throw new Error('Orders sheet not found.');

  var row = findOrderRow(ordersSheet, data.orderNumber);
  if (row <= 0) {
    return { action: 'not_found', orderNumber: data.orderNumber };
  }

  if (data.paymentStatus) {
    ordersSheet.getRange(row, 19).setValue(data.paymentStatus.toUpperCase());
  }
  if (data.razorpayPaymentId) {
    ordersSheet.getRange(row, 21).setValue(data.razorpayPaymentId);
  }
  if (data.razorpayOrderId) {
    ordersSheet.getRange(row, 20).setValue(data.razorpayOrderId);
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
  ordersSheet.getRange(row, 27).setValue(now);

  updatePaymentStatus(ss, data.orderNumber, data.paymentStatus);

  return { action: 'payment_updated', orderNumber: data.orderNumber };
}

// ---------------------------------------------------------------------------
// CUSTOMER MANAGEMENT
// ---------------------------------------------------------------------------

function updateCustomerRecord(ss, orderData) {
  var sheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);
  if (!sheet) return;

  var email = (orderData.email || '').toLowerCase().trim();
  if (!email) return;

  var data = sheet.getDataRange().getValues();
  var existingRow = -1;

  for (var i = 1; i < data.length; i++) {
    if ((data[i][1] || '').toString().toLowerCase().trim() === email) {
      existingRow = i + 1;
      break;
    }
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');

  if (existingRow > 0) {
    var currentOrders = parseInt(sheet.getRange(existingRow, 7).getValue()) || 0;
    var currentSpent = parseFloat(String(sheet.getRange(existingRow, 8).getValue()).replace(/[₹,]/g, '')) || 0;

    sheet.getRange(existingRow, 1).setValue(orderData.customerName || data[existingRow - 1][0]);
    sheet.getRange(existingRow, 3).setValue(orderData.mobile || data[existingRow - 1][2]);
    sheet.getRange(existingRow, 4).setValue(orderData.city || data[existingRow - 1][3]);
    sheet.getRange(existingRow, 5).setValue(orderData.state || data[existingRow - 1][4]);
    sheet.getRange(existingRow, 7).setValue(currentOrders + 1);
    sheet.getRange(existingRow, 8).setValue(formatCurrency(currentSpent + (orderData.finalTotal || 0)));
  } else {
    sheet.appendRow([
      orderData.customerName || '',
      email,
      orderData.mobile || '',
      orderData.city || '',
      orderData.state || '',
      now,
      1,
      formatCurrency(orderData.finalTotal || 0)
    ]);
  }
}

// ---------------------------------------------------------------------------
// PAYMENT TRACKING
// ---------------------------------------------------------------------------

function addPaymentRecord(ss, paymentData) {
  var sheet = ss.getSheetByName(SHEET_NAMES.PAYMENTS);
  if (!sheet) return;

  sheet.appendRow([
    paymentData.orderId || '',
    paymentData.paymentId || '',
    paymentData.paymentMethod || '',
    formatCurrency(paymentData.amount || 0),
    (paymentData.paymentStatus || '').toUpperCase(),
    paymentData.paymentDate || '',
    paymentData.refundStatus || ''
  ]);
}

function updatePaymentStatus(ss, orderNumber, newStatus) {
  var sheet = ss.getSheetByName(SHEET_NAMES.PAYMENTS);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === orderNumber) {
      sheet.getRange(i + 1, 5).setValue((newStatus || '').toUpperCase());
      if (newStatus && newStatus.toUpperCase() === 'PAID') {
        sheet.getRange(i + 1, 6).setValue(
          Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss')
        );
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// INVOICE TRACKING
// ---------------------------------------------------------------------------

function addInvoiceRecord(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  if (!sheet) throw new Error('Invoices sheet not found.');

  var existing = sheet.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (existing[i][0] === data.invoiceNumber) {
      return { action: 'skipped', reason: 'duplicate', invoiceNumber: data.invoiceNumber };
    }
  }

  sheet.appendRow([
    data.invoiceNumber || '',
    data.orderId || '',
    data.customer || '',
    data.invoiceDate || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy'),
    formatCurrency(data.invoiceTotal || 0),
    data.pdfLink || '',
    data.emailStatus || 'pending'
  ]);

  if (data.orderId) {
    var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    var row = findOrderRow(ordersSheet, data.orderId);
    if (row > 0) {
      ordersSheet.getRange(row, 23).setValue(data.invoiceNumber || '');
      ordersSheet.getRange(row, 24).setValue(data.pdfLink || '');
    }
  }

  return { action: 'added', invoiceNumber: data.invoiceNumber };
}

// ---------------------------------------------------------------------------
// ERROR LOGGING
// ---------------------------------------------------------------------------

function logFailedAutomation(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.FAILED);
    if (!sheet) return { action: 'no_sheet' };

    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');

    sheet.appendRow([
      now,
      data.jobType || 'unknown',
      data.orderId || '',
      data.error || '',
      data.retryCount || 0,
      'No'
    ]);

    return { action: 'logged' };
  } catch (e) {
    Logger.log('Failed to log automation error: ' + e.message);
    return { action: 'log_failed' };
  }
}

// ---------------------------------------------------------------------------
// SEARCH / LOOKUP
// ---------------------------------------------------------------------------

function getOrderByNumber(orderNumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) return null;

  var row = findOrderRow(ordersSheet, orderNumber);
  if (row <= 0) return null;

  var values = ordersSheet.getRange(row, 1, 1, ORDERS_HEADERS.length).getValues()[0];
  var result = {};
  for (var i = 0; i < ORDERS_HEADERS.length; i++) {
    result[ORDERS_HEADERS[i]] = values[i];
  }
  return result;
}

function findOrderRow(sheet, orderNumber) {
  if (!sheet || !orderNumber) return -1;
  var data = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === orderNumber) {
      return i + 1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// ON EDIT TRIGGER
// ---------------------------------------------------------------------------

function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.ORDERS) return;

  var col = e.range.getColumn();
  var row = e.range.getRow();
  if (row <= 1) return;

  if (col === 22 || col === 19) {
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    sheet.getRange(row, 27).setValue(now);
  }
}

// ---------------------------------------------------------------------------
// RECONCILIATION
// ---------------------------------------------------------------------------

function reconcileOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  var paymentsSheet = ss.getSheetByName(SHEET_NAMES.PAYMENTS);

  if (!ordersSheet || !paymentsSheet) {
    Logger.log('Reconciliation skipped: sheets not found.');
    return;
  }

  var ordersData = ordersSheet.getDataRange().getValues();
  var paymentsData = paymentsSheet.getDataRange().getValues();
  var issues = [];

  var paymentMap = {};
  for (var p = 1; p < paymentsData.length; p++) {
    paymentMap[paymentsData[p][0]] = {
      status: (paymentsData[p][4] || '').toString().toUpperCase(),
      row: p + 1
    };
  }

  for (var i = 1; i < ordersData.length; i++) {
    var orderNumber = ordersData[i][0];
    var paymentMethod = (ordersData[i][17] || '').toString().toUpperCase();
    var paymentStatus = (ordersData[i][18] || '').toString().toUpperCase();
    var orderStatus = (ordersData[i][21] || '').toString().toLowerCase();

    if (paymentStatus === 'PAID' && orderStatus === 'pending') {
      issues.push('Order ' + orderNumber + ': paid but still pending status');
    }

    if (paymentMethod === 'PREPAID' && paymentStatus === 'PAID' && !ordersData[i][20]) {
      issues.push('Order ' + orderNumber + ': prepaid+paid but missing Razorpay Payment ID');
    }

    var payRecord = paymentMap[orderNumber];
    if (payRecord && payRecord.status !== paymentStatus) {
      issues.push('Order ' + orderNumber + ': Orders sheet says ' + paymentStatus + ', Payments sheet says ' + payRecord.status);
    }

    if (!payRecord) {
      issues.push('Order ' + orderNumber + ': exists in Orders but missing from Payments sheet');
    }
  }

  if (issues.length > 0) {
    Logger.log('Reconciliation found ' + issues.length + ' issue(s):');
    for (var j = 0; j < issues.length; j++) {
      Logger.log('  - ' + issues[j]);
      logFailedAutomation({
        jobType: 'reconciliation',
        orderId: '',
        error: issues[j]
      });
    }
  } else {
    Logger.log('Reconciliation complete: no issues found.');
  }

  return { issues: issues.length, details: issues };
}

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRupees(amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount.replace(/[₹,]/g, '')) || 0;
  }
  if (!amount && amount !== 0) return '₹0.00';
  return '₹' + parseFloat(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCurrency(amount) {
  return formatRupees(amount);
}

function getSettingValue(settingName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    if (!sheet) return '';

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === settingName) {
        return (data[i][1] || '').toString().trim();
      }
    }
    return '';
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// MENU (for manual operations from the sheet)
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('The Sixth Ritu')
    .addItem('Initialize Sheets', 'initializeSheets')
    .addItem('Run Reconciliation', 'reconcileOrders')
    .addItem('View Dashboard', 'showDashboard')
    .addItem('Send Test Email', 'sendTestEmail')
    .addToUi();
}

function sendTestEmail() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    SpreadsheetApp.getUi().alert('Could not determine your email.');
    return;
  }

  try {
    GmailApp.sendEmail(email,
      'Test Email — The Sixth Ritu',
      'This is a test email from The Sixth Ritu order system.',
      {
        htmlBody: '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px;">'
          + '<h2 style="color:#a27d4e;">The Sixth Ritu</h2>'
          + '<p>Email system is working correctly!</p>'
          + '<p style="color:#6b6560;font-size:12px;">This is a test email sent from Google Apps Script.</p>'
          + '</div>',
        name: 'The Sixth Ritu'
      }
    );
    SpreadsheetApp.getUi().alert('Test email sent to ' + email + '!\n\nCheck your inbox (and spam folder).');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Error sending test email: ' + e.message);
  }
}

function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet || ordersSheet.getLastRow() <= 1) {
    SpreadsheetApp.getUi().alert('No orders found yet.');
    return;
  }

  var data = ordersSheet.getDataRange().getValues();
  var totalOrders = data.length - 1;
  var totalRevenue = 0;
  var paidOrders = 0;
  var codOrders = 0;
  var prepaidOrders = 0;
  var pendingOrders = 0;

  for (var i = 1; i < data.length; i++) {
    var total = parseFloat(String(data[i][16]).replace(/[₹,]/g, '')) || 0;
    var payStatus = (data[i][18] || '').toString().toUpperCase();
    var payMethod = (data[i][17] || '').toString().toUpperCase();
    var orderStatus = (data[i][21] || '').toString().toLowerCase();

    if (payStatus === 'PAID') {
      totalRevenue += total;
      paidOrders++;
    }
    if (payMethod === 'COD') codOrders++;
    if (payMethod === 'PREPAID') prepaidOrders++;
    if (orderStatus === 'pending') pendingOrders++;
  }

  var msg = 'The Sixth Ritu — Order Dashboard\n\n'
    + 'Total Orders: ' + totalOrders + '\n'
    + 'Paid Orders: ' + paidOrders + '\n'
    + 'Pending Orders: ' + pendingOrders + '\n'
    + 'Prepaid: ' + prepaidOrders + ' | COD: ' + codOrders + '\n'
    + 'Total Revenue (Paid): ' + formatRupees(totalRevenue) + '\n';

  SpreadsheetApp.getUi().alert(msg);
}
