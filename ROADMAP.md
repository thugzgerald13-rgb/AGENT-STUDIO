# Commercialization Roadmap

Ordered backlog for commercializing Agent Studio. The scheduled task picks the
next **unchecked** item, implements it in one ~20-minute focused chunk, checks
it off, and saves. Work is idempotent — if a firing is skipped (pro-tier budget
exhausted), the next firing resumes here with no lost progress.

- [x] **Chunk 1 — Subscription tiers + daily quotas.** Free/Pro/Enterprise tiers
      (`lib/tiers.js`), per-user daily request quota with automatic next-day
      reset (`lib/quota.js`), API-key user resolution (`lib/users.js`), enforced
      on chat, crew runs, and agent creation. `/api/me` and `/api/tiers`
      endpoints; quota badge in the UI header.
- [x] **Chunk 2 — User auth (signup/login).** Scrypt-hashed passwords (no extra
      deps), bearer session tokens (last 10 kept), `/api/auth/signup|login|logout`,
      login/signup overlay in the UI. Seeded local dev account `dev@local`/`dev1234`
      (Pro). `X-API-Key` still accepted for programmatic access.
- [x] **Chunk 3 — Per-user data scoping.** Agents, conversations, crew runs, and
      LLM config all carry `userId`; every endpoint filters by `req.user.id`.
      One-time migration assigns pre-auth orphan records to the first user. New
      users auto-seed the 3 starter agents. Cross-user direct-ID access 404s.
- [x] **Chunk 4 — Stripe billing integration.** `lib/billing.js` (lazy-loaded stripe
      SDK), `/api/billing/checkout` + `/api/billing/portal`, `/webhook/stripe` raw-body
      endpoint that sets `tier=pro` on `checkout.session.completed` / `invoice.paid` and
      downgrades on cancellation/failure. "Upgrade to Pro" button in header (Free tier
      only) redirects to Stripe Checkout. Runs without keys (503 + clear message),
      configured via `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`STRIPE_WEBHOOK_SECRET`.
- [x] **Chunk 5 — Public landing + pricing page.** Marketing hero, feature grid,
      pricing table pulled live from `/api/tiers`, FAQ, CTA. Served at `/`; app
      moved to `/app` (explicit route, no 301, `?signup=1` preserved).
- [x] **Chunk 6 — Rate limiting & abuse protection.** `express-rate-limit`:
      300 req/15min on `/api/`, stricter 20 req/15min on `/api/auth/` (brute-force
      protection), standard `RateLimit-*` headers returned.
- [x] **Chunk 7 — Usage metering & invoices.** `lib/usage.js` records per-request
      token estimates (chars/4) + cost (configurable `USAGE_COST_PER_1M`) keyed by
      user + calendar day on every chat and crew run. `GET /api/usage/summary`
      returns 30-day totals + daily history; rendered in Settings → Usage panel.
- [x] **Chunk 8 — Admin dashboard (API).** Admin = `ADMIN_EMAILS` env or first user.
      `GET /api/admin/users` lists all users with tier + 30-day usage; `PATCH
      /api/admin/users/:id/tier` changes tier (free/pro/enterprise).
- [x] **Chunk 9 — API keys & developer access.** Per-user revocable API keys
      (`sk_live_*`, stored SHA-256 hashed, shown once), `GET/POST/DELETE
      /api/user/api-keys`. Auth middleware accepts them as Bearer tokens.
      `/v1/agents` + `/v1/chat` JSON endpoints (quota + usage metered), plus a
      public `/docs` page. Smoke-tested create/list/revoke and /v1 auth.
- [x] **Chunk 10 — Email notifications.** `lib/mailer.js` (nodemailer, dev-mode
      console fallback when SMTP unset). Welcome email on signup, 80%-quota warning
      and quota-exhausted emails (at most once/day per user), receipt on payment.
      Config via `SMTP_*` + `APP_URL` env vars.
- [x] **Chunk 11 — Data export & GDPR deletion.** `GET /api/export` returns a
      full JSON dump (profile, agents, conversations, crew runs, API key metadata,
      usage — no passwords). `DELETE /api/user/account` purges all user records;
      login afterwards fails. Smoke-tested.
- [x] **Chunk 12 — Production hardening.** `Dockerfile` + `docker-compose.yml`
      (data volume, healthcheck), public `GET /healthz`, `.dockerignore`, README
      deploy section (Docker / PaaS / HTTPS / health check). Env vars documented
      in `.env.example`.
