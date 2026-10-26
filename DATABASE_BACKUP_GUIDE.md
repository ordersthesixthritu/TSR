# Database Backup Guide

## Overview

The Sixth Ritu uses **sql.js**, a pure JavaScript SQLite implementation. The entire database is a single file stored at:

```
server/data/tsr.db
```

This file contains all application data: products, orders, customers, leads, reviews, coupons, pages, popups, media records, and settings.

## Database Tables

| Table | Purpose |
|---|---|
| admins | Admin panel users (email, hashed password, role) |
| products | Product catalog (name, price, images, descriptions) |
| orders | Customer orders (Razorpay IDs, status, items, totals) |
| coupons | Discount codes (usage limits, expiry, minimum cart) |
| reviews | Product reviews (rating, text, approval status) |
| popups | Welcome/promotional popups (content, active status) |
| pages | CMS-managed pages (about, journal articles) |
| leads | Customer leads from popup form (name, phone, DOB) |
| media | Uploaded files metadata (filename, path, MIME type) |
| settings | Key-value store for site configuration |

## Backup Strategy

### Manual Backup

Stop the server or ensure no writes are in progress, then copy the database file:

```bash
cp server/data/tsr.db backups/tsr-$(date +%Y%m%d-%H%M%S).db
```

### Automated Daily Backup (cron)

Add a cron job to back up at 2:00 AM daily:

```bash
crontab -e
```

Add this line:

```
0 2 * * * cp /var/www/thesixthritu/server/data/tsr.db /var/www/thesixthritu/backups/tsr-$(date +\%Y\%m\%d).db
```

Create the backups directory:

```bash
mkdir -p /var/www/thesixthritu/backups
```

### Retention Policy

- Keep **7 daily** backups
- Keep **4 weekly** backups (e.g., every Sunday)
- Keep **3 monthly** backups

Cleanup script (add to cron, run daily after backup):

```bash
# Remove daily backups older than 7 days
find /var/www/thesixthritu/backups/ -name "tsr-*.db" -mtime +7 -delete
```

For weekly and monthly backups, copy to separate directories or use a naming convention.

### Off-site Backup

For critical data, sync backups to cloud storage:

```bash
# Example with rclone to Google Drive or S3
rclone copy /var/www/thesixthritu/backups/ remote:tsr-backups/
```

## Restoring from Backup

1. Stop the server:
   ```bash
   pm2 stop tsr-backend
   ```

2. Replace the database file:
   ```bash
   cp backups/tsr-YYYYMMDD.db server/data/tsr.db
   ```

3. Restart the server:
   ```bash
   pm2 start tsr-backend
   ```

4. Verify by checking the health endpoint and logging into the admin panel.

## Auto-initialization

The database schema is defined in `server/db/schema.js`. On first start:

- All 10 tables are created automatically (`CREATE TABLE IF NOT EXISTS`)
- Seed data is inserted only if tables are empty:
  - 1 admin user (from ADMIN_EMAIL/ADMIN_PASSWORD env vars or defaults)
  - 6 products (the signature collection)
  - 1 coupon (TSR200 -- 200 INR off, minimum cart 1499 INR)

If you delete `tsr.db` and restart the server, a fresh database is created with seed data. This means you do not need the backup to restore a working application -- only to restore customer data (orders, leads, reviews).

## Migrating to a Production Database

For higher traffic or concurrent access requirements, consider migrating from sql.js to:

- **PostgreSQL** -- recommended for production workloads
- **MySQL/MariaDB** -- widely supported alternative

The SQL queries in the codebase use standard SQLite syntax that translates well to both. Key changes needed:

1. Replace `sql.js` / `better-sqlite3` with a PostgreSQL or MySQL driver (e.g., `pg`, `mysql2`)
2. Update `datetime('now')` to `NOW()` or equivalent
3. Replace `INTEGER PRIMARY KEY AUTOINCREMENT` with `SERIAL` (PostgreSQL) or `AUTO_INCREMENT` (MySQL)
4. Update connection configuration to use host, port, database name, and credentials
5. Export existing data from SQLite and import into the new database
