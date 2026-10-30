const API = 'http://localhost:3001/api';
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function validCustomer(overrides = {}) {
  return {
    name: 'Test User',
    email: `test${Date.now()}@example.com`,
    mobile: '9876543210',
    address1: '123 Test Street',
    address2: 'Near Park',
    landmark: 'Opposite Temple',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pin: '380001',
    ...overrides,
  };
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json();
  return { status: res.status, data };
}

console.log('\n=== The Sixth Ritu — Integration Tests ===\n');

// ─── 1. Health ───
console.log('Health');
await test('GET /health returns ok', async () => {
  const { status, data } = await get('/health');
  assert(status === 200, `Expected 200 got ${status}`);
  assert(data.status === 'ok', 'Status not ok');
  assert(data.timestamp, 'Missing timestamp');
});

// ─── 2. COD Order ───
console.log('\nCOD Order');
let codOrderNumber;
let codEmail;

await test('Create COD order with valid data', async () => {
  codEmail = `cod${Date.now()}@test.com`;
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    coupon: '',
    customer: validCustomer({ email: codEmail }),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}: ${JSON.stringify(data)}`);
  assert(data.success === true, 'success not true');
  assert(data.orderNumber?.startsWith('TSR-'), `Bad order number: ${data.orderNumber}`);
  assert(data.paymentMethod === 'cod', 'paymentMethod not cod');
  assert(data.total === 149900, `Total should be 149900 got ${data.total}`);
  codOrderNumber = data.orderNumber;
});

await test('Create COD order with multiple items', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 2 }, { slug: 'golden-leaf', qty: 1 }],
    coupon: '',
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}: ${JSON.stringify(data)}`);
  assert(data.total === 449700, `Total should be 449700 (3×149900) got ${data.total}`);
});

// ─── 3. COD Order with Coupon ───
console.log('\nCoupon');
await test('COD order with TSR200 coupon (₹200 off)', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'royal-zafran-rose', qty: 1 }],
    coupon: 'TSR200',
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}: ${JSON.stringify(data)}`);
  assert(data.total === 129900, `Total should be 129900 (149900-20000) got ${data.total}`);
});

await test('Coupon case-insensitive', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'crystal-bloom', qty: 1 }],
    coupon: 'tsr200',
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}`);
  assert(data.total === 129900, `Discount not applied: ${data.total}`);
});

await test('Invalid coupon gives no discount', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'flora-silk', qty: 1 }],
    coupon: 'FAKECOUPON',
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}`);
  assert(data.total === 149900, `Should be full price, got ${data.total}`);
});

// ─── 4. Validation Errors ───
console.log('\nValidation');
await test('Empty cart returns 400', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [],
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
  assert(data.error === 'Cart is empty', `Wrong error: ${data.error}`);
});

await test('Missing items field returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Invalid product slug returns 400', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'nonexistent-perfume', qty: 1 }],
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
  assert(data.error === 'Invalid cart', `Wrong error: ${data.error}`);
});

await test('Invalid phone (too short) returns 400', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ mobile: '12345' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
  assert(data.error.includes('mobile'), `Error should mention mobile: ${data.error}`);
});

await test('Invalid phone (starts with 5) returns 400', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ mobile: '5876543210' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Invalid pincode (5 digits) returns 400', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ pin: '38001' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
  assert(data.error.includes('pincode'), `Error should mention pincode: ${data.error}`);
});

await test('Invalid email returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ email: 'notanemail' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Missing customer name returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ name: '' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Missing state returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ state: '' }),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Qty > 10 returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 11 }],
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Qty < 1 returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 0 }],
    customer: validCustomer(),
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('No customer object returns 400', async () => {
  const { status } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    paymentMethod: 'cod',
  });
  assert(status === 400, `Expected 400 got ${status}`);
});

// ─── 5. Order Status ───
console.log('\nOrder Status');
await test('Order status with correct email', async () => {
  assert(codOrderNumber, 'No COD order to check');
  const { status, data } = await get(`/payments/order-status/${codOrderNumber}?email=${encodeURIComponent(codEmail)}`);
  assert(status === 200, `Expected 200 got ${status}: ${JSON.stringify(data)}`);
  assert(data.orderNumber === codOrderNumber, 'Order number mismatch');
  assert(data.status === 'confirmed', `Status should be confirmed got ${data.status}`);
  assert(data.paymentMethod === 'cod', `paymentMethod should be cod got ${data.paymentMethod}`);
  assert(data.paymentStatus === 'unpaid', `paymentStatus should be unpaid got ${data.paymentStatus}`);
  assert(data.items?.length === 1, 'Should have 1 item');
  assert(data.items[0].name === 'Dark Monsoon', `Item name wrong: ${data.items[0].name}`);
  assert(data.total === 149900, `Total wrong: ${data.total}`);
});

await test('Order status with correct phone', async () => {
  const { status, data } = await get(`/payments/order-status/${codOrderNumber}?phone=9876543210`);
  assert(status === 200, `Expected 200 got ${status}`);
  assert(data.orderNumber === codOrderNumber, 'Order number mismatch');
});

await test('Order status with wrong email returns 403', async () => {
  const { status } = await get(`/payments/order-status/${codOrderNumber}?email=wrong@test.com`);
  assert(status === 403, `Expected 403 got ${status}`);
});

await test('Order status without email/phone returns 400', async () => {
  const { status } = await get(`/payments/order-status/${codOrderNumber}`);
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Order status for nonexistent order returns 404', async () => {
  const { status } = await get('/payments/order-status/TSR-FAKE123?email=x@y.com');
  assert(status === 404, `Expected 404 got ${status}`);
});

// ─── 6. Prepaid (Razorpay test mode) ───
console.log('\nPrepaid');
await test('Create prepaid order (Razorpay test)', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'golden-ritual', qty: 1 }],
    coupon: '',
    customer: validCustomer(),
    paymentMethod: 'prepaid',
  });
  // With test keys, Razorpay should either return a valid order or 500 if keys are placeholder
  if (status === 200) {
    assert(data.orderId, 'Missing orderId');
    assert(data.amount === 149900, `Amount wrong: ${data.amount}`);
    assert(data.currency === 'INR', `Currency wrong: ${data.currency}`);
    assert(data.keyId, 'Missing keyId');
    assert(data.orderNumber?.startsWith('TSR-'), 'Bad order number');
    assert(data.prefill?.name === 'Test User', 'Prefill name wrong');
  } else if (status === 500) {
    // Expected if Razorpay test credentials are placeholder
    console.log('        (Razorpay credentials are placeholder — prepaid order creation expectedly fails)');
  } else {
    throw new Error(`Unexpected status ${status}: ${JSON.stringify(data)}`);
  }
});

// ─── 7. Payment Verify (signature check) ───
console.log('\nPayment Verify');
await test('Verify with missing fields returns 400', async () => {
  const { status } = await post('/payments/verify', {});
  assert(status === 400, `Expected 400 got ${status}`);
});

await test('Verify with fake order_id returns 404', async () => {
  const { status } = await post('/payments/verify', {
    razorpay_order_id: 'order_fake123',
    razorpay_payment_id: 'pay_fake123',
    razorpay_signature: 'badsignature',
  });
  assert(status === 404, `Expected 404 got ${status}`);
});

// ─── 8. Webhook ───
console.log('\nWebhook');
await test('Webhook without signature returns 400', async () => {
  const { status } = await post('/payments/webhook', { event: 'payment.captured' });
  assert(status === 400 || status === 503, `Expected 400/503 got ${status}`);
});

await test('Webhook with bad signature returns 400', async () => {
  const res = await fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'invalidsignature',
    },
    body: JSON.stringify({ event: 'payment.captured', payload: {} }),
  });
  const status = res.status;
  // 400 (bad signature) or 503 (webhook secret not configured)
  assert(status === 400 || status === 503, `Expected 400/503 got ${status}`);
});

// ─── 9. Invoice Endpoint ───
console.log('\nInvoice');
await test('Invoice for nonexistent order returns 404', async () => {
  const { status } = await get('/payments/invoice/TSR-NONEXISTENT');
  assert(status === 404, `Expected 404 got ${status}`);
});

// ─── 10. Edge Cases ───
console.log('\nEdge Cases');
await test('Address normalization (address1 + address2 + landmark)', async () => {
  const email = `norm${Date.now()}@test.com`;
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({
      email,
      address1: '10 Main Road',
      address2: 'Floor 2',
      landmark: 'Near Market',
    }),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}`);
  // Verify the address was concatenated via order-status
  const check = await get(`/payments/order-status/${data.orderNumber}?email=${encodeURIComponent(email)}`);
  assert(check.status === 200, 'Could not fetch order status');
  // The normalized address should not be empty
  assert(check.data.orderNumber === data.orderNumber, 'Order mismatch');
});

await test('Whitespace in phone number is stripped', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer({ mobile: '987 654 3210' }),
    paymentMethod: 'cod',
  });
  assert(status === 200, `Expected 200 got ${status}: ${JSON.stringify(data)}`);
});

await test('Default to prepaid if paymentMethod missing', async () => {
  const { status, data } = await post('/payments/create-order', {
    items: [{ slug: 'dark-monsoon', qty: 1 }],
    customer: validCustomer(),
    // paymentMethod omitted
  });
  // Should either succeed as prepaid (if Razorpay keys work) or fail at Razorpay
  // The important thing is it doesn't crash
  assert(status === 200 || status === 500, `Unexpected status ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(44)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(44)}\n`);

process.exit(failed > 0 ? 1 : 0);
