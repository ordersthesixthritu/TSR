# Google Apps Script — Setup Guide

## Overview

This Google Apps Script manages order data for The Sixth Ritu in Google Sheets. It provides:
- A web endpoint the backend can POST orders to (fallback to direct Sheets API)
- Sheet initialization with headers, formatting, and conditional rules
- Order, customer, payment, and invoice tracking
- Manual dashboard and reconciliation from a custom menu
- Automatic "Last Updated" timestamps when you edit order/payment status

---

## Step-by-Step Setup

### 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Name it: **The Sixth Ritu — Orders**
3. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```
   Save this ID — the backend needs it as `GOOGLE_SHEET_ID`.

### 2. Open the Apps Script Editor

1. In the spreadsheet, go to **Extensions > Apps Script**.
2. Delete any existing code in `Code.gs`.
3. Paste the entire contents of `Code.gs` from this folder.
4. Click **Save** (Ctrl+S).

### 3. Set the Auth Token

1. In the Apps Script editor, go to **Project Settings** (gear icon on the left).
2. Scroll to **Script Properties** and click **Add script property**.
3. Add:
   - **Property:** `AUTH_TOKEN`
   - **Value:** Generate a random string (32+ characters). Example:
     ```
     openssl rand -hex 32
     ```
     or use any secure password generator.
4. Save this token — the backend needs it as `GOOGLE_APPS_SCRIPT_TOKEN`.

### 4. Initialize the Sheets

1. In the Apps Script editor, select `initializeSheets` from the function dropdown (top bar).
2. Click **Run**.
3. When prompted, **Review permissions** and authorize the script to access the spreadsheet.
4. After it runs, go back to the spreadsheet — you should see 6 tabs:
   - Orders
   - Customers
   - Payments
   - Invoices
   - Failed Automations
   - Settings

### 5. Deploy as Web App (for backend fallback endpoint)

1. In the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Configure:
   - **Description:** Order Sync v1
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Copy the **Web app URL** — the backend needs it as `GOOGLE_APPS_SCRIPT_URL`.
6. Click **Done**.

> **Security note:** The endpoint validates an auth token on every request.
> "Anyone" access means the URL is reachable, but only requests with the correct
> `AUTH_TOKEN` are processed. Without the token, requests are rejected.

### 6. Set Up the Reconciliation Trigger (Optional)

1. In the Apps Script editor, click the clock icon on the left (**Triggers**).
2. Click **+ Add Trigger**.
3. Configure:
   - **Function:** `reconcileOrders`
   - **Event source:** Time-driven
   - **Type:** Day timer
   - **Time of day:** 6am to 7am (or your preference)
4. Click **Save**.

This runs daily and logs any data discrepancies to the "Failed Automations" tab.

---

## Backend Configuration

Add these to the backend `.env` file:

```env
# Google Sheets (direct API — primary method)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"...","client_email":"...","...":"..."}
GOOGLE_SHEET_ID=your-sheet-id-from-step-1

# Google Apps Script (fallback method)
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
GOOGLE_APPS_SCRIPT_TOKEN=your-auth-token-from-step-3
```

### Service Account Setup (for direct Sheets API)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. Enable the **Google Sheets API**.
4. Go to **IAM & Admin > Service Accounts**.
5. Create a service account.
6. Create a JSON key for it and download it.
7. Copy the entire JSON content into `GOOGLE_SERVICE_ACCOUNT_KEY` (as a single line).
8. **Share the Google Sheet** with the service account's email (the `client_email` from the JSON), giving it **Editor** access.

---

## How It Works

### Data Flow

```
Customer places order
        ↓
Backend saves order in SQLite database (source of truth)
        ↓
Backend syncs to Google Sheets via Sheets API (primary)
        ↓
If Sheets API fails → backend POSTs to Apps Script URL (fallback)
        ↓
If both fail → logged in failed_jobs table, retried later
```

### Sheet Columns

**Orders:** Complete order record with customer, product, payment, and fulfillment data.

**Customers:** Aggregated customer data (auto-updated when orders arrive).

**Payments:** Payment-specific tracking — one row per order, updated when payment status changes.

**Invoices:** Invoice records with links to generated PDFs.

**Failed Automations:** Error log for debugging sync or delivery issues.

**Settings:** Non-sensitive business configuration. Do NOT put API keys or passwords here.

### Manual Operations

When the spreadsheet is open, a custom menu appears: **The Sixth Ritu**.

- **Initialize Sheets** — Re-run if a tab was accidentally deleted.
- **Run Reconciliation** — Check for data inconsistencies between Orders and Payments.
- **View Dashboard** — Quick summary of order counts and revenue.

### Editing Order Status

You can manually change the "Order Status" or "Payment Status" columns in the Orders tab. The "Last Updated" column updates automatically via the `onEdit` trigger.

> **Important:** Manual edits in the sheet do NOT trigger any backend action.
> The sheet is a read dashboard. To update order status for customers (triggering
> emails, status pages, etc.), use the admin panel or backend API.

---

## Updating the Script

When you update the Apps Script code:

1. Paste the new code in the editor.
2. Save.
3. Go to **Deploy > Manage deployments**.
4. Click the pencil icon on your deployment.
5. Change **Version** to "New version".
6. Click **Deploy**.

The web app URL stays the same.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Unauthorized" response | Check that AUTH_TOKEN in Script Properties matches the backend config |
| Sheets not created | Run `initializeSheets()` manually from the editor |
| Orders not appearing | Check the "Failed Automations" tab for errors |
| Permission denied | Re-authorize: Run any function, click "Review permissions" |
| Conditional formatting missing | Run `initializeSheets()` again — it reapplies formatting |
| Duplicate orders | The script checks Order ID before inserting — duplicates are skipped |
