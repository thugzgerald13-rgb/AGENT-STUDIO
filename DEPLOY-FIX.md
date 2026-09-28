# Fix: agent-studios.vercel.app returns 404 NOT_FOUND

## What was verified
The code in this repo is **correct**. It was booted in production mode
(`NODE_ENV=production`, loaded exactly as `api/[...all].js` loads it) and
served `GET /`, `/app`, and `/api/tiers` all with **HTTP 200**. Store writes
also succeed. So the 404 is **not a code crash** — it is a Vercel
deployment/routing problem.

Vercel's default "This page doesn't exist" 404 (with `VIEW DOCUMENTATION /
COPY DEBUG PROMPT` and a `sin1::...` request id) means **no route matched at
the edge** — i.e. the catch-all function `api/[...all].js` was not present in
the deployment that `agent-studios.vercel.app` points to.

## Step 1 — Check the deployment status (most likely fix)
1. Vercel dashboard → open the project that owns `agent-studios.vercel.app`.
2. **Deployments** tab: is the latest deployment **green (Ready)** or red
   (Error)? If red, open it and read the build log.
   - If the build never succeeded, that alone explains the 404 — fix the build
     error and redeploy.
3. Confirm the **Production** deployment is the latest commit (not an old one
   from before `vercel.json` / `api/[...all].js` existed). If not, push a new
   commit or hit **Redeploy**.

## Step 2 — Confirm project settings
- **Settings → General → Framework Preset:** `Other`
- **Root Directory:** `./` (the repo root, where `vercel.json` and `api/`
  live). If your code is in a subfolder, point Root Directory there.
- **Build Command:** leave empty (or `npm install` — it is a no-op for this
  app; there is no build step). Do **not** set an Output Directory unless you
  also have one in `vercel.json`; `public/` is auto-detected.
- **Node.js Version:** 24.x is fine (Vercel default since Jan 2026); 22.x also
  works.

## Step 3 — Verify the domain
- **Settings → Domains:** make sure `agent-studios.vercel.app` is listed and
  points at this project. A mismatched/empty project at that URL is the other
  common cause of this exact 404.

## Step 4 — Environment variables (required after the 404 is fixed)
Set in **Settings → Environment Variables**:
- `JWT_SECRET` — any long random string (session tokens).
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_DEFAULT_MODEL` — for the AI agents.
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — **must be the real Project URL
  from Supabase → Settings → API** (e.g. `https://abcdefgh.supabase.co`). A
  malformed/garbage URL will fail DNS. The service_role key — **not** the anon
  key. Then run `supabase/schema.sql` in the Supabase SQL editor.
- Optional: `STRIPE_*`, `SMTP_*`, `APP_URL`, `ADMIN_EMAILS`.

## Changes included in this fixed copy
1. **`vercel.json`** — removed the redundant `buildCommand`/`installCommand`
   (`npm install` twice); rewrites + 60s function timeout kept.
2. **`server.js`** — removed the duplicate `app.listen` block at the bottom
   (it shadowed `PORT` and could double-bind locally). The single
   `require.main === module` guard correctly prevents listening on Vercel.
3. **`lib/store.js`** — added a read-only-filesystem fallback to `/tmp`. On
   Vercel, `/var/task` is read-only; without this, the first login/chat would
   crash with `EROFS` (HTTP 500). **Warning:** `/tmp` is ephemeral — data is
   lost on cold start and not shared between instances. For real persistence
   you must complete the Supabase swap (see `docs/VERCEL-SUPABASE-MIGRATION.md`):
   replace `require('./lib/store')` in `server.js` with the Supabase adapter
   and add `await` to the ~60 `stores.*.load()/save()` calls.

## Quick smoke test after redeploy
```
curl -i https://agent-studios.vercel.app/            # expect 200, landing HTML
curl -i https://agent-studios.vercel.app/api/tiers   # expect 200 JSON
curl -i https://agent-studios.vercel.app/app         # expect 200
```
If `/` is 200 but `/api/*` 500s → the store is hitting the read-only FS or
Supabase env vars are missing — check the function logs in Vercel
(**Deployments → [latest] → Functions → Logs**).
