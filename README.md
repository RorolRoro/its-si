# $SI — its-si.app

Parody memecoin site + live poll (Superior / Extreme / Supreme Intelligence).

## Files
- `index.html` — the site (static). All launch settings live in the `CONFIG` block at the top of the `<script>`.
- `logo.png` — transparent logo.
- `api/vote.js` — Vercel function backing the poll (Upstash Redis over REST).
- `page.html` — same site with the logo inlined, used for the claude.ai preview only. Not deployed.

## Launch checklist
1. Paste the contract address into `CONFIG.CONTRACT_ADDRESS` in `index.html`. Set `BUY_URL` to the Pons page of the coin (Dexscreener link derives from the CA; Buy falls back to it if `BUY_URL` is empty).
2. Optional: `TELEGRAM_URL`.
3. Push to `main` — Vercel redeploys.

## Poll storage (one-time)
Vercel project → Storage → add **Upstash for Redis** (free tier). It injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`). Redeploy once. Without it the API answers 503 and the page falls back to a browser-only poll.

Optional env: `SEED_VOTES="a,b,c"` to pre-seed counts (default 0,0,0); `VOTE_SALT` for the voter hash.
