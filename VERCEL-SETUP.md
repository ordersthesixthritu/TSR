# The Sixth Ritu — Vercel Deployment Guide

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Vercel Platform                            │
│                                             │
│  dist/          → Static files (frontend)   │
│  api/index.js   → Serverless function (API) │
│  vercel.json    → Routing, crons, headers   │
│                                             │
│  /api/*         → Serverless Express app    │
│  /*             → Static SPA (dist/)        │
└─────────────────────────────────────────────┘
```

- **Frontend**: Static files served from `dist/` (HTML, CSS, JS, images)
- **Backend**: Single serverless function (`api/index.js`) that imports the Express app from `server/app.js`
- **Email Queue**: Vercel Cron Job calls `/api/cron/process-emails` every 5 minutes
- **Database**: Currently sql.js (in-memory) — **must be migrated to Vercel Postgres or Turso before production**

---

## Step 1: Import Project in Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"**
3. Select the repository: `ordersthesixthritu/TSR`
4. Configure:
   - **Framework Preset**: `Other`
   - **Root Directory**: `.` (default)
   - **Build Command**: leave empty (no build step — dist/ is pre-built)
   - **Output Directory**: `dist`
   - **Install Command**: `cd server && npm install`

5. Click **Deploy** (it will fail without env vars — that's expected)

---

## Step 2: Configure Environment Variables

Go to **Project Settings → Environment Variables** and add each of these:

### Required for Payments (Razorpay)
| Variable | Value | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_XXXXX` | From Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | `XXXXX` | Same page — **never expose in frontend** |
| `RAZORPAY_WEBHOOK_SECRET` | `XXXXX` | Razorpay Dashboard → Webhooks → Secret |

### Required for Server
| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `FRONTEND_ORIGIN` | `https://thesixthritu.in,https://www.thesixthritu.in` | Comma-separated, your actual domain(s) |
| `ADMIN_JWT_SECRET` | (random 32+ char string) | Generate with: `openssl rand -base64 32` |
| `ADMIN_EMAIL` | your admin email | For admin panel login |
| `ADMIN_PASSWORD` | (strong password) | For admin panel login — will be bcrypt-hashed on first use |
| `CRON_SECRET` | (random 32+ char string) | Generate with: `openssl rand -base64 32` |

### Required for Email Notifications
| Variable | Value | Notes |
|---|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` | Your email provider's SMTP server |
| `SMTP_PORT` | `587` | Typically 587 (TLS) or 465 (SSL) |
| `SMTP_USER` | your email address | The "from" address |
| `SMTP_PASS` | app password | For Gmail: use an App Password, not your regular password |
| `BUSINESS_EMAIL` | your business email | Receives new-order notifications |

### Required for Google Sheets Sync
| Variable | Value | Notes |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | (entire JSON key, one line) | Service account JSON — paste as single line |
| `GOOGLE_SPREADSHEET_ID` | spreadsheet ID from URL | The long ID between `/d/` and `/edit` in your Google Sheet URL |

### GST / Invoice Configuration
| Variable | Value | Notes |
|---|---|---|
| `GSTIN` | `24AJWPG1884D1Z2` | Your registered GSTIN |
| `GST_RATE` | `28` | GST rate percentage |
| `HSN_CODE` | `3303` | HSN code for perfumery |
| `SELLER_NAME` | `The Sixth Ritu` | |
| `SELLER_ADDRESS` | your business address | Printed on invoices |
| `SELLER_STATE` | `Gujarat` | |

---

## Step 3: Configure Razorpay Webhook

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/) → **Webhooks**
2. Click **"+ Add New Webhook"**
3. Configure:
   - **Webhook URL**: `https://your-vercel-domain.vercel.app/api/payments/webhook`
   - **Secret**: (same value you set as `RAZORPAY_WEBHOOK_SECRET`)
   - **Active Events**: Select these events:
     - `payment.authorized`
     - `payment.captured`
     - `payment.failed`
     - `order.paid`
4. Click **Save**

**Important**: After connecting your custom domain, update the webhook URL to use your production domain.

---

## Step 4: Set Up Google Sheets

### Create a Google Cloud Service Account
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Sheets API**
4. Go to **Credentials → Create Credentials → Service Account**
5. Name it (e.g., `tsr-sheets-sync`)
6. Download the JSON key file

### Create the Orders Spreadsheet
1. Create a new Google Spreadsheet
2. Name it "TSR Orders" (or similar)
3. Share it with the service account email (from the JSON key, the `client_email` field) — give it **Editor** access
4. Copy the Spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### Add to Vercel
- `GOOGLE_SERVICE_ACCOUNT_KEY`: Open the downloaded JSON, copy its entire contents, paste as the env var value (single line)
- `GOOGLE_SPREADSHEET_ID`: The ID you copied above

The system will automatically create headers on the first order sync.

---

## Step 5: Configure Email (Gmail Example)

1. Go to [myaccount.google.com](https://myaccount.google.com/) → Security
2. Enable **2-Step Verification** (required for App Passwords)
3. Go to **App Passwords** → Generate one for "Mail"
4. Set in Vercel env vars:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = your Gmail address
   - `SMTP_PASS` = the 16-character App Password (no spaces)
   - `BUSINESS_EMAIL` = where you want order notifications sent

---

## Step 6: Connect Custom Domain

1. In Vercel Project → **Settings → Domains**
2. Add `thesixthritu.in` and `www.thesixthritu.in`
3. Vercel will show DNS records to add at your domain registrar
4. Update your domain's DNS:
   - Add a CNAME record pointing to `cname.vercel-dns.com`
   - Or if using apex domain: add an A record to Vercel's IP

**Do NOT change DNS until you're ready to go live. The current Hostinger site will go down when you switch DNS.**

---

## Step 7: Redeploy

After adding all environment variables:
1. Go to **Deployments** tab
2. Find the latest deployment
3. Click the **⋯** menu → **Redeploy**
4. The deployment should now succeed with all env vars configured

---

## Database Migration (CRITICAL — Before Production Orders)

The current backend uses **sql.js** (in-memory SQLite). This works for local development but **data will be lost on every serverless function cold start** on Vercel.

### Before accepting real customer orders, you MUST migrate to a persistent database.

**Recommended: Vercel Postgres (powered by Neon)**

1. In Vercel Dashboard → **Storage** → **Create Database** → **Postgres**
2. Connect it to your project (auto-adds env vars)
3. The migration from sql.js to Postgres requires:
   - Replace `server/db/index.js` with a Postgres adapter (using `@vercel/postgres` or `pg`)
   - Update SQL syntax from SQLite to PostgreSQL (minor differences)
   - Run schema creation on first deploy

**Alternative: Turso (SQLite-compatible, distributed)**

1. Sign up at [turso.tech](https://turso.tech)
2. Create a database
3. Replace the sql.js wrapper with `@libsql/client`
4. Minimal SQL changes needed (SQLite-compatible)

### Invoice Storage

Currently invoices are stored as local PDF files. On Vercel's serverless platform, local files are ephemeral.

**Options for production:**
- **Vercel Blob**: Store PDFs in Vercel's blob storage
- **Database BLOB**: Store small PDFs directly in the database
- **Cloud Storage**: AWS S3, Google Cloud Storage, etc.

---

## Cron Jobs

The `vercel.json` configures one cron job:

```json
{
  "path": "/api/cron/process-emails",
  "schedule": "*/5 * * * *"
}
```

This processes the email queue every 5 minutes. It's authenticated using the `CRON_SECRET` env var. Vercel automatically adds the `Authorization: Bearer <CRON_SECRET>` header to cron requests.

**Note**: Vercel Cron Jobs are available on the Pro plan ($20/month) and above. On the free Hobby plan, you get 1 cron job with a minimum interval of 1 day.

---

## Testing Checklist

After deployment, verify:

- [ ] Homepage loads at your Vercel URL
- [ ] Product pages load with images
- [ ] All 6 fragrances appear in the shop
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] `/api/public/products` returns all 6 products
- [ ] Cart and checkout UI work
- [ ] Razorpay payment popup opens (use test keys first!)
- [ ] Webhook receives and processes payments
- [ ] Order confirmation emails are sent
- [ ] Google Sheets sync works
- [ ] Admin panel accessible at `/admin`

---

## Security Reminders

- All secrets are in Vercel Environment Variables — never in code
- Razorpay Key Secret is server-side only — never exposed to frontend
- Webhook signature verification is active
- CORS restricts API access to configured origins
- Helmet security headers are applied
- Admin auth uses bcrypt + JWT
- Email content is HTML-escaped to prevent XSS
- Invoice generation uses server-verified amounts only

---

## Local Development

To run locally after cloning:

```bash
cd server
cp .env.example .env
# Edit .env with your local/test values
npm install
node index.js
```

The local server at `http://localhost:3001` serves both API and the admin panel.
For the frontend, serve the `dist/` directory on port 8765:

```bash
cd dist
npx serve -l 8765
```

The frontend will auto-detect localhost and use `http://localhost:3001/api`.
