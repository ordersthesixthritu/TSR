# The Sixth Ritu — Production Launch Checklist

Everything below must be completed before enabling live payments. The code is tested and ready — this checklist covers credentials, accounts, hosting, and configuration you need to supply.

**Status legend:** READY = code done, NEEDS CREDENTIALS = you supply values, ACTION REQUIRED = manual step needed

---

## Phase 1: Code Verification — COMPLETE

All backend code has been audited and tested:

| Component | Status | Notes |
|-----------|--------|-------|
| Checkout form → Backend | READY | Field mapping verified (mobile→phone, address1/2/landmark→address, pin→pincode) |
| COD order flow | READY | 32/32 integration tests passed |
| Prepaid order flow | READY | Razorpay order creation, signature verification, idempotent verify |
| Webhook handler | READY | Signature validation, deduplication via webhook_events table, guards for missing secret |
| Cart validation | READY | Server-side price lookup, quantity 1-10 limit, invalid slug rejection |
| Customer validation | READY | Indian phone [6-9]XXXXXXXXX, 6-digit pin, email format, required fields |
| Coupon validation | READY | Case-insensitive, expiry check, usage limit, minimum cart |
| Order status endpoint | READY | Email/phone verification, privacy-safe response |
| CORS | READY | Multi-origin support (localhost + thesixthritu.in + www) |
| XSS protection | READY | HTML escaping on all customer data in email templates |
| Database migrations | READY | Safe migration from old CHECK constraint + column addition |

### Security fixes applied this session:
1. CORS updated to support comma-separated production origins
2. Webhook endpoint guarded against missing secret and missing signature header
3. All email templates HTML-escape customer-supplied data (name, address, phone)
4. .env.example updated with production origins

---

## Phase 2: Hosting — ACTION REQUIRED

### Current setup:
- **thesixthritu.in** → Hostinger shared hosting (hPanel) serving static files (dist/) ✅
- **api.the-sixth-ritu.thegujaratidesigner.com** → Does not exist yet ❌

### The problem:
Hostinger shared hosting **cannot run Node.js**. The Express.js backend needs a separate server.

### Recommended options (pick one):

**Option A: Railway (EASIEST — recommended for launch)**
- Free tier: 500 hours/month + $5 credit
- Deploy: `cd server && railway up`
- Auto-SSL, auto-deploy from GitHub
- Custom domain: Point `api.the-sixth-ritu.thegujaratidesigner.com` CNAME to Railway

**Option B: Render**
- Free tier: 750 hours/month
- Deploy from GitHub, auto-SSL
- Custom domain supported

**Option C: Hostinger VPS (if you want everything in one place)**
- Requires plan upgrade to VPS
- Manual nginx reverse proxy setup needed
- More control, more setup work

### DNS setup (after choosing a host):
1. In your domain registrar (for thegujaratidesigner.com), add:
   - **Type:** CNAME
   - **Name:** `api.the-sixth-ritu`
   - **Value:** (provided by Railway/Render/your VPS IP)
2. Wait for DNS propagation (5-60 minutes)
3. Verify: `curl https://api.the-sixth-ritu.thegujaratidesigner.com/api/health`

---

## Phase 3: Razorpay Live Credentials — NEEDS CREDENTIALS

You need a **Razorpay live-mode account** (not test).

| What to do | Where |
|------------|-------|
| Generate live API keys | Razorpay Dashboard → Settings → API Keys → Generate Live Key |
| Set up webhook | Razorpay Dashboard → Settings → Webhooks → Create |

### Environment variables to fill:

```env
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_live_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### Webhook configuration in Razorpay Dashboard:
- **URL:** `https://api.the-sixth-ritu.thegujaratidesigner.com/api/payments/webhook`
- **Events to enable:**
  - `payment.captured`
  - `payment.failed`
  - `refund.created`
- **Secret:** Use the same value you put in `RAZORPAY_WEBHOOK_SECRET`

### How it works:
- Frontend loads Razorpay Checkout with the `keyId` returned from `/create-order`
- Customer pays → Razorpay sends `payment.captured` webhook → backend marks order paid
- Additionally, frontend calls `/verify` with the signature for instant confirmation
- Both paths are idempotent — if webhook and verify both fire, the second one is a no-op

---

## Phase 4: SMTP Email Credentials — NEEDS CREDENTIALS

For order confirmation emails, business notifications, and invoice delivery.

| Variable | Example Value |
|----------|---------------|
| `SMTP_HOST` | `smtp.gmail.com` or `smtp.zoho.in` or `smtp.hostinger.com` |
| `SMTP_PORT` | `587` (TLS) or `465` (SSL) |
| `SMTP_USER` | `care@thesixthritu.in` (the "from" address) |
| `SMTP_PASS` | App password (NOT your login password) |
| `BUSINESS_EMAIL` | Your email that receives new-order alerts |

### If using Gmail:
1. Enable 2-factor authentication on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Create an App Password for "Mail"
4. Use that 16-character password as `SMTP_PASS`

### If using Hostinger email (care@thesixthritu.in):
1. Check Hostinger hPanel → Email → SMTP settings
2. Typical: `smtp.hostinger.com`, port `465` (SSL)
3. Use the full email as `SMTP_USER` and its password as `SMTP_PASS`

### What gets sent automatically:
- **Order confirmation** to customer (branded HTML email with order details)
- **New order alert** to `BUSINESS_EMAIL` (order summary for you)
- **Invoice email** to customer (PDF attachment, for prepaid orders only)

### Email queue:
- Emails queue in the database and send every 30 seconds
- Failed emails retry up to 3 times
- Permanently failed emails are logged in `failed_jobs` table
- If SMTP is not configured, emails queue but don't send (no crash)

---

## Phase 5: Google Sheets Sync — NEEDS CREDENTIALS

For a real-time orders dashboard in Google Sheets.

### Step-by-step:
1. Go to https://console.cloud.google.com
2. Create a project (or use existing)
3. Enable **Google Sheets API**
4. Create a **Service Account** (IAM & Admin → Service Accounts)
5. Download the JSON key file → place it at `server/service-account.json`
6. Create a Google Sheet named "**The Sixth Ritu — Orders**"
7. Share the sheet with the service account email (Editor access)
8. Copy the spreadsheet ID from the URL

### Environment variables:
```env
GOOGLE_SERVICE_ACCOUNT_KEY=./service-account.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
```

### Sheet columns (auto-populated):
Order #, Date, Customer, Email, Phone, Items, Subtotal, Discount, Total, Payment Method, Payment Status, Status, Tracking #, Courier, Invoice #

### Google Apps Script (optional advanced dashboard):
- See `google-apps-script/SETUP.md` for detailed steps
- Adds: Customers tab, Payments tab, Invoices tab, Failed Automations, daily reconciliation
- The backend works fine without it — it's a nice-to-have

---

## Phase 6: GST Invoice — VERIFY DETAILS

Pre-configured values — **please verify with your CA:**

| Setting | Value | Status |
|---------|-------|--------|
| GSTIN | `24AJWPG1884D1Z2` | ✅ Confirmed by you |
| GST Rate | 28% | ✅ Correct for HSN 3303 (perfumes) — confirm with CA |
| HSN Code | 3303 | ✅ Perfumes / fragrances |
| Seller Name | The Sixth Ritu | ✅ |
| Seller Address | *(empty)* | ❌ **FILL IN** your registered business address |
| Seller State | Gujarat | ✅ |

### How GST invoices work:
- Prices are **GST-inclusive** (₹1,499 includes 28% GST)
- Reverse calculation: Taxable amount = Total ÷ 1.28
- **Intra-state (Gujarat→Gujarat):** CGST 14% + SGST 14%
- **Inter-state (Gujarat→Other):** IGST 28%
- Invoice numbers: TSR/202627/0001, TSR/202627/0002, etc.
- PDFs generated automatically for **paid** orders only
- Stored in `server/data/invoices/` and recorded in database

### Example calculation (₹1,499 order to Gujarat):
```
Total (GST-inclusive):  ₹1,499.00
Taxable amount:         ₹1,171.09  (1499 ÷ 1.28)
CGST (14%):             ₹163.96
SGST (14%):             ₹163.95
Grand Total:            ₹1,499.00
```

---

## Phase 7: Admin Authentication — CHANGE BEFORE PRODUCTION

| Variable | Current (UNSAFE) | Action |
|----------|-----------------|--------|
| `ADMIN_EMAIL` | `admin@thesixthritu.com` | Change to your real admin email |
| `ADMIN_PASSWORD` | `changeme123` | **Change to a strong password (16+ chars)** |
| `ADMIN_JWT_SECRET` | `change-this-to-a-random-string` | **Generate: `openssl rand -hex 32`** |

> **Important:** The admin password is hashed with bcrypt (12 rounds). It's only used at first database creation. If the database already exists, changing .env won't update the password — you'd need to delete the database and restart, or use a migration script.

---

## Phase 8: Frontend Production URL — READY

Already configured in `dist/app.js` line 54:
```
localhost → http://localhost:3001/api
production → https://api.the-sixth-ritu.thegujaratidesigner.com/api
```

The detection is automatic based on `window.location.hostname`. No changes needed unless you use a different API domain.

---

## Phase 9: Deployment Steps

### Backend deployment (after choosing hosting):

1. **Prepare production .env file** with all real credentials
2. **Deploy the `server/` directory** to your chosen host:
   ```
   server/
   ├── index.js          (entry point)
   ├── package.json      (dependencies)
   ├── routes/
   ├── services/
   ├── db/
   ├── data/             (created automatically — SQLite database + invoices)
   └── .env              (your production secrets — never commit this)
   ```
3. **Install dependencies:** `npm install --production`
4. **Start server:** `node index.js`
5. **Verify:** `curl https://api.the-sixth-ritu.thegujaratidesigner.com/api/health`

### Frontend update (Hostinger):
1. Upload the latest `dist/` folder via Hostinger file manager or FTP
2. Ensure `dist/checkout/index.html` includes the Razorpay script
3. Ensure `dist/order-confirmed/index.html` exists

### Backup plan:
- SQLite database: `server/data/tsr.db` — back up this file regularly
- Invoices: `server/data/invoices/` — back up this folder
- If something breaks: stop server, restore `tsr.db` from backup, restart

---

## Phase 10: Pre-Go-Live Testing Checklist

After deploying the backend and filling in all credentials:

- [ ] Backend health: `GET /api/health` returns `{"status":"ok"}`
- [ ] Place a test COD order from the live website
- [ ] Verify order appears in Google Sheet
- [ ] Verify customer confirmation email received
- [ ] Verify business notification email received
- [ ] Place a test prepaid order (Razorpay test mode first)
- [ ] Verify Razorpay payment flow completes
- [ ] Verify order status page works at `/track-order`
- [ ] Verify invoice PDF is generated for prepaid order
- [ ] Verify invoice email arrives with PDF attachment
- [ ] Test TSR200 coupon code (₹200 off on 1+ bottle)
- [ ] Switch Razorpay to live keys
- [ ] Place a real ₹1 test transaction (Razorpay test mode → live)
- [ ] Refund the test transaction
- [ ] Confirm all data flows: database → sheet → emails → invoices

---

## Summary: What YOU Need to Provide

| # | Item | Priority |
|---|------|----------|
| 1 | Choose backend hosting (Railway / Render / VPS) | CRITICAL |
| 2 | Set up DNS for api.the-sixth-ritu.thegujaratidesigner.com | CRITICAL |
| 3 | Razorpay live API keys + webhook secret | CRITICAL |
| 4 | SMTP credentials (email provider + app password) | CRITICAL |
| 5 | BUSINESS_EMAIL for order notifications | CRITICAL |
| 6 | Google service account JSON key + spreadsheet ID | RECOMMENDED |
| 7 | SELLER_ADDRESS (registered business address for invoices) | REQUIRED |
| 8 | Change ADMIN_PASSWORD and ADMIN_JWT_SECRET | REQUIRED |
| 9 | Verify GST rate (28%) with your CA | RECOMMENDED |

---

## What's Already Working (Code Complete)

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Checkout form integration | READY | Manually tested in browser |
| COD order flow | READY | 32/32 automated tests passed |
| Prepaid flow (Razorpay) | READY | Tested (needs live keys) |
| Order confirmation page | READY | Renders with order details |
| Server-side cart validation | READY | Invalid slug, qty limits, price lookup |
| Customer validation | READY | Phone, email, pin, name, state |
| Coupon validation (TSR200) | READY | Case-insensitive, expiry, min cart |
| Order database (SQLite) | READY | With safe migrations |
| Email notifications | READY | Queued, retry, branded HTML |
| Google Sheets sync | READY | 15-column order row, update support |
| GST invoice PDF generation | READY | CGST/SGST/IGST, reverse calculation |
| Webhook signature verification | READY | HMAC-SHA256, deduplication |
| Payment reconciliation | READY | Webhook + verify dual path |
| Refund tracking | READY | Via refund.created webhook |
| Order status lookup | READY | Email/phone verified access |
| Google Apps Script (advanced) | READY | Dashboard, reconciliation, fallback sync |
