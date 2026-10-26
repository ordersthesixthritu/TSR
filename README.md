# The Sixth Ritu

A luxury Indian perfume brand website featuring six signature Extrait de Parfum fragrances, with a full-stack CMS, admin panel, and Razorpay payment integration.

## Architecture

- **Frontend** — Static HTML/CSS/JS served from `dist/`. SPA routing handled by `app.js` (vanilla JavaScript, no framework). Each route has its own `dist/<route>/index.html` that loads the shared `app.js`.
- **Backend** — Express.js server on port 3001. Uses sql.js (pure JavaScript SQLite) for the database, with in-memory operation and file persistence.
- **Admin Panel** — JWT-authenticated single-page application at `/admin`. Manages products, orders, reviews, coupons, popups, pages, leads, and media.
- **CMS Sync** — On page load, the frontend fetches live data from the public API (`/api/public/*`). If the API is unavailable, it falls back to hardcoded product and content data embedded in `app.js`.

## Project Structure

```
dist/                — Static frontend
  app.js             — Main application (SPA router, rendering, CMS sync)
  v3-home.css        — Stylesheet
  products/          — Product images
  index.html         — Root HTML (each route has its own)
server/              — Express.js backend
  index.js           — Server entry point
  db/
    index.js         — Database connection (sql.js)
    schema.js        — Table definitions, seed data
  routes/
    admin.js         — Admin API (JWT-protected)
    public.js        — Public API (products, reviews, pages, popups, leads, coupons)
    payments.js      — Razorpay order creation, verification, webhooks
  middleware/
    auth.js          — JWT authentication middleware
  uploads/           — User-uploaded media files
admin/               — Admin panel SPA
  index.html         — Admin interface
```

## Setup

1. Install backend dependencies:
   ```
   cd server
   npm install
   ```

2. Create the environment file:
   ```
   cp .env.example .env
   ```
   Fill in the required variables. See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for details.

3. Start the backend server:
   ```
   npm start
   ```

4. Serve the frontend (in a separate terminal):
   ```
   cd dist
   python -m http.server 8765
   ```

5. Open the site at http://localhost:8765

## Key URLs (Development)

| URL | Purpose |
|-----|---------|
| http://localhost:8765 | Frontend |
| http://localhost:3001/api | Backend API |
| http://localhost:3001/admin | Admin panel |
| http://localhost:3001/api/health | Health check |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Cormorant Garamond + DM Sans (Google Fonts) |
| Backend | Express.js, sql.js (SQLite), Node.js |
| Auth | bcryptjs, jsonwebtoken (JWT) |
| Payments | Razorpay SDK |
| File Upload | multer |
| Security | helmet, cors |

## Database

10 tables: `admins`, `products`, `orders`, `coupons`, `reviews`, `popups`, `pages`, `leads`, `media`, `settings`.

All prices are stored in **paise** (Indian currency subunit). For example, 149900 paise = Rs 1,499. The frontend performs the conversion for display.

On first run, the database is seeded with:
- 1 admin account (configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars)
- 6 products at Rs 1,499 each
- 1 welcome coupon (TSR200 for Rs 200 off)

## Products

Six signature Extrait de Parfum 50ML fragrances, all priced at Rs 1,499:

| Fragrance | Character |
|-----------|-----------|
| Dark Monsoon | Deep, Earthy, Mysterious |
| Royal Zafran Rose | Rich, Floral, Opulent |
| Golden Ritual | Warm, Sensual, Enveloping |
| Golden Leaf | Bright, Fresh, Uplifting |
| Crystal Bloom | Clean, Luminous, Airy |
| Flora Silk | Soft, Floral, Graceful |

## Design Tokens

```css
--v3-ivory: #f7f4ed;
--v3-charcoal: #1a1815;
--v3-gold: #a27d4e;
--v3-serif: 'Cormorant Garamond', serif;
--v3-sans: 'DM Sans', sans-serif;
```

## API Overview

### Public (`/api/public`)
- `GET /products` — Active products
- `GET /reviews` — Approved reviews (optional `?product=slug` filter)
- `GET /pages` — Published pages
- `GET /pages/:slug` — Single published page
- `GET /popups/active` — Currently active popup
- `GET /coupons/validate?code=XXX` — Validate a coupon code
- `POST /leads` — Submit lead (requires consent)

### Payments (`/api/payments`)
- `POST /create-order` — Create Razorpay order (server-side price validation)
- `POST /verify` — Verify payment signature
- `POST /webhook` — Razorpay webhook receiver

### Admin (`/api/admin`)
- `POST /login` — Authenticate, returns JWT
- Full CRUD for products, orders, reviews, coupons, popups, pages, leads, media, settings

## Related Documentation

- [ADMIN_GUIDE.md](ADMIN_GUIDE.md) — Admin panel usage
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — Production deployment
- [RAZORPAY_SETUP.md](RAZORPAY_SETUP.md) — Payment gateway configuration
- [DATABASE_BACKUP_GUIDE.md](DATABASE_BACKUP_GUIDE.md) — Backup procedures
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) — Environment variable reference
- [TEST_REPORT.md](TEST_REPORT.md) — V5 integration test results
