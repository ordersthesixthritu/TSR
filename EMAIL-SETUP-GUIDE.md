# THE SIXTH RITU — Email + Invoice + Google Sheets Setup Guide

**For: orders.thesixthritu@gmail.com**
**Date: 31 October 2026**

---

## WHAT'S ALREADY BUILT (no coding needed)

Your website already has all this code ready — it just needs to be "switched on" by adding some settings in Vercel.

When a customer places an order, this will happen AUTOMATICALLY:

1. **Customer gets a beautiful branded email** — "Thank you for your order" with order details, items, total, shipping address, payment method
2. **You get an email notification** — "New Order TSR-XXXXXX" with customer details, items, amount, payment method
3. **For prepaid (online) orders** — A proper GST tax invoice PDF is generated and emailed to the customer as an attachment
4. **Order is logged in Google Sheets** — All order data automatically goes to your Google Sheet

---

## STEP 1: GMAIL APP PASSWORD (5 minutes)

This is needed so your website can send emails from orders.thesixthritu@gmail.com

### 1.1 — Enable 2-Step Verification

1. Open Chrome browser
2. Go to: https://myaccount.google.com/security
3. Sign in with **orders.thesixthritu@gmail.com**
4. Find **"2-Step Verification"** and click on it
5. If it says "Off" — click **"Turn on"** and follow the steps (it will ask for your phone number)
6. Complete the setup

> **Note:** If 2-Step Verification is already ON, skip to 1.2

### 1.2 — Create an App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Sign in with **orders.thesixthritu@gmail.com**
3. You will see **"App passwords"** page
4. In the box that says "App name", type: **The Sixth Ritu Website**
5. Click **"Create"**
6. Google will show you a **16-character password** like: `abcd efgh ijkl mnop`
7. **COPY THIS PASSWORD** — write it down somewhere safe. You will need it in Step 2.
8. Click "Done"

> **Important:** This is NOT your Gmail password. This is a special app-only password. Don't share it with anyone.

---

## STEP 2: ADD SETTINGS IN VERCEL (5 minutes)

### 2.1 — Open Vercel Environment Variables

1. Go to: https://vercel.com
2. Sign in
3. Click on your project **"TSR"** (or "tsr-zsaf")
4. Click **"Settings"** tab at the top
5. Click **"Environment Variables"** in the left sidebar

### 2.2 — Add Email Settings

Add these one by one. For each one:
- Type the **Name** in the "Key" field
- Type the **Value** in the "Value" field  
- Make sure all three checkboxes are checked (Production, Preview, Development)
- Click **"Save"**

| # | Name (Key) | Value | What it does |
|---|-----------|-------|-------------|
| 1 | `SMTP_HOST` | `smtp.gmail.com` | Gmail's mail server |
| 2 | `SMTP_PORT` | `587` | Gmail's mail port |
| 3 | `SMTP_USER` | `orders.thesixthritu@gmail.com` | Your email address |
| 4 | `SMTP_PASS` | The 16-character App Password from Step 1.2 | The app password (NOT your Gmail password) |
| 5 | `BUSINESS_EMAIL` | `orders.thesixthritu@gmail.com` | Where YOU receive order notifications |

### 2.3 — Add Invoice Settings

| # | Name (Key) | Value | What it does |
|---|-----------|-------|-------------|
| 6 | `SELLER_NAME` | `The Sixth Ritu` | Business name on invoice (change if registered name is different) |
| 7 | `SELLER_ADDRESS` | Your full business address | Address shown on invoice |

### 2.4 — Redeploy

After adding ALL the above settings:

1. Go to the **"Deployments"** tab in your Vercel project
2. Find the latest deployment (top of the list)
3. Click the **three dots** (⋯) on the right side
4. Click **"Redeploy"**
5. Click **"Redeploy"** again to confirm
6. Wait 1-2 minutes for it to finish

**That's it! Emails will now work automatically.**

---

## STEP 3: GOOGLE SHEETS SETUP (10 minutes)

This step makes all orders automatically appear in a Google Sheet so you can track everything.

### 3.1 — Create a Google Sheet

1. Go to https://sheets.google.com
2. Click **"+ Blank"** to create a new spreadsheet
3. Name it: **The Sixth Ritu — Orders**
4. Look at the URL in your browser. It looks like:
   ```
   https://docs.google.com/spreadsheets/d/LONG_ID_HERE/edit
   ```
5. Copy that `LONG_ID_HERE` part — this is your **Sheet ID**

### 3.2 — Create a Google Cloud Service Account

1. Go to: https://console.cloud.google.com
2. Sign in with your Google account
3. If asked to create a project, create one named **"The Sixth Ritu"**
4. In the search bar at the top, type **"Google Sheets API"** and click on it
5. Click **"Enable"**
6. Now go to the search bar again, type **"Service accounts"** and click on **"IAM & Admin > Service Accounts"**
7. Click **"+ CREATE SERVICE ACCOUNT"**
8. Name: **tsr-orders**
9. Click **"CREATE AND CONTINUE"**
10. Skip the "Grant access" step — just click **"CONTINUE"**
11. Skip the "Grant users access" step — click **"DONE"**
12. You'll see your service account in the list. Click on its email (it looks like `tsr-orders@your-project.iam.gserviceaccount.com`)
13. Click the **"KEYS"** tab
14. Click **"ADD KEY"** → **"Create new key"**
15. Select **"JSON"** → Click **"CREATE"**
16. A file will download to your computer. **Don't lose this file!**

### 3.3 — Share the Sheet with the Service Account

1. Open the JSON file you just downloaded in Notepad
2. Find the line that says `"client_email"` — copy that email address
3. Go back to your Google Sheet (**The Sixth Ritu — Orders**)
4. Click **"Share"** button (top right)
5. Paste the service account email
6. Make sure it says **"Editor"**
7. Uncheck "Notify people"
8. Click **"Share"**

### 3.4 — Add Settings to Vercel

Go back to Vercel → Settings → Environment Variables and add:

| # | Name (Key) | Value |
|---|-----------|-------|
| 12 | `GOOGLE_SPREADSHEET_ID` | The Sheet ID from step 3.1 |
| 13 | `GOOGLE_SERVICE_ACCOUNT_KEY` | Open the downloaded JSON file in Notepad, select ALL the text (Ctrl+A), copy it (Ctrl+C), and paste it here |

### 3.5 — Redeploy Again

Same as Step 2.4 — go to Deployments, click ⋯ on the latest, click Redeploy.

---

## STEP 4: GOOGLE APPS SCRIPT (OPTIONAL — Extra backup for Sheets)

This is an OPTIONAL extra step. The Google Sheets integration from Step 3 is the primary method. This Apps Script is a backup method and also gives you a custom menu in the spreadsheet.

### 4.1 — Open Apps Script

1. Open your **"The Sixth Ritu — Orders"** Google Sheet
2. Click **Extensions** → **Apps Script**
3. Delete any code that's already there

### 4.2 — Paste the Code

1. Open the file `google-apps-script/Code.gs` from your project folder
2. Copy ALL the code
3. Paste it into the Apps Script editor
4. Click the save icon (or Ctrl+S)

### 4.3 — Set the Auth Token

1. In the Apps Script editor, click the ⚙️ gear icon on the left sidebar (**Project Settings**)
2. Scroll down to **"Script Properties"**
3. Click **"Add script property"**
4. Property name: `AUTH_TOKEN`
5. Value: Make up a long random string (at least 32 characters), like: `tsr2026ordersync_ABCDEFgh12345678`
6. Click **"Save script properties"**

### 4.4 — Initialize Sheets

1. Go back to the code editor (click the `<>` icon on the left)
2. In the function dropdown at the top, select **`initializeSheets`**
3. Click **"Run"** (the ▶ play button)
4. When asked for permissions, click **"Review permissions"** → Choose your account → Click **"Allow"**
5. Go back to your spreadsheet — you should now see 6 tabs: Orders, Customers, Payments, Invoices, Failed Automations, Settings

### 4.5 — Deploy as Web App (Optional)

1. Click **"Deploy"** → **"New deployment"**
2. Click the gear icon next to "Select type" → Choose **"Web app"**
3. Set: Execute as = **Me**, Who has access = **Anyone**
4. Click **"Deploy"**
5. Copy the Web app URL
6. Add to Vercel:
   - `GOOGLE_APPS_SCRIPT_URL` = the web app URL
   - `GOOGLE_APPS_SCRIPT_TOKEN` = the AUTH_TOKEN from step 4.3

---

## WHAT HAPPENS AFTER SETUP

### When a customer places a COD order:
1. Customer gets "Order Confirmed" email with items, total, address, "Payment will be collected at delivery"
2. You get "New Order" notification email with all details
3. Order is logged in Google Sheet

### When a customer pays online (Razorpay):
1. Customer gets "Order Confirmed" email with items, total, address, "Prepaid (Online)"
2. You get "New Order" notification email
3. A **GST Tax Invoice PDF** is generated automatically
4. Customer gets a second email with the invoice PDF attached
5. Order is logged in Google Sheet

### Invoice Details:
- Clean branded INVOICE header
- Items table with quantities, rates, amounts
- Subtotal, discount (if any), shipping, total
- "All prices are inclusive of applicable taxes" note
- Sequential invoice numbers: TSR/2627/0001, TSR/2627/0002, etc.
- Computer-generated, no signature required

---

## HOW TO TEST

After completing Step 2 (email setup) and redeploying:

1. Go to your website: https://thesixthritu.in
2. Add a perfume to cart
3. Place a test COD order with YOUR email address
4. Check your email — you should receive the order confirmation within 1 minute
5. Check orders.thesixthritu@gmail.com — you should see the owner notification

> **For invoice testing:** Place an online (Razorpay) test order. The invoice PDF will be emailed automatically after payment is verified. This requires a real or test Razorpay payment — ask before testing.

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| No emails received | Check Vercel env vars are correct. Check spam folder. Redeploy after adding vars. |
| "SMTP not configured" in Vercel logs | One of SMTP_HOST, SMTP_USER, or SMTP_PASS is missing |
| "Invalid login" error | App Password is wrong. Create a new one in Gmail. Make sure 2-Step Verification is ON. |
| "Less secure apps" error | You're using your Gmail password instead of the App Password. Use the 16-char App Password. |
| Invoice not generated | Check Vercel logs for errors. Make sure the invoice_counter table is initialized in the database. |
| Google Sheets not working | Check service account email has Editor access to the sheet. Check GOOGLE_SERVICE_ACCOUNT_KEY is the full JSON content. |

---

## ENVIRONMENT VARIABLES CHECKLIST

| Variable | Required For | Example Value |
|----------|-------------|---------------|
| `SMTP_HOST` | Email | `smtp.gmail.com` |
| `SMTP_PORT` | Email | `587` |
| `SMTP_USER` | Email | `orders.thesixthritu@gmail.com` |
| `SMTP_PASS` | Email | Your 16-char App Password |
| `BUSINESS_EMAIL` | Owner notifications | `orders.thesixthritu@gmail.com` |
| `SELLER_NAME` | Invoice | Your registered business name |
| `SELLER_ADDRESS` | Invoice | Your full business address |
| `GOOGLE_SPREADSHEET_ID` | Google Sheets | Sheet ID from URL |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Sheets | Full JSON content |

---

## SUMMARY

- **Email confirmation to customer** — READY, just add SMTP settings
- **Email notification to you** — READY, just add BUSINESS_EMAIL
- **GST Invoice PDF generation + email** — READY, just add GST settings
- **Google Sheets auto-sync** — READY, just add Google settings
- **Google Apps Script (Code.gs)** — ALREADY WRITTEN at `google-apps-script/Code.gs`

**Total time to set up: ~20 minutes**

No code changes needed. Everything is already built and tested.
