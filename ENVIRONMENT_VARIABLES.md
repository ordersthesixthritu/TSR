# Environment Variables

All environment variables are defined in `server/.env`. This file is loaded automatically via the `dotenv` package.

## Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Port the Express server listens on |
| `FRONTEND_ORIGIN` | No | `http://localhost:8765` | Allowed CORS origin for frontend requests |
| `JWT_SECRET` | Yes | -- | Secret key for signing admin JWT tokens (min 32 characters) |
| `ADMIN_EMAIL` | No | `admin@thesixthritu.com` | Default admin account email (used on first database seed only) |
| `ADMIN_PASSWORD` | No | `changeme123` | Default admin account password (used on first database seed only) |
| `RAZORPAY_KEY_ID` | Yes | -- | Razorpay API Key ID (`rzp_test_*` or `rzp_live_*`) |
| `RAZORPAY_KEY_SECRET` | Yes | -- | Razorpay API Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | -- | Secret for verifying Razorpay webhook signatures |
| `NODE_ENV` | No | `development` | Set to `production` in production environments |

## Example .env File

Copy this template to `server/.env` and fill in your values:

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:8765

# Authentication
JWT_SECRET=generate-a-random-string-at-least-32-characters-long

# Admin seed (only used on first database creation)
ADMIN_EMAIL=admin@thesixthritu.com
ADMIN_PASSWORD=change-this-to-a-strong-password

# Razorpay (use test keys for development, live keys for production)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

## Generating a JWT Secret

Use one of these commands to generate a secure random string:

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Security Notes

- **Never commit `.env` to version control.** Add it to `.gitignore`.
- **`RAZORPAY_KEY_SECRET`** must never appear in frontend JavaScript. Only `RAZORPAY_KEY_ID` is sent to the browser.
- **`ADMIN_PASSWORD`** is only used to seed the first admin account. Change it in the admin panel after first login. The seed function hashes the password with bcrypt (12 rounds) before storing.
- **`JWT_SECRET`** should be unique per environment. Changing it invalidates all existing admin sessions.
- In production, set `FRONTEND_ORIGIN` to your actual domain (e.g., `https://thesixthritu.com`). This controls the CORS policy -- requests from other origins are rejected.

## Production Checklist

- [ ] `NODE_ENV` set to `production`
- [ ] `JWT_SECRET` is a unique random string (not the development value)
- [ ] `ADMIN_PASSWORD` changed from the default
- [ ] `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are live keys (not test keys)
- [ ] `RAZORPAY_WEBHOOK_SECRET` matches the secret configured in the Razorpay Dashboard
- [ ] `FRONTEND_ORIGIN` set to the production domain with HTTPS
- [ ] `.env` file is not tracked in git
