# Razorpay Payment Setup

## Overview

The Sixth Ritu uses Razorpay as its payment gateway for processing Indian Rupee (INR) transactions. All prices are stored in the database in paise (1 INR = 100 paise) and validated server-side before creating payment orders.

## Getting API Keys

1. Sign up at [dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Navigate to **Settings > API Keys**
3. Generate keys in **Test mode** first for development
4. Switch to **Live mode** and generate production keys when ready to accept real payments

Key formats:
- Test: `rzp_test_xxxxxxxxxxxx`
- Live: `rzp_live_xxxxxxxxxxxx`

## Environment Variables

Add these to `server/.env`:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

**Security:** The Key Secret and Webhook Secret must never be exposed in frontend code. Only `RAZORPAY_KEY_ID` is sent to the browser (via the `/api/payments/create-order` response).

## Payment Flow

### Step 1: Create Order

The frontend sends the cart items to the backend:

```
POST /api/payments/create-order
Body: { items: [{ slug: "dark-monsoon", qty: 1 }], coupon: "TSR200" }
```

The backend:
- Validates each item exists in the database and is active
- Looks up the **database price** (not the client-submitted price)
- Validates and applies the coupon discount if provided
- Creates a Razorpay order via the API
- Stores the order in the local database with status "pending"
- Returns `{ orderId, amount, currency, keyId, orderNumber }`

### Step 2: Razorpay Checkout

The frontend opens the Razorpay checkout modal using the returned `orderId` and `keyId`. The customer completes payment in Razorpay's secure UI.

### Step 3: Verify Payment

On successful payment, the frontend sends the signature to the backend:

```
POST /api/payments/verify
Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
```

The backend:
- Checks for duplicate verification (idempotent -- already-paid orders return success)
- Computes the expected HMAC-SHA256 signature: `HMAC(razorpay_order_id|razorpay_payment_id, KEY_SECRET)`
- Compares against the submitted signature
- Updates the order status to "paid"
- Increments coupon usage count if a coupon was applied

### Step 4: Webhook (Backup)

Razorpay sends webhook events to confirm payment status server-side. This handles cases where the customer closes the browser before the frontend can call `/verify`.

```
POST /api/payments/webhook
```

The backend:
- Verifies the webhook signature using `RAZORPAY_WEBHOOK_SECRET`
- Processes events: `payment.captured`, `payment.failed`, `refund.created`
- Updates order status only if not already in the target state (idempotent)

## Security Measures

| Measure | Implementation |
|---|---|
| Server-side price validation | Cart prices are looked up from the database, never trusted from the client |
| HMAC signature verification | Both `/verify` and `/webhook` verify cryptographic signatures |
| Duplicate payment detection | Orders already marked "paid" return success without re-processing |
| Idempotent webhooks | Webhook only updates status if not already in the target state |
| Coupon validation | Coupons are validated server-side (active, within usage limits, not expired, meets minimum cart) |
| Coupon usage tracking | `current_uses` is incremented only after successful payment verification |
| Raw body for webhooks | The `/webhook` route uses `express.raw()` to preserve the original body for signature verification |

## Webhook Setup in Razorpay Dashboard

1. Go to **Settings > Webhooks** in the Razorpay Dashboard
2. Click **Add New Webhook**
3. Set the URL: `https://yourdomain.com/api/payments/webhook`
4. Select events:
   - `payment.captured`
   - `payment.failed`
   - `refund.created`
5. Set a secret and copy it to `RAZORPAY_WEBHOOK_SECRET` in your `.env`
6. Save

## Testing

Use these Razorpay test credentials:

| Field | Value |
|---|---|
| Card Number | 4111 1111 1111 1111 |
| Expiry | Any future date |
| CVV | Any 3 digits |
| OTP (if prompted) | 1234 |

In test mode, no real money is charged. Switch to live keys only after thorough testing.

## Prices

All prices in the database are stored in **paise** (smallest currency unit):

- 149900 paise = 1,499 INR
- 20000 paise = 200 INR (TSR200 coupon discount)

The frontend converts paise to rupees for display: `price / 100`.
