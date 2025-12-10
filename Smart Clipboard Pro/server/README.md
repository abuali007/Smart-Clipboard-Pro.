# Smart Clipboard Pro — License Server

Minimal Express server that verifies Lemon Squeezy license keys. Keep the API key **only** here (never in the extension).

## Environment variables
- `LEMONSQUEEZY_API_KEY` (required)  
- `LEMONSQUEEZY_VARIANT_ID` (optional, default `1092455`)  
- `ALLOWED_ORIGINS` (comma-separated; include your extension origin and any web origins)  
- `PORT` (default `3000`)  
- `OFFLINE_LICENSE_SECRET` (optional; only if you want offline codes)  

## Run locally
```bash
cd server
npm install
npm start
# health check
curl http://localhost:3000/health
```

## Deploy quickly
Use any free/cheap host (Render, Railway, Vercel function, Fly, etc.):
1) Upload this `server/` folder.  
2) Set env vars above in the host dashboard.  
3) Deploy; note the public URL (e.g., `https://your-app.onrender.com`).  
4) In the extension, set `LICENSE_API_BASE_URL` in `background.js` to that URL.  

## API
- `GET /`  
  - Returns basic status and available endpoints (handy for hosts that expect a landing page).
- `POST /api/verify-license`  
  - Body: `{ "licenseKey": "XXXX-XXXX-XXXX-XXXX", "deviceId": "optional-device-id" }`  
  - Returns: `{ valid: boolean, licenseInfo?: {...}, error?: string }`
- `GET /health`
