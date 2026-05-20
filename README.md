This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Marketplace Callback & Webhook Setup

This app exposes generic callback and webhook endpoints for Shopee and TikTok / Tokopedia Shop. The final URLs are computed at runtime from `APP_BASE_URL`, so the same code runs in dev, staging, and production without any hardcoded domain.

### Required env variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | What it does |
| --- | --- | --- |
| `APP_BASE_URL` | yes | Public URL where this app is reachable. No trailing slash. All marketplace URLs are derived from this. |
| `MARKETPLACE_TOKEN_ENCRYPTION_KEY` | yes (for token storage) | 32-byte key (hex or base64) used to encrypt access/refresh tokens at rest. |
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | only when wiring Shopee for real | Credentials from Shopee Open Platform. |
| `SHOPEE_CALLBACK_PATH`, `SHOPEE_WEBHOOK_PATH` | no (defaults provided) | Overrides if you want to host endpoints under different paths. |
| `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` | only when wiring TikTok for real | Credentials from TikTok Shop Partner Center. |
| `TIKTOK_CALLBACK_PATH`, `TIKTOK_WEBHOOK_PATH` | no (defaults provided) | Same as Shopee path overrides. |
| `DATABASE_URL` | recommended for prod | MySQL / MariaDB connection string (e.g. `mysql://user:pass@host:3306/db`). When unset, `lib/db.ts` uses a JSON-file dev store at `./data/marketplace.json`. |

Generate an encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### How to pick `APP_BASE_URL`

- **Local dev with a tunnel** (required for marketplace callbacks since localhost is not reachable from Shopee/TikTok): use the public HTTPS URL from a tunnel like ngrok, cloudflared, or tailscale funnel. Example: `APP_BASE_URL=https://your-tunnel.ngrok-free.app`.
- **Staging / preview deploys**: set to the deploy's public URL.
- **Production**: set to your custom domain (HTTPS).

### Final URLs

Once `APP_BASE_URL` is set, the marketplaces should be configured with:

| Marketplace | Type | URL |
| --- | --- | --- |
| Shopee | Callback | `${APP_BASE_URL}/api/shopee/callback` |
| Shopee | Webhook (Push URL) | `${APP_BASE_URL}/api/shopee/webhook` |
| TikTok / Tokopedia | Callback | `${APP_BASE_URL}/api/tiktok/callback` |
| TikTok / Tokopedia | Webhook | `${APP_BASE_URL}/api/tiktok/webhook` |

You can read the resolved URLs at any time:

```bash
curl ${APP_BASE_URL}/api/integrations/urls
```

Response:

```json
{
  "base_url": "https://your-domain.com",
  "shopee":  { "callback_url": "...", "webhook_url": "..." },
  "tiktok":  { "callback_url": "...", "webhook_url": "..." }
}
```

If `APP_BASE_URL` is missing the endpoint returns HTTP 500 with `{"error":"APP_BASE_URL is not configured"}`.

Or open `/marketplace/integrations` in the browser — it shows each URL with copy and test buttons.

### What to put into the partner centers

- **Shopee Open Platform** (https://open.shopee.com/):
  - *Authorization Callback URL*: `${APP_BASE_URL}/api/shopee/callback`
  - *Push URL* (for v2 push events): `${APP_BASE_URL}/api/shopee/webhook`
  - Must be **HTTPS** and publicly reachable. Localhost will be rejected.
- **TikTok Shop Partner Center** (https://partner.tiktokshop.com/):
  - *Redirect URL*: `${APP_BASE_URL}/api/tiktok/callback`
  - *Webhook URL*: `${APP_BASE_URL}/api/tiktok/webhook`
  - HTTPS + public, same constraint as Shopee.

### Manual testing

Local dev (or after deploy), with `APP_BASE_URL` set:

```bash
# 1. Confirm URL generator works
curl ${APP_BASE_URL}/api/integrations/urls

# 2. Hit Shopee callback with dummy params (will redirect to /marketplace/integrations)
curl -i "${APP_BASE_URL}/api/shopee/callback?code=test&shop_id=test"

# 3. Hit Shopee webhook with dummy payload (must return HTTP 200)
curl -i -X POST "${APP_BASE_URL}/api/shopee/webhook" \
  -H 'content-type: application/json' \
  -d '{"event":"test","shop_id":"test","message":"dummy shopee webhook"}'

# 4. TikTok callback
curl -i "${APP_BASE_URL}/api/tiktok/callback?code=test"

# 5. TikTok webhook
curl -i -X POST "${APP_BASE_URL}/api/tiktok/webhook" \
  -H 'content-type: application/json' \
  -d '{"event":"test","shop_id":"test","message":"dummy tiktok webhook"}'
```

The `/marketplace/integrations` page exposes Test callback / Test webhook buttons that perform the same calls from the browser.

### Architecture notes

- API routes are in `app/api/{shopee,tiktok}/{callback,webhook}/route.ts` and run on the Node.js runtime (they use `node:crypto`).
- Marketplace logic is in `lib/marketplace/{shopee,tiktok}.ts`. Token-exchange functions are skeletons with TODO blocks pointing to the relevant Shopee/TikTok docs — fill in once you have credentials.
- Tokens are encrypted via `lib/crypto.ts` (AES-256-GCM) using `MARKETPLACE_TOKEN_ENCRYPTION_KEY`. Plaintext tokens never touch logs or the DB.
- `lib/db.ts` selects its backend at module load: Postgres via `pg` when `DATABASE_URL` is set, otherwise a JSON-file dev store at `./data/marketplace.json`. The SQL migration at `db/migrations/001_marketplace_initial.sql` is the source of truth for the production schema.
- The webhook handlers return HTTP 200 immediately after persisting the raw payload; downstream processing should be done by a separate worker against `marketplace_webhook_events.processed = false`.
- Signature validation (`Authorization` for Shopee, `x-tts-signature` for TikTok) is left as a TODO inside each service.

## Local development with XAMPP MySQL

1. **Start XAMPP** and make sure the **MySQL** service is running (click *Start* next to MySQL in the XAMPP control panel).
2. **Create a database** for this app — easiest via phpMyAdmin:
   - Open http://localhost/phpmyadmin
   - Click *New* → name it `ai_marketing` → choose collation `utf8mb4_unicode_ci` → *Create*.
   - (CLI alternative: from `C:\xampp\mysql\bin`, run `mysql -u root -e "CREATE DATABASE ai_marketing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"`.)
3. **Set env**. Copy `.env.example` to `.env.local`, then fill in (XAMPP default is root with no password):
   ```env
   APP_BASE_URL=http://localhost:3000
   MARKETPLACE_TOKEN_ENCRYPTION_KEY=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   DATABASE_URL=mysql://root@127.0.0.1:3306/ai_marketing
   ```
4. **Run migrations** and start dev:
   ```bash
   npm install
   npm run db:migrate
   npm run dev
   ```
   Open http://localhost:3000/marketplace/integrations.

> Marketplace callbacks **cannot use `http://localhost`** — Shopee and TikTok need a public HTTPS URL. For end-to-end OAuth testing locally, expose the dev server with a tunnel (ngrok / cloudflared) and set `APP_BASE_URL` to the tunnel URL.

## Deploy to Hostinger Cloud Startup

Cloud Startup ships with both the "Aplikasi Node.js" feature and MySQL databases — everything we need.

### One-time setup

1. **Create the MySQL database.**
   - hPanel → *Databases* → *MySQL Databases* → *Create database*.
   - Note down: database name (e.g. `u123456_aimkt`), username, password, host (e.g. `mysql.your-domain.com` or `localhost`).
2. **Point your domain.** hPanel → *Domains* → DNS record (gratis-1-tahun domain that ships with Cloud Startup already points to your server).
3. **Generate the token encryption key** locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### Deploy steps

4. **Upload code.** Easiest via SSH (hPanel → *Advanced* → *SSH Access* → enable it first):
   ```bash
   ssh u123456@your-domain.com -p 65002
   cd ~
   git clone https://github.com/<USER>/<REPO>.git ai-marketing
   cd ai-marketing
   npm ci
   npm run build
   ```
   Or via File Manager: upload a zip (excluding `node_modules` and `.next`), extract, then run `npm ci && npm run build`.
5. **Create the Node.js app.** hPanel → *Advanced* → *Node.js* → *Create application*:
   - **Node.js version:** 22 (or 20 if 22 isn't offered).
   - **Application mode:** Production.
   - **Application root:** `domains/your-domain.com/ai-marketing` (the path you uploaded to).
   - **Application URL:** `your-domain.com` (or a subdomain).
   - **Application startup file:** `server.js`
   - **Environment variables:**
     ```env
     NODE_ENV=production
     APP_BASE_URL=https://your-domain.com
     MARKETPLACE_TOKEN_ENCRYPTION_KEY=<from step 3>
     DATABASE_URL=mysql://u123456_aimkt:<password>@<mysql-host>:3306/u123456_aimkt
     SHOPEE_PARTNER_ID=
     SHOPEE_PARTNER_KEY=
     TIKTOK_APP_KEY=
     TIKTOK_APP_SECRET=
     ```
   - Click **Create**. Hostinger boots the app via Passenger and attaches HTTPS automatically.
6. **Run the migration once** (over SSH):
   ```bash
   cd ~/domains/your-domain.com/ai-marketing
   npm run db:migrate
   ```
   Expected output: `> applying 001_marketplace_initial.sql` → `Applied 1 migration(s).`
7. **Verify.**
   ```bash
   curl https://your-domain.com/api/integrations/urls
   ```
   Then open `https://your-domain.com/marketplace/integrations` in a browser.

### Updating later

```bash
ssh u123456@your-domain.com -p 65002
cd ~/domains/your-domain.com/ai-marketing
git pull
npm run deploy          # = npm ci && npm run build && npm run db:migrate
```
Then in hPanel → *Node.js* → click **Restart** on the app.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
