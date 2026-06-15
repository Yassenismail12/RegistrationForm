# Backend (Cloudflare Worker)

This backend is implemented as a Cloudflare Worker API and supports form submissions to Firebase, plus Workers KV-based rate limiting and caching.

Install and run the Worker locally:

```bash
cd backend
npm install
npm run dev
```

API endpoints:

- `POST /api/register` — submit registration payload and save to Firestore.
- `GET /api/health` — health check endpoint.
- `GET /api/submission/:id` — fetch cached submission data.
- `GET /api/optimize-image?url=<https-url>` — proxy and cache remote images.

Required environment variables:

- `WORKER_ALLOWED_ORIGIN` — accepted frontend origin for CORS.
- `RATE_LIMIT_KV` - Cloudflare Workers KV binding used for rate limiting and caching.
- `FIREBASE_API_KEY` — Firebase API key.
- `FIREBASE_PROJECT_ID` — Firebase project ID.

Local development using `wrangler dev` will use these env vars from the Cloudflare dashboard or a local env file.
