# The Sixth Ritu — Admin Guide

## Accessing the Admin Panel

- **Local:** http://localhost:3001/admin
- **Production:** https://yourdomain.com/admin

**Default credentials:**
- Email: `admin@thesixthritu.com`
- Password: `changeme123`

**CHANGE THE DEFAULT PASSWORD IMMEDIATELY after first login.**

Authentication uses JWT tokens stored in `sessionStorage`. Tokens expire after the session ends. Three roles exist: `super_admin`, `admin`, and `editor`.

---

## Admin Sections

### 1. Dashboard

Overview of recent orders, lead count, and revenue summary.

### 2. Products

Manage the six signature fragrances.

| Field | Description |
|-------|-------------|
| `name` | Product display name (e.g., "Dark Monsoon") |
| `slug` | URL identifier (e.g., "dark-monsoon") — must be unique |
| `subtitle` | Tagline shown below the name |
| `character` | Scent character description (e.g., "Deep - Earthy - Mysterious") |
| `notes` | Fragrance notes summary (e.g., "Rain - Earth - Oud") |
| `description` | Full product description paragraph |
| `price` | Price **in paise** (149900 = Rs. 1,499) |
| `image` | Image path (e.g., `/products/dark Monsoon.png`) |
| `mood` | Mood category for filtering |
| `active` | 1 = visible on frontend, 0 = hidden |
| `sort_order` | Display order (lower numbers appear first) |

Product changes sync to the frontend on the next page load.

### 3. Orders

View and manage customer orders.

**Statuses:** `pending` > `paid` > `shipped` > `delivered` | `cancelled` | `refunded`

- Order numbers follow the format `TSR-XXXXX`
- Orders are created when a Razorpay payment is initiated
- Status updates to `paid` after successful payment verification
- Shipping and delivery status must be updated manually

### 4. Reviews

Manage product reviews.

| Field | Description |
|-------|-------------|
| `product_slug` | Which product the review belongs to |
| `customer_name` | Reviewer's display name |
| `rating` | 1 to 5 stars |
| `text` | Review body text |
| `verified_purchase` | Whether the reviewer has a confirmed purchase |
| `approved` | **Only approved reviews appear on the frontend** |

### 5. Coupons

Create and manage discount codes.

| Field | Description |
|-------|-------------|
| `code` | Coupon code (stored uppercase, e.g., "TSR200") |
| `discount_amount` | Discount **in paise** (20000 = Rs. 200) |
| `min_cart` | Minimum cart value in paise to apply |
| `max_uses` | Maximum redemptions (0 = unlimited) |
| `current_uses` | Auto-incremented on each successful payment |
| `active` | 1 = usable, 0 = disabled |
| `expires_at` | Optional expiry date |

**Default coupon:** TSR200 — Rs. 200 off, minimum cart Rs. 1,499.

### 6. Popups

Configure the welcome popup shown to new visitors.

The popup content is stored as a JSON object with these fields:

| Field | Description |
|-------|-------------|
| `title` | Popup heading (supports `<br/>` for line breaks) |
| `subtitle` | Description text below the heading |
| `kicker` | Small text above the title (e.g., "EXCLUSIVE WELCOME GIFT") |
| `couponCode` | Coupon code to display (e.g., "TSR200") |
| `discount` | Discount description text (e.g., "Rs. 200 off your first order") |

Only **one popup can be active** at a time. Deactivate the current popup before activating a new one.

### 7. Pages

CMS-managed content pages.

- **Slug `about`** — Controls the About/Our Story page content. Fields in the content JSON: `heroTitle`, `heroIntro`, `identityHeading`, `identityText`, `identityImage`.
- **Pages with `content.type = "journal"`** — Appear as articles in the Journal section. The slug becomes the URL path (e.g., slug `the-science-of-scent` maps to `/journal/the-science-of-scent`).
- Set `published = 1` for the page to appear on the frontend.
- When a journal page is published, the server auto-creates the corresponding HTML route file.

### 8. Leads

View leads captured through the welcome popup.

| Field | Description |
|-------|-------------|
| `name` | Visitor's name |
| `phone` | 10-digit mobile number (duplicates are prevented) |
| `dob` | Date of birth (optional) |
| `source` | Where the lead was captured (default: "popup") |

Leads require explicit consent from the visitor before submission.

### 9. Media

Upload and manage images.

- Files are stored in `server/uploads/`
- After uploading, use the file's URL path in product image fields or page content
- Supported formats: JPEG, PNG, WebP

### 10. Settings

Key-value configuration store for site-wide settings. Values are stored as JSON.

---

## How CMS Sync Works

1. The frontend calls `syncFromCMS()` on every page load
2. It fetches from these public API endpoints:
   - `GET /api/public/products` — All active products
   - `GET /api/public/reviews` — Approved reviews
   - `GET /api/public/pages` — All published pages
   - `GET /api/public/popups/active` — Current active popup
3. If the API is unreachable, the frontend falls back to hardcoded data in `app.js`
4. Changes made in the admin panel reflect on the frontend on the **next page load** (typically within seconds)

---

## Important Notes

- **HTTPS required:** Never expose the admin panel on a public network without HTTPS
- **Change default password:** Update the admin password immediately after deployment
- **Prices in paise:** All monetary values are stored in paise. Multiply rupees by 100 (Rs. 1,499 = 149900 paise)
- **Image workflow:** Upload images via the Media section first, then reference the URL path in product or page fields
- **Backup:** The database is a single SQLite file (`server/db/tsr.db`). Back it up regularly
- **Role access:** Only `super_admin` can create other admin accounts
