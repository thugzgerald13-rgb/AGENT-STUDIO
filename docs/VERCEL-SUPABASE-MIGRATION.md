# Deploy Agent Studio on Vercel + Supabase

Agent Studio is a full-stack Express app. To run it on Vercel (serverless) we
replace the JSON file storage with Supabase (Postgres) and wrap Express in a
Vercel catch-all function.

## 1. Supabase setup
1. Create a project at supabase.com → open **SQL Editor**
2. Paste and run `supabase/schema.sql`
3. Go to **Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret (NOT the anon key) → `SUPABASE_SERVICE_KEY`

## 2. GitHub + Vercel setup
1. Push this repo to GitHub
2. Vercel → New Project → import repo
3. **Settings:**
   - Framework Preset: *Other*
   - Build Command: `npm install`
   - Output Directory: `public`
   - Node version: 18+
4. **Environment Variables** (Vercel dashboard):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_DEFAULT_MODEL`
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (optional)
   - `SMTP_*`, `APP_URL`, `JWT_SECRET`
5. Deploy. API routes run via `api/[...all].js` (60s max duration for streaming).

## 3. Code change required (mechanical, one pass)
The JSON store (`lib/store.js`) is synchronous; the Supabase adapter
(`lib/supabaseStore.js`) is async. In `server.js`, swap the store import and add
`await` to every `stores.X.load()` / `stores.X.save()` call. Routes are already
async-capable (they use `async (req, res)` in most places). The adapter mirrors
the same `.load()` / `.cache` / `.save()` interface, so only the `await`
keyword needs adding.

Alternatively, preload all stores into memory at cold start (one async fetch)
and keep `.load()` synchronous — then only `.save()` needs `await`.

## 4. Notes / limits
- **Streaming:** Vercel functions max 60s (Hobby) / 300s (Pro). Long LLM
  streams may hit the cap — keep model timeouts low or use the Edge runtime.
- **Stripe webhooks:** point them at `https://your-domain.vercel.app/webhook/stripe`.
- **Static frontend:** served from `public/` via the rewrite in `vercel.json`.
- **Local dev:** still works with `npm start` (JSON storage) — Supabase only
  activates when `SUPABASE_URL` is set.
