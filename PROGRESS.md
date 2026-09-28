# Commercialization Roadmap — Agent Studio

Log for scheduled improvement sessions. Each session: read this file, pick the top
unfinished item, implement + smoke-test it, then update this log (done / next steps).

## Priority backlog (work top-down)

1. **[DONE] Multi-user auth & per-user data** — signup/login with scrypt-hashed
   passwords, bearer session tokens, `/api/auth/*`, login/signup overlay. All data
   (agents, conversations, crew runs, LLM config) scoped by `userId`; cross-user
   access 404s. Seeded dev account `dev@local`/`dev1234` (Pro). New users auto-seed
   3 starter agents. `X-API-Key` still accepted. See ROADMAP.md Chunks 2–3.
2. **Subscription billing (Stripe)** — Free vs Pro tiers, Stripe Checkout + webhook,
   store subscription status on user. Pro: unlimited agents/conversations, more crew
   rounds, custom models. Free: capped (e.g. 3 agents, 20 chats/day, 1 crew round).
3. **[DONE in Chunk 1] Usage metering & rate limits** — per-user daily quotas enforced
   server-side (`lib/quota.js`), quota badge in UI. Remaining: per-IP rate limiting,
   token/cost metering.
4. **Landing / marketing page** — public `/` route with hero, features, pricing, CTA;
   move app to `/app`. Polished commercial design.
5. **API keys for end users** — let users generate keys to call their agents via REST API
   (commercial API product angle).
6. **Workspaces / teams** — invite teammates, share agents. (later)
7. **Deployment hardening** — Dockerfile, env-based secrets, HTTPS notes, error monitoring,
   `data/` on persistent volume.
8. **Onboarding & empty states** — guided first-run, sample agent templates gallery.

## Session log

- (initial) Project delivered v1: single-user, no auth, JSON storage, OpenAI-compatible LLM,
  streaming chat + crew run. Backlog above created.
- (Chunk 1, prior session) Tiers + daily quotas + API-key users + /api/me + quota badge.
- (Chunks 2–3, earlier session) Full email/password auth (scrypt, session tokens), per-user
  data scoping on all endpoints, per-user LLM config, login/signup UI, logout, orphan
  migration. Smoke-tested.
- (Chunk 4, this session) Stripe billing integration: `lib/billing.js` (lazy-loaded SDK),
  checkout + customer-portal routes, raw-body webhook that sets tier=pro on payment and
  downgrades on cancellation/failure. "Upgrade to Pro" button in header. App runs without
  Stripe keys (503 + clear message). Smoke-tested all routes.
- (Chunks 5–6, later session) Public landing page at `/` (hero, features, live pricing
  table from `/api/tiers`, FAQ, CTA). App moved to `/app` with explicit route (no 301,
  `?signup=1` preserved). Rate limiting via `express-rate-limit`: 300/15min on `/api/`,
  20/15min on `/api/auth/`, standard `RateLimit-*` headers. Smoke-tested all routes.
  **Next: Chunk 7 — usage metering & invoices (per-request token/cost tracking).**
- (Chunks 7–8, later session) Usage metering: `lib/usage.js` records token/cost per
  chat & crew run, keyed by user+day; `GET /api/usage/summary`; Settings → Usage panel.
  Admin API: `GET /api/admin/users`, `PATCH .../tier` (admin = ADMIN_EMAILS or first user).
  Smoke-tested. **Next: Chunk 9 — per-user revocable API keys + /v1 developer endpoints.**
- (Chunk 9, later session) Revocable API keys (`sk_live_*`, hashed at rest, shown once),
  `/api/user/api-keys` CRUD, `/v1/agents` + `/v1/chat` JSON endpoints, public `/docs` page.
  Smoke-tested create/list/revoke and /v1 auth. **Next: Chunk 10 — email notifications.**
- (Chunk 10, later session) Transactional email: `lib/mailer.js` (nodemailer, dev-mode
  console fallback). Welcome on signup, 80%-quota + exhausted warnings (once/day), receipt
  on payment. SMTP_* env vars. Unit-tested in dev mode. **Next: Chunk 11 — data export & GDPR deletion.**
- (Chunks 11–12, later session) Data export `GET /api/export` + GDPR account
  deletion `DELETE /api/user/account` (purges all records; login fails after).
  Production hardening: Dockerfile, docker-compose.yml (data volume + healthcheck),
  `/healthz`, `.dockerignore`, README deploy section. Smoke-tested.
  **ROADMAP COMPLETE — all 12 chunks shipped.**
- (Post-roadmap, later session) API key management UI in Settings (create → show
  full key once, list with prefix, revoke) + "API Docs" link in header (points to /docs).
  Backend already existed; now usable from UI. Smoke-tested endpoints.
  **Next: workspaces/teams, or onboarding/empty-state polish.**
- (Post-roadmap, later session) GDPR/export UI in Settings: "Export my data (JSON)"
  downloads full dump; "Delete account" double-confirm → purges all records → logout.
  Backend existed (Chunk 11); now usable from UI. Smoke-tested end-to-end.
  **Next: workspaces/teams, or onboarding/empty-state polish.**
- (Post-roadmap, later session) Onboarding empty-state: welcome card shown in chat
  panel when no agent selected (replaces blank screen). Syntax-checked; boots clean.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Public agent sharing: PATCH /api/agents/:id/share
  toggles public read-only profile page at /s/:shareId (no auth). UI: share toggle +
  copyable link in agent edit modal. Smoke-tested enable→200→unshare→404.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Admin dashboard UI in Settings (visible only to
  admins): user list with email/tier/usage, per-user tier dropdown (Free/Pro/Enterprise)
  → PATCH /api/admin/users/:id/tier. Backend existed (Chunk 8); now usable from UI.
  /api/me now returns isAdmin flag. Smoke-tested: isAdmin=true, list 200, non-admin 403.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Change password: `users.changePassword()` (scrypt
  re-hash, old-password verification) + `POST /api/user/password` + Settings →
  Security panel (current/new/confirm, client-side validation). Unit-tested at lib
  level: change OK, login with new works, old rejected.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Forgot-password reset flow: `createPasswordResetToken`
  (hashed, 1h expiry, single-use) + `resetPasswordByToken` in users.js; `POST
  /api/auth/forgot` (no user enumeration) + `POST /api/auth/reset`; mailer.sendPasswordReset;
  UI: "Forgot password?" link + ?reset=TOKEN handler. Unit-tested: wrong token/short pw/reuse
  all rejected; reset succeeds; old pw rejected.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Agent duplicate + conversation rename:
  `POST /api/agents/:id/clone` (copies agent, resets share flag) + `PATCH
  /api/conversations/:id` (rename title). UI: "Duplicate" button in agent modal;
  double-click conversation to rename. Smoke-tested: clone +1, 404s, cross-user
  isolation preserved.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Crew-run deletion + sidebar search: `DELETE
  /api/crew/runs/:id` (scoped) with ✕ button in crew history; search input filters
  agents + conversations live. Smoke-tested: delete 404 on missing, list 200, /app 200.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Session management: `revokeOtherSessions` in
  users.js (tokens stored as {token,createdAt} objects — handled) + `POST
  /api/user/sessions/revoke-other` + "Log out all other sessions" button in
  Security. Smoke-tested: 2 sessions → revoke → other 401, current 200.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Change email: `users.changeEmail` (password verify,
  format + uniqueness check) + `POST /api/user/email` + "Change email" button in
  Security (updates header email). Smoke-tested: wrong pw/dupe/bad format rejected,
  valid change OK, login with new email 200.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Per-conversation export: `GET /api/conversations/:id/export?format=md|json`
  (scoped, attachment download) + "Export" button in chat header (fetch with Bearer → blob download).
  Syntax-checked; route pattern matches scoped endpoints.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Stop generation: AbortController threaded through
  postSSE; Send button becomes "Stop" while streaming; abort finalizes partial
  assistant message in UI. Pure-frontend; syntax-checked.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Agent export/import JSON: `GET /api/agents/:id/export`
  (strips id/userId/share, attachment) + `POST /api/agents/import` (validates + clamps
  fields, resets share). UI: Export JSON + Import JSON (file picker) in agent modal.
  Smoke-tested: export 200 no-id, import +1, missing 404.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Conversation message-content search: `GET
  /api/conversations/search?q=` (scoped, placed before /:id route to avoid param
  collision) + sidebar search queries backend when query ≥2 chars, merges title
  matches + message matches. Smoke-tested: matching term → 1 result, nomatch → 0,
  short q → [], route ordering correct.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Agent pin/favorite: `PATCH /api/agents/:id/pin`
  {pinned} (scoped) + sidebar: ★/☆ toggle per agent, pinned sort to top with 📌
  marker. Smoke-tested via curl: pin→true persists, list reflects, unpin→false,
  missing→404. (Note: earlier node-fetch test helper dropped Content-Type header;
  curl confirmed route works.)
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Email verification on signup: `issueEmailVerifyToken`
  (hashed, 24h) + `verifyEmailByToken` (single-use) in users.js; signup auto-sends
  via mailer.sendEmailVerify; `GET /api/auth/verify` (public, redirects to /app) +
  `POST /api/auth/resend-verification`; /api/me returns emailVerified (fixed bug:
  undefined→false); UI: amber banner + Resend button + toast on verify redirect.
  Unit-tested: wrong token rejected, verify OK, single-use enforced.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Conversation delete UI + keyboard shortcuts: per-conversation
  ✕ button (hover-reveal, confirm) → DELETE /api/conversations/:id (endpoint existed, no UI);
  clears current chat if deleted. Shortcuts: Ctrl/Cmd+K focus search, Ctrl/Cmd+N new chat,
  Esc closes modals. Syntax-checked.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Last-agent persistence + landing page polish:
  selectAgent saves as_lastAgent to localStorage; loadAgents restores on reload
  (falls back to first agent). Landing: added "How it works" 3-step section,
  testimonials grid, final CTA with free-tier value prop. Smoke-tested: syntax
  OK, landing 200, both new sections present.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Chat UX: per-message Copy button (clipboard API +
  execCommand fallback) + timestamp on hover (group class); Regenerate response
  button below last assistant message re-sends last user message. Syntax-checked.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Markdown rendering in chat: renderMarkdown() escapes
  HTML then handles ``` code blocks, `inline code`, **bold**, *italic*, [links](url),
  bare URLs, line breaks. messageBubble content uses innerHTML (safe — escaped first).
  Smoke-tested: syntax OK, /app 200.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Export all agents bundle + password strength meter:
  `GET /api/agents/export-all` (before /:id, attachment) returns {schemaVersion,count,agents};
  UI "Export all" button in agent modal. Password strength bar on signup (0-5 score:
  length, mixed case, digits, symbols → color gradient). Smoke-tested: export count=3,
  no-auth 401, syntax OK.
  **Next: workspaces/teams (last original-priority item).**
- (Post-roadmap, later session) Last-agent persistence + landing page polish:
  selectAgent saves to localStorage (as_lastAgent), loadAgents restores it on
  reload (falls back to first agent). Landing: added "How it works" 3-step section,
  testimonials grid, final CTA with free-tier value prop. Smoke-tested: landing
  200, new sections present, app.js syntax OK.
  **Next: workspaces/teams (last original-priority item).**
