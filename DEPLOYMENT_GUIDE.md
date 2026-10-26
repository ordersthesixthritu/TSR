# Deployment Guide

## Prerequisites

- Node.js 18+ and npm
- A VPS or cloud server (e.g., DigitalOcean, AWS EC2, Hetzner)
- A registered domain with DNS configured
- SSL certificate (Let's Encrypt recommended)

## Project Structure

```
The Sixth Ritu/
  dist/           Frontend static files (HTML, CSS, JS, images)
  server/         Express.js backend (API, admin, payments)
  admin/          Admin panel SPA
  server/.env     Environment configuration (do not commit)
```

## Production Setup

### 1. Clone and Install

```bash
git clone <your-repo-url> /var/www/thesixthritu
cd /var/www/thesixthritu/server
npm install --production
```

### 2. Configure Environment

Copy the example and fill in production values:

```bash
cp .env.example .env
nano .env
```

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for all variables. At minimum, set:

- `JWT_SECRET` (generate with `openssl rand -hex 32`)
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (live keys)
- `RAZORPAY_WEBHOOK_SECRET`
- `FRONTEND_ORIGIN` (your production domain, e.g., `https://thesixthritu.com`)
- `NODE_ENV=production`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` (change the defaults immediately)

### 3. Run with PM2

Install PM2 globally and start the backend:

```bash
npm install -g pm2
pm2 start server/index.js --name tsr-backend
pm2 save
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status              # Check running processes
pm2 logs tsr-backend    # View logs
pm2 restart tsr-backend # Restart after updates
pm2 stop tsr-backend    # Stop the server
```

### 4. Nginx Reverse Proxy

Install Nginx and create a site configuration:

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/thesixthritu
```

Example configuration:

```nginx
server {
    listen 80;
    server_name thesixthritu.com www.thesixthritu.com;

    # Frontend static files
    root /var/www/thesixthritu/dist;
    index index.html;

    # API and admin proxy to Node.js backend
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }

    # SPA fallback: serve index.html for all frontend routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site and test:

```bash
sudo ln -s /etc/nginx/sites-available/thesixthritu /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d thesixthritu.com -d www.thesixthritu.com
```

Certbot automatically configures Nginx for HTTPS and sets up auto-renewal.

## Database

The backend uses sql.js (pure JavaScript SQLite). The database file is stored at `server/data/tsr.db` and is created automatically on first start.

Back up this file regularly. See [DATABASE_BACKUP_GUIDE.md](DATABASE_BACKUP_GUIDE.md).

## Updating the Site

```bash
cd /var/www/thesixthritu
git pull origin main
cd server && npm install --production
pm2 restart tsr-backend
```

If frontend files changed, clear browser caches by bumping the `?v=` parameter in the HTML files' script tags. All `dist/*/index.html` files reference `app.js?v=N` -- increment N after each deploy.

## Alternative: CDN for Frontend

Instead of serving `dist/` from Nginx, you can deploy the frontend to a CDN:

- **Cloudflare Pages:** Connect your repo, set build output to `dist/`
- **Netlify:** Drag and drop the `dist/` folder, or connect your repo

When using a CDN, configure the `_redirects` or equivalent to proxy `/api/*` requests to your backend server.

## Monitoring

- **PM2 logs:** `pm2 logs tsr-backend --lines 100`
- **Health check:** `curl https://yourdomain.com/api/health` should return `{"status":"ok"}`
- **Nginx logs:** `/var/log/nginx/access.log` and `/var/log/nginx/error.log`
