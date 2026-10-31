// ============================================================================
// THE SIXTH RITU — Google Apps Script Order Management
// ============================================================================
// This script manages order data in Google Sheets for The Sixth Ritu.
// It provides a web endpoint (doPost) for the backend to sync orders,
// sheet initialization, order management helpers, and scheduled reconciliation.
//
// SETUP: Run initializeSheets() once from the Script Editor to create all tabs.
//        Set AUTH_TOKEN in Script Properties (File > Project properties > Script properties).
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
  ['Business Email', ''],
  ['Business Registration', '24AJWPG1884D1Z2'],
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
  return jsonResponse({ status: 'ok', service: 'The Sixth Ritu Order Sync' });
}

function jsonResponse(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

  // Remove the default "Sheet1" if it exists and is empty
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

  // Auto-resize columns (up to 20 to stay within limits)
  var colCount = Math.min(headers.length, 20);
  for (var i = 1; i <= colCount; i++) {
    sheet.autoResizeColumn(i);
  }

  return sheet;
}

function applyConditionalFormatting(ss) {
  var ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) return;

  // Payment Status column (S = col 19)
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

  // Order Status column (V = col 22)
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

  // Duplicate check
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

  // Update Customers sheet
  updateCustomerRecord(ss, orderData);

  // Add Payments record
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
    ordersSheet.getRange(row, 22).setValue(status); // Order Status
  }
  if (paymentStatus) {
    ordersSheet.getRange(row, 19).setValue(paymentStatus.toUpperCase()); // Payment Status
  }
  ordersSheet.getRange(row, 27).setValue(now); // Last Updated

  // Update payment sheet too
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
      existingRow = i + 1; // 1-indexed
      break;
    }
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');

  if (existingRow > 0) {
    // Update existing customer
    var currentOrders = parseInt(sheet.getRange(existingRow, 7).getValue()) || 0;
    var currentSpent = parseFloat(String(sheet.getRange(existingRow, 8).getValue()).replace(/[₹,]/g, '')) || 0;

    sheet.getRange(existingRow, 1).setValue(orderData.customerName || data[existingRow - 1][0]);
    sheet.getRange(existingRow, 3).setValue(orderData.mobile || data[existingRow - 1][2]);
    sheet.getRange(existingRow, 4).setValue(orderData.city || data[existingRow - 1][3]);
    sheet.getRange(existingRow, 5).setValue(orderData.state || data[existingRow - 1][4]);
    sheet.getRange(existingRow, 7).setValue(currentOrders + 1);
    sheet.getRange(existingRow, 8).setValue(formatCurrency(currentSpent + (orderData.finalTotal || 0)));
  } else {
    // New customer
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

  // Duplicate check
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

  // Update invoice fields on the Orders sheet too
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
      return i + 1; // 1-indexed
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
  if (row <= 1) return; // header row

  // Order Status column = 22, Payment Status column = 19
  if (col === 22 || col === 19) {
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    sheet.getRange(row, 27).setValue(now); // Last Updated
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

  // Build a map of payment statuses from Payments sheet
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

    // Check: paid order should not be "pending"
    if (paymentStatus === 'PAID' && orderStatus === 'pending') {
      issues.push('Order ' + orderNumber + ': paid but still pending status');
    }

    // Check: prepaid confirmed order should have payment ID
    if (paymentMethod === 'PREPAID' && paymentStatus === 'PAID' && !ordersData[i][20]) {
      issues.push('Order ' + orderNumber + ': prepaid+paid but missing Razorpay Payment ID');
    }

    // Check: payment sheet mismatch
    var payRecord = paymentMap[orderNumber];
    if (payRecord && payRecord.status !== paymentStatus) {
      issues.push('Order ' + orderNumber + ': Orders sheet says ' + paymentStatus + ', Payments sheet says ' + payRecord.status);
    }

    // Check: missing from Payments sheet
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

function formatCurrency(amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount.replace(/[₹,]/g, '')) || 0;
  }
  if (!amount && amount !== 0) return '₹0.00';
  return '₹' + parseFloat(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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
    .addToUi();
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

  var msg = '📊 The Sixth Ritu — Order Dashboard\n\n'
    + 'Total Orders: ' + totalOrders + '\n'
    + 'Paid Orders: ' + paidOrders + '\n'
    + 'Pending Orders: ' + pendingOrders + '\n'
    + 'Prepaid: ' + prepaidOrders + ' | COD: ' + codOrders + '\n'
    + 'Total Revenue (Paid): ₹' + totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 }) + '\n';

  SpreadsheetApp.getUi().alert(msg);
}
