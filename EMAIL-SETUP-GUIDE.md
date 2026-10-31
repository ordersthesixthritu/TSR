# THE SIXTH RITU — Email + Google Sheets Setup Guide

**For: orders.thesixthritu@gmail.com**
**Date: 31 October 2026**

---

## WHAT'S ALREADY BUILT (no coding needed)

Your website already has all this code ready — it just needs to be "switched on" by setting up Google Apps Script.

When a customer places an order, this will happen AUTOMATICALLY:

1. **Customer gets a beautiful branded email** — "Thank you for your order" with order details, items, total, shipping address, payment method
2. **You get an email notification** — "New Order TSR-XXXXXX" with customer details, items, amount, payment method
3. **For prepaid (online) orders** — A formal invoice email is sent to the customer with full invoice details
4. **Order is logged in Google Sheets** — All order data automatically goes to your Google Sheet

**No SMTP, no App Passwords, no service accounts needed.** Everything runs through Google Apps Script.

---

## STEP 1: CREATE A GOOGLE SHEET (2 minutes)

1. Open Chrome browser
2. Sign in to **orders.thesixthritu@gmail.com**
3. Go to https://sheets.google.com
4. Click **"+ Blank"** to create a new spreadsheet
5. Name it: **The Sixth Ritu — Orders**
6. Keep this tab open — you'll need it in Step 2

---

## STEP 2: SET UP GOOGLE APPS SCRIPT (5 minutes)

### 2.1 — Open Apps Script

1. In your **"The Sixth Ritu — Orders"** Google Sheet
2. Click **Extensions** → **Apps Script**
3. Delete any code that's already there

### 2.2 — Paste the Code

1. Open the file `google-apps-script/Code.gs` from your project folder
2. Copy ALL the code (Ctrl+A then Ctrl+C)
3. Paste it into the Apps Script editor (Ctrl+V)
4. Click the **save icon** (or Ctrl+S)

### 2.3 — Initialize the Sheets

1. In the function dropdown at the top, select **`initializeSheets`**
2. Click **Run** (the ▶ play button)
3. When asked for permissions, click **"Review permissions"** → Choose your account → Click **"Allow"**
4. Go back to your spreadsheet — you should now see 6 tabs: Orders, Customers, Payments, Invoices, Failed Automations, Settings

### 2.4 — Set the Auth Token

1. In the Apps Script editor, click the **⚙️ gear icon** on the left sidebar (**Project Settings**)
2. Scroll down to **"Script Properties"**
3. Click **"Add script property"**
4. Property name: `AUTH_TOKEN`
5. Value: Make up a long random string (at least 32 characters), like: `tsr2026ordersync_ABCDEFgh12345678`
6. Click **"Save script properties"**
7. **WRITE DOWN this token** — you'll need it in Step 3

### 2.5 — Deploy as Web App

1. Click **"Deploy"** → **"New deployment"**
2. Click the **gear icon** next to "Select type" → Choose **"Web app"**
3. Set:
   - Description: **Order notifications**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **"Deploy"**
5. Google will ask for permissions again — click **"Authorize access"** → Choose your account → **"Allow"**
6. You'll see a **Web app URL** — it looks like: `https://script.google.com/macros/s/LONG_STRING/exec`
7. **COPY THIS URL** — you'll need it in Step 3

### 2.6 — Test Email (Optional)

1. Go back to your Google Sheet
2. You should see a menu: **The Sixth Ritu** (next to Help)
3. Click **The Sixth Ritu** → **Send Test Email**
4. Check your inbox (orders.thesixthritu@gmail.com) — you should receive a test email

---

## STEP 3: ADD SETTINGS IN VERCEL (2 minutes)

### 3.1 — Open Vercel Environment Variables

1. Go to: https://vercel.com
2. Sign in
3. Click on your project **"TSR"** (or "tsr-zsaf")
4. Click **"Settings"** tab at the top
5. Click **"Environment Variables"** in the left sidebar

### 3.2 — Add These Settings

Add these one by one. For each one:
- Type the **Name** in the "Key" field
- Type the **Value** in the "Value" field
- Make sure all three checkboxes are checked (Production, Preview, Development)
- Click **"Save"**

| # | Name (Key) | Value | What it does |
|---|-----------|-------|-------------|
| 1 | `GOOGLE_APPS_SCRIPT_URL` | The Web App URL from Step 2.5 | Connects your website to Google Sheets + Email |
| 2 | `GOOGLE_APPS_SCRIPT_TOKEN` | The AUTH_TOKEN from Step 2.4 | Security key so only your website can send data |

### 3.3 — Add Invoice Settings (for invoice PDF in admin panel)

| # | Name (Key) | Value | What it does |
|---|-----------|-------|-------------|
| 3 | `SELLER_NAME` | `The Sixth Ritu` | Business name on invoice |
| 4 | `SELLER_ADDRESS` | Your full business address | Address shown on invoice |

### 3.4 — Redeploy

After adding ALL the above settings:

1. Go to the **"Deployments"** tab in your Vercel project
2. Find the latest deployment (top of the list)
3. Click the **three dots** (⋯) on the right side
4. Click **"Redeploy"**
5. Click **"Redeploy"** again to confirm
6. Wait 1-2 minutes for it to finish

**That's it! Everything will now work automatically.**

---

## STEP 4: UPDATE SETTINGS IN GOOGLE SHEET (1 minute)

1. Open your **"The Sixth Ritu — Orders"** Google Sheet
2. Go to the **Settings** tab
3. Fill in:
   - **Business Email**: `orders.thesixthritu@gmail.com`
   - **Business Address**: Your full business address (this shows on invoice emails)

---

## WHAT HAPPENS AFTER SETUP

### When a customer places a COD order:
1. Customer gets "Order Confirmed" email with items, total, address, "Payment will be collected at delivery"
2. You get "New Order" notification email with all details
3. Order is logged in Google Sheet (Orders, Customers, Payments tabs)

### When a customer pays online (Razorpay):
1. Customer gets "Order Confirmed" email with items, total, address, "Prepaid (Online)"
2. You get "New Order" notification email
3. A formal **Invoice email** is sent to the customer with full invoice details
4. Invoice record is logged in the Invoices tab
5. Order is logged in Google Sheet

### Invoice Details (in email):
- Clean branded INVOICE header
- Invoice number, date, order number
- Seller details (from Settings tab)
- Customer shipping details
- Items table with quantities, rates, amounts
- Subtotal, discount (if any), shipping, total
- "All prices are inclusive of applicable taxes" note
- Sequential invoice numbers: TSR/2627/0001, TSR/2627/0002, etc.

---

## HOW TO TEST

After completing all steps above:

1. Go to your website: https://thesixthritu.in
2. Add a perfume to cart
3. Place a test COD order with YOUR email address
4. Check your email — you should receive the order confirmation within 1-2 minutes
5. Check orders.thesixthritu@gmail.com — you should see the owner notification
6. Check the Google Sheet — the order should appear in the Orders tab

> **For invoice testing:** Place an online (Razorpay) test order. The invoice email will be sent automatically after payment is verified. Ask before testing with real payment.

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| No emails received | Check spam folder. Make sure Apps Script is deployed correctly (Step 2.5). |
| "Unauthorized" error in Vercel logs | The GOOGLE_APPS_SCRIPT_TOKEN in Vercel doesn't match the AUTH_TOKEN in Script Properties. |
| "not configured" in Vercel logs | GOOGLE_APPS_SCRIPT_URL is missing in Vercel env vars. |
| Google Sheet not updating | Run `initializeSheets` again from Apps Script. Check the "Failed Automations" tab. |
| Apps Script permission error | Re-authorize: go to Apps Script → Run → initializeSheets → Allow permissions. |
| Emails going to spam | Mark the first email as "Not spam". After a few emails, Gmail will learn. |
| "Exceeded daily quota" error | Google allows ~100 emails/day for personal accounts. This handles ~33 orders/day. |

---

## ENVIRONMENT VARIABLES CHECKLIST

| Variable | Required | Example Value |
|----------|----------|---------------|
| `GOOGLE_APPS_SCRIPT_URL` | Yes | `https://script.google.com/macros/s/.../exec` |
| `GOOGLE_APPS_SCRIPT_TOKEN` | Yes | Your AUTH_TOKEN string |
| `SELLER_NAME` | For invoices | `The Sixth Ritu` |
| `SELLER_ADDRESS` | For invoices | Your business address |

**Only 2 required env vars!** No SMTP, no Gmail App Passwords, no service accounts.

---

## HOW IT WORKS (Technical Summary)

```
Customer places order
    ↓
Website backend (Vercel) processes order + payment
    ↓
Backend sends order data to Google Apps Script URL
    ↓
Google Apps Script does everything:
  ✓ Logs order in Google Sheet (Orders + Customers + Payments)
  ✓ Sends customer confirmation email (GmailApp)
  ✓ Sends you notification email (GmailApp)
  ✓ For paid orders: sends invoice email (GmailApp)
  ✓ Logs invoice in Invoices sheet
  ✓ Logs any errors in Failed Automations sheet
```

**Total setup time: ~10 minutes**

No code changes needed. Everything is already built.
