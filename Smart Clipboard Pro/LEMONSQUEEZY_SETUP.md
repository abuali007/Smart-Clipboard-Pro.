# Lemon Squeezy Integration Setup Guide

Use this guide to replace Gumroad with Lemon Squeezy for licensing and checkout.

## Prerequisites
- A Lemon Squeezy store with a product/variant configured for Smart Clipboard Pro.
- A **Lemon Squeezy API key** (keep it secret; do not commit it).
- Deployment target for the verification server in `server/index.js`.

## 1) Configure environment variables
Create a `.env` (or host-level variables) for the server:

```
LEMONSQUEEZY_API_KEY=your_api_key_here
LEMONSQUEEZY_VARIANT_ID=1092455           # variant ID for Smart Clipboard Pro
ALLOWED_ORIGINS=chrome-extension://<extension-id>,http://localhost:3000
PORT=3000
OFFLINE_LICENSE_SECRET=your_offline_secret   # optional, only if you want offline codes
```

- Never hardcode the API key in the extension. Keep it on the server.
- `ALLOWED_ORIGINS` should include your production site if you host a web dashboard.

## 2) Run the license server (development)
```
cd server
npm install
node index.js
```
- The server listens on `http://localhost:3000` by default.
- Health check: `http://localhost:3000/health`

## 3) Deploy the license server
- Deploy to your preferred host (Render, Railway, Fly, Vercel functions, etc.).
- Set the same environment variables on the host.
- Update `LICENSE_API_BASE_URL` in `background.js` to the deployed HTTPS URL (keep `http://localhost:3000` for local testing).

## 4) Wire the checkout link
- Checkout link (live): `https://litextools.lemonsqueezy.com/buy/6455567f-8d64-461c-866c-c7661e0aba0e`
- Share link (dashboard reference): `https://app.lemonsqueezy.com/share/694269`
- Update `LEMON_SQUEEZY_CHECKOUT_URL` in `settings/settings.js` and `popup/main.js` if the link changes or you add embed parameters (e.g., `?embed=1`).

## 5) Test license verification
- Start the server locally.
- In the extension, activate with a valid license key (format: `XXXX-XXXX-XXXX-XXXX`).
- Server endpoint (manual test):
```
curl -X POST http://localhost:3000/api/verify-license \
  -H "Content-Type: application/json" \
  -d "{\"licenseKey\":\"YOUR-TEST-KEY\",\"deviceId\":\"dev-device-1\"}"
```
- Expect `{ valid: true, licenseInfo: { ... } }` for valid keys.

## 6) Notes
- Activation count and subscription status are read from Lemon Squeezy’s licensing endpoints.
- If you need custom rules (grace periods, feature flags), extend `mapLemonSqueezyResponseToLicense` in `server/index.js`.
- Keep API keys out of version control; use environment variables only.
