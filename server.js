const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { stores, id } = require('./lib/store');
const { runAgentStream } = require('./lib/agent');
const { runCrew } = require('./lib/crew');
const { TIERS, publicTiers } = require('./lib/tiers');
const { checkQuota, consumeQuota } = require('./lib/quota');
const users = require('./lib/users');
const billing = require('./lib/billing');
const usage = require('./lib/usage');
const mailer = require('./lib/mailer');

// Send quota warning/exhausted emails at most once per day per user.
function notifyQuota(user, remaining, limit, exhausted) {
  const today = new Date().toISOString().slice(0, 10);
  if (exhausted) {
    if (user.quotaNotified === today) return;
    user.quotaNotified = today; stores.users.save();
    mailer.sendQuotaExhausted(user).catch(() => {});
  } else if (remaining <= Math.ceil(limit * 0.2)) {
    if (user.quotaWarned === today) return;
    user.quotaWarned = today; stores.users.save();
    mailer.sendQuotaWarning(user, remaining, limit).catch(() => {});
  }
}

const app = express();
// Stripe webhook needs the raw body — must be registered before express.json.
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
// Rate limiting — auth endpoints stricter (brute-force protection).
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — try again in 15 minutes.' } }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
// Public marketing site at `/`, the authenticated app at `/app`.
// Serve /app directly (no 301) so ?signup=1 query params survive.
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public/app/index.html')));
app.use('/app', express.static(path.join(__dirname, 'public/app')));
app.use('/', express.static(path.join(__dirname, 'public/landing')));

const PORT = process.env.PORT || 3000;
users.seedDefaultUser();

// ---------- helpers ----------
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  return (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

const DEFAULT_AGENT_TEMPLATES = [
  { name: 'Researcher', description: 'Digs up facts and lists sources', temperature: 0.3, systemPrompt: 'You are a meticulous research analyst. For every question, provide a concise factual summary, key data points, and note any uncertainty. Prefer structured bullet points.' },
  { name: 'Writer', description: 'Turns notes into polished prose', temperature: 0.8, systemPrompt: 'You are a professional writer. Rewrite given notes into clear, engaging, well-structured prose. Adapt tone to the request and never invent facts.' },
  { name: 'Critic', description: 'Finds flaws and improves arguments', temperature: 0.5, systemPrompt: 'You are a sharp editor and critic. Point out weaknesses, logical gaps, and missing considerations, then suggest concrete improvements. Be direct but constructive.' },
];

function seedAgentsForUser(userId) {
  const agents = stores.agents.load();
  if (agents.some((a) => a.userId === userId)) return;
  const now = new Date().toISOString();
  for (const t of DEFAULT_AGENT_TEMPLATES) {
    agents.push({ id: id(), userId, ...t, model: '', createdAt: now });
  }
  stores.agents.save();
}

// One-time migration: any pre-auth global records get assigned to the first user.
function migrateOrphans() {
  const first = stores.users.load()[0];
  if (!first) return;
  let changed = false;
  for (const store of [stores.agents, stores.conversations, stores.crewRuns]) {
    for (const rec of store.load()) {
      if (!rec.userId) { rec.userId = first.id; changed = true; }
    }
  }
  if (changed) { stores.agents.save(); stores.conversations.save(); stores.crewRuns.save(); }
}
migrateOrphans();

// ---------- auth ----------
// Public endpoints (no auth required).
const PUBLIC_API = new Set(['/api/auth/signup', '/api/auth/login', '/api/auth/forgot', '/api/auth/reset', '/api/auth/verify', '/api/tiers', '/webhook/stripe', '/docs', '/healthz']);

app.use((req, res, next) => {
  if (PUBLIC_API.has(req.path) || req.path.startsWith('/s/')) return next();
  const bearer = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  req.user = users.getUserByToken(bearer) || users.getUserByApiKey(bearer) || users.getUserByKey(req.header('x-api-key'));
  if (!req.user) return res.status(401).json({ error: 'Not authenticated. Please log in.', code: 'UNAUTHENTICATED' });
  next();
});

// ---------- auth routes ----------
app.post('/api/auth/signup', (req, res) => {
  try {
    const user = users.signup(req.body || {});
    seedAgentsForUser(user.id);
    mailer.sendWelcome(user).catch(() => {});
    const verifyToken = users.issueEmailVerifyToken(user.id);
    if (verifyToken) {
      const link = (process.env.APP_URL || 'http://localhost:3000') + '/api/auth/verify?token=' + verifyToken;
      mailer.sendEmailVerify(user.email, link).catch(() => {});
    }
    const { token } = users.login({ email: user.email, password: req.body.password });
    res.json({ token, user: users.publicUser(user) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Email verification (public link from email)
app.get('/api/auth/verify', (req, res) => {
  try {
    users.verifyEmailByToken(req.query.token);
    res.redirect('/app?verified=1');
  } catch (err) {
    res.redirect('/app?verified=0&msg=' + encodeURIComponent(err.message));
  }
});

app.post('/api/auth/resend-verification', (req, res) => {
  const token = users.issueEmailVerifyToken(req.user.id);
  if (token) {
    const link = (process.env.APP_URL || 'http://localhost:3000') + '/api/auth/verify?token=' + token;
    mailer.sendEmailVerify(req.user.email, link).catch(() => {});
  }
  res.json({ ok: true, message: 'Verification email sent.' });
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { token, user } = users.login(req.body || {});
    seedAgentsForUser(user.id);
    res.json({ token, user: users.publicUser(user) });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const bearer = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  users.logout(bearer);
  res.json({ ok: true });
});

// ---------- billing (Stripe) ----------
app.get('/api/billing/status', (req, res) => {
  res.json({ configured: billing.configured(), tier: req.user.tier, isPro: req.user.tier === 'pro', hasCustomer: !!req.user.stripeCustomerId });
});

app.post('/api/billing/checkout', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createCheckoutSession({ user: req.user, baseUrl });
    res.json(session);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/billing/portal', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createPortalSession({ user: req.user, baseUrl });
    res.json(session);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Stripe webhook (raw body, no auth). Sets tier on payment events.
app.post('/webhook/stripe', async (req, res) => {
  try {
    const result = await billing.handleWebhook(req.body, req.header('stripe-signature'));
    res.json({ received: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- tiers & me ----------
app.get('/api/tiers', (req, res) => res.json(publicTiers()));

app.get('/api/me', (req, res) => {
  const tier = TIERS[req.user.tier] || TIERS.free;
  const q = checkQuota(req.user.id, req.user.tier);
  const llm = req.user.llm || {};
  res.json({
    user: users.publicUser(req.user),
    tier: { id: req.user.tier, name: tier.name },
    usage: { used: q.used, limit: q.limit, remaining: q.remaining, resetsAt: q.resetsAt },
    limits: { maxAgents: tier.maxAgents, maxCrewRounds: tier.maxCrewRounds },
    llm: { baseURL: llm.baseURL, defaultModel: llm.defaultModel, hasApiKey: !!llm.apiKey },
    isAdmin: isAdmin(req.user),
    emailVerified: !!req.user.emailVerified,
  });
});

// ---------- per-user LLM config ----------
app.get('/api/config', (req, res) => {
  const c = req.user.llm || stores.config.load();
  res.json({ baseURL: c.baseURL, defaultModel: c.defaultModel, hasApiKey: !!c.apiKey });
});

app.put('/api/config', (req, res) => {
  req.user.llm = req.user.llm || { baseURL: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' };
  const c = req.user.llm;
  const { baseURL, apiKey, defaultModel } = req.body || {};
  if (baseURL !== undefined) c.baseURL = baseURL;
  if (apiKey !== undefined) c.apiKey = apiKey;
  if (defaultModel !== undefined) c.defaultModel = defaultModel;
  stores.users.save();
  res.json({ baseURL: c.baseURL, defaultModel: c.defaultModel, hasApiKey: !!c.apiKey });
});

// ---------- agents CRUD (scoped to user) ----------
app.get('/api/agents', (req, res) => {
  res.json(stores.agents.load().filter((a) => a.userId === req.user.id));
});

app.post('/api/agents', (req, res) => {
  const { name, description = '', systemPrompt = '', model = '', temperature = 0.7 } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Agent name is required' });
  const tier = TIERS[req.user.tier] || TIERS.free;
  const mine = stores.agents.load().filter((a) => a.userId === req.user.id);
  if (mine.length >= tier.maxAgents) {
    return res.status(402).json({ error: `Your ${tier.name} plan allows up to ${tier.maxAgents} agents. Upgrade to create more.` });
  }
  const agent = {
    id: id(), userId: req.user.id, name: name.trim(), description, systemPrompt,
    model: model.trim(), temperature: Number(temperature) || 0.7, createdAt: new Date().toISOString(),
  };
  stores.agents.load().push(agent);
  stores.agents.save();
  res.json(agent);
});

// Export all agents as a JSON bundle (must come before /:id)
app.get('/api/agents/export-all', (req, res) => {
  const list = stores.agents.load().filter((a) => a.userId === req.user.id).map((a) => ({
    name: a.name, description: a.description || '', systemPrompt: a.systemPrompt || '',
    model: a.model || '', temperature: typeof a.temperature === 'number' ? a.temperature : 0.7,
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="agents-export.json"');
  res.json({ schemaVersion: 1, count: list.length, agents: list });
});

app.get('/api/agents/:id', (req, res) => {
  const agent = stores.agents.load().find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

app.put('/api/agents/:id', (req, res) => {
  const agent = stores.agents.load().find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const fields = ['name', 'description', 'systemPrompt', 'model', 'temperature'];
  for (const f of fields) if (req.body?.[f] !== undefined) agent[f] = req.body[f];
  if (agent.temperature !== undefined) agent.temperature = Number(agent.temperature) || 0.7;
  stores.agents.save();
  res.json(agent);
});

app.delete('/api/agents/:id', (req, res) => {
  const agents = stores.agents.load();
  const i = agents.findIndex((a) => a.id === req.params.id && a.userId === req.user.id);
  if (i === -1) return res.status(404).json({ error: 'Agent not found' });
  agents.splice(i, 1);
  stores.agents.save();
  const convs = stores.conversations.load();
  stores.conversations.cache = convs.filter((c) => !(c.agentId === req.params.id && c.userId === req.user.id));
  stores.conversations.save();
  res.json({ ok: true });
});

// ---------- conversations (scoped) ----------
app.get('/api/conversations', (req, res) => {
  const { agentId } = req.query;
  let convs = stores.conversations.load().filter((c) => c.userId === req.user.id);
  if (agentId) convs = convs.filter((c) => c.agentId === agentId);
  const list = convs
    .map((c) => ({
      id: c.id, agentId: c.agentId, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
      messageCount: c.messages.length, lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || '',
    }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list);
});

// Search conversations by message content (must come before /:id route)
app.get('/api/conversations/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json([]);
  const matches = stores.conversations.load()
    .filter((c) => c.userId === req.user.id)
    .filter((c) => (c.messages || []).some((m) => (m.content || '').toLowerCase().includes(q)))
    .map((c) => ({
      id: c.id, agentId: c.agentId, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
      messageCount: c.messages.length, lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || '',
    }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(matches);
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = stores.conversations.load().find((c) => c.id === req.params.id && c.userId === req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

app.delete('/api/conversations/:id', (req, res) => {
  const convs = stores.conversations.load();
  const i = convs.findIndex((c) => c.id === req.params.id && c.userId === req.user.id);
  if (i === -1) return res.status(404).json({ error: 'Conversation not found' });
  convs.splice(i, 1);
  stores.conversations.save();
  res.json({ ok: true });
});

// Chat: send a message, stream the reply (SSE).
app.post('/api/chat', async (req, res) => {
  const send = sse(res);
  try {
    const { agentId, content } = req.body || {};
    if (!content || !content.trim()) throw new Error('Message content is required');
    const agent = stores.agents.load().find((a) => a.id === agentId && a.userId === req.user.id);
    if (!agent) throw new Error('Agent not found');
    const tier = TIERS[req.user.tier] || TIERS.free;
    const q = checkQuota(req.user.id, req.user.tier);
    if (!q.ok) { notifyQuota(req.user, 0, q.limit, true); throw new Error(`Daily quota for your ${tier.name} plan is exhausted (${q.used}/${q.limit} today). It resets at ${new Date(q.resetsAt).toLocaleString()} — runs resume automatically tomorrow.`); }
    const config = req.user.llm || stores.config.load();

    let conv;
    const convs = stores.conversations.load();
    if (req.body.conversationId) conv = convs.find((c) => c.id === req.body.conversationId && c.userId === req.user.id);
    if (!conv) {
      conv = { id: id(), userId: req.user.id, agentId, title: content.trim().slice(0, 60), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
      convs.push(conv);
    }

    const userMsg = { role: 'user', content: content.trim(), ts: Date.now() };
    conv.messages.push(userMsg);
    send({ type: 'user_message', message: userMsg, conversationId: conv.id });
    const assistantMsg = { role: 'assistant', content: '', ts: Date.now() };
    send({ type: 'assistant_start' });

    await runAgentStream({
      agent, history: conv.messages, config,
      onToken: (delta) => { assistantMsg.content += delta; send({ type: 'token', delta }); },
    });

    conv.messages.push(assistantMsg);
    conv.updatedAt = new Date().toISOString();
    stores.conversations.save();
    const after = consumeQuota(req.user.id, req.user.tier);
    notifyQuota(req.user, after.remaining, after.limit, false);
    const promptText = conv.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const u = usage.record({ userId: req.user.id, type: 'chat', agentId, prompt: promptText, completion: assistantMsg.content });
    send({ type: 'done', conversationId: conv.id, message: assistantMsg, quota: { used: after.used, limit: after.limit, remaining: after.remaining }, usage: u });
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally { res.end(); }
});

// ---------- crew runs (scoped) ----------
app.get('/api/crew/runs', (req, res) => {
  const runs = stores.crewRuns.load()
    .filter((r) => r.userId === req.user.id)
    .map((r) => ({ ...r, outputs: undefined }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(runs);
});

app.get('/api/crew/runs/:id', (req, res) => {
  const run = stores.crewRuns.load().find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

app.delete('/api/crew/runs/:id', (req, res) => {
  const before = stores.crewRuns.load();
  const target = before.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!target) return res.status(404).json({ error: 'Run not found' });
  stores.crewRuns.cache = before.filter((r) => r.id !== req.params.id);
  stores.crewRuns.save();
  res.json({ ok: true, deleted: req.params.id });
});

app.post('/api/crew/run', async (req, res) => {
  const send = sse(res);
  try {
    const { agentIds = [], task, rounds = 1 } = req.body || {};
    if (!task || !task.trim()) throw new Error('Task is required');
    if (!agentIds.length) throw new Error('Select at least one agent');
    const tier = TIERS[req.user.tier] || TIERS.free;
    const nRounds = Math.max(1, Math.min(10, Number(rounds) || 1));
    if (nRounds > tier.maxCrewRounds) throw new Error(`Your ${tier.name} plan allows up to ${tier.maxCrewRounds} crew round(s). Upgrade for more.`);
    const q = checkQuota(req.user.id, req.user.tier);
    if (!q.ok) { notifyQuota(req.user, 0, q.limit, true); throw new Error(`Daily quota for your ${tier.name} plan is exhausted (${q.used}/${q.limit} today). Resets ${new Date(q.resetsAt).toLocaleString()}.`); }
    const mine = stores.agents.load().filter((a) => a.userId === req.user.id);
    const agents = agentIds.map((aid) => mine.find((a) => a.id === aid)).filter(Boolean);
    if (!agents.length) throw new Error('No valid agents selected');
    const config = req.user.llm || stores.config.load();
    const runId = id();

    const outputs = await runCrew({ agents, task: task.trim(), rounds: nRounds, config, onEvent: (evt) => send(evt) });

    stores.crewRuns.load().push({
      id: runId, userId: req.user.id, task: task.trim(),
      agentIds: agents.map((a) => a.id), agentNames: agents.map((a) => a.name),
      rounds: nRounds, outputs, createdAt: new Date().toISOString(),
    });
    stores.crewRuns.save();
    const afterCrew = consumeQuota(req.user.id, req.user.tier);
    notifyQuota(req.user, afterCrew.remaining, afterCrew.limit, false);
    usage.record({ userId: req.user.id, type: 'crew', prompt: task, completion: outputs.map((o) => o.content).join('\n') });
    send({ type: 'saved', runId });
  } catch (err) {
    send({ type: 'error', error: err.message });
    res.end();
  }
});

// ---------- usage metering ----------
app.get('/api/usage/summary', (req, res) => {
  const days = Math.min(90, parseInt(req.query.days, 10) || 30);
  res.json(usage.summary(req.user.id, days));
});

// ---------- admin ----------
// Admin access: emails in ADMIN_EMAILS env var, or the first (seeded) user.
function isAdmin(user) {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (admins.includes((user.email || '').toLowerCase())) return true;
  const first = stores.users.load()[0];
  return first && first.id === user.id;
}

app.get('/api/admin/users', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
  const list = stores.users.load().map((u) => ({
    id: u.id, email: u.email, name: u.name, tier: u.tier,
    createdAt: u.createdAt, hasStripe: !!u.stripeCustomerId,
    usage: usage.summary(u.id, 30).totals,
  }));
  res.json(list);
});

app.patch('/api/admin/users/:id/tier', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
  const u = stores.users.load().find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const tier = req.body?.tier;
  if (!['free', 'pro', 'enterprise'].includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  u.tier = tier;
  stores.users.save();
  res.json({ ok: true, user: { id: u.id, email: u.email, tier: u.tier } });
});

// ---------- user API keys (developer access) ----------
app.get('/api/user/api-keys', (req, res) => res.json(users.listApiKeys(req.user)));

app.post('/api/user/api-keys', (req, res) => {
  const created = users.createApiKey(req.user, req.body?.name);
  res.json(created); // full `key` shown once, never stored in plaintext
});

app.delete('/api/user/api-keys/:id', (req, res) => {
  if (!users.revokeApiKey(req.user, req.params.id)) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

// ---------- /v1 developer API (auth via Bearer API key or session) ----------
app.get('/v1/agents', (req, res) => {
  res.json(stores.agents.load().filter((a) => a.userId === req.user.id).map(({ systemPrompt, ...rest }) => rest));
});

app.post('/v1/chat', async (req, res) => {
  try {
    const { agentId, content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });
    const agent = stores.agents.load().find((a) => a.id === agentId && a.userId === req.user.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const q = checkQuota(req.user.id, req.user.tier);
    if (!q.ok) return res.status(429).json({ error: 'Daily quota exhausted', resetsAt: q.resetsAt });
    const config = req.user.llm || stores.config.load();
    let full = '';
    await runAgentStream({ agent, history: [{ role: 'user', content: content.trim() }], config, onToken: (d) => { full += d; } });
    consumeQuota(req.user.id, req.user.tier);
    usage.record({ userId: req.user.id, type: 'chat', agentId, prompt: content, completion: full });
    res.json({ role: 'assistant', content: full, agent: { id: agent.id, name: agent.name } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Simple API docs page
app.get('/docs', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agent Studio API</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-950 text-slate-100 p-8 max-w-3xl mx-auto">
<h1 class="text-2xl font-bold mb-4">Agent Studio API v1</h1>
<p class="text-slate-400 mb-6">Authenticate with <code class="bg-slate-800 px-1 rounded">Authorization: Bearer sk_live_...</code> (create keys in the app → Settings).</p>
<div class="space-y-4">
<div class="bg-slate-900 border border-slate-800 rounded-lg p-4"><div class="font-mono text-emerald-400">GET /v1/agents</div><p class="text-sm text-slate-400 mt-1">List your agents.</p></div>
<div class="bg-slate-900 border border-slate-800 rounded-lg p-4"><div class="font-mono text-emerald-400">POST /v1/chat</div><p class="text-sm text-slate-400 mt-1">Body: <code>{"agentId":"...","content":"Hello"}</code> → returns <code>{"role":"assistant","content":"..."}</code>.</p></div>
<div class="bg-slate-900 border border-slate-800 rounded-lg p-4"><div class="font-mono text-emerald-400">GET/POST/DELETE /api/user/api-keys</div><p class="text-sm text-slate-400 mt-1">Manage your revocable API keys.</p></div>
</div></body></html>`);
});

// ---------- data export & GDPR deletion ----------
app.get('/api/export', (req, res) => {
  const uid = req.user.id;
  res.json({
    exportedAt: new Date().toISOString(),
    profile: { id: req.user.id, email: req.user.email, name: req.user.name, tier: req.user.tier, createdAt: req.user.createdAt },
    agents: stores.agents.load().filter((a) => a.userId === uid),
    conversations: stores.conversations.load().filter((c) => c.userId === uid),
    crewRuns: stores.crewRuns.load().filter((c) => c.userId === uid),
    apiKeys: (req.user.apiKeys || []).map(({ keyHash, ...rest }) => rest),
    usage: usage.summary(uid, 90),
  });
});

app.delete('/api/user/account', (req, res) => {
  const uid = req.user.id;
  stores.agents.cache = stores.agents.load().filter((a) => a.userId !== uid); stores.agents.save();
  stores.conversations.cache = stores.conversations.load().filter((c) => c.userId !== uid); stores.conversations.save();
  stores.crewRuns.cache = stores.crewRuns.load().filter((c) => c.userId !== uid); stores.crewRuns.save();
  const u = stores.usage.load(); delete u[uid]; stores.usage.cache = u; stores.usage.save();
  stores.users.cache = stores.users.load().filter((x) => x.id !== uid); stores.users.save();
  res.json({ ok: true, deleted: uid });
});

// ---------- health check ----------
app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), version: '1.0.0' }));

// ---------- public agent sharing ----------
app.patch('/api/agents/:id/share', (req, res) => {
  const a = stores.agents.load().find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  a.shared = !!req.body?.shared;
  if (a.shared && !a.shareId) a.shareId = id() + id();
  stores.agents.save();
  res.json({ id: a.id, shared: a.shared, shareId: a.shareId, shareUrl: a.shared ? `/s/${a.shareId}` : null });
});

app.get('/s/:shareId', (req, res) => {
  const a = stores.agents.load().find((x) => x.shareId === req.params.shareId && x.shared);
  if (!a) return res.status(404).send('Agent not found or not shared.');
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${a.name} — Agent Studio</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-6">
<div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
<div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-500/15 flex items-center justify-center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg></div>
<h1 class="text-2xl font-bold mb-2">${a.name}</h1>
<p class="text-slate-400 text-sm mb-4">${a.description || ''}</p>
<p class="text-xs text-slate-500 mb-6">${a.systemPrompt ? a.systemPrompt.slice(0, 200) + (a.systemPrompt.length > 200 ? '…' : '') : ''}</p>
<a href="/app?signup=1" class="inline-block bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-6 py-2.5 rounded-xl transition">Use this agent — free</a>
<p class="text-xs text-slate-600 mt-4">Powered by Agent Studio</p>
</div></body></html>`);
});

// ---------- change password ----------
app.post('/api/user/password', (req, res) => {
  try {
    users.changePassword(req.user.id, req.body?.oldPassword, req.body?.newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- password reset ----------
app.post('/api/auth/forgot', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const token = users.createPasswordResetToken(email);
  if (token && mailer) {
    const link = (process.env.APP_URL || 'http://localhost:3000') + '/app?reset=' + token;
    try { await mailer.sendPasswordReset(email, link); } catch { /* dev mode logs */ }
  }
  res.json({ ok: true, message: 'If that account exists, a reset link has been emailed.' });
});

app.post('/api/auth/reset', (req, res) => {
  try {
    users.resetPasswordByToken(req.body?.token, req.body?.newPassword);
    res.json({ ok: true, message: 'Password reset. You can now log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- conversation rename & agent clone ----------
app.patch('/api/conversations/:id', (req, res) => {
  const conv = stores.conversations.load().find((c) => c.id === req.params.id && c.userId === req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (typeof req.body?.title === 'string') { conv.title = req.body.title.trim().slice(0, 80) || conv.title; conv.updatedAt = new Date().toISOString(); stores.conversations.save(); }
  res.json(conv);
});

app.post('/api/agents/:id/clone', (req, res) => {
  const a = stores.agents.load().find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  const copy = { ...a, id: id(), name: (a.name || 'Agent') + ' (copy)', createdAt: new Date().toISOString(), shared: false, shareId: null };
  stores.agents.cache = [...stores.agents.load(), copy];
  stores.agents.save();
  res.json(copy);
});

// ---------- session management ----------
app.post('/api/user/sessions/revoke-other', (req, res) => {
  const bearer = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  res.json(users.revokeOtherSessions(req.user.id, bearer));
});

// ---------- change email ----------
app.post('/api/user/email', (req, res) => {
  try {
    const r = users.changeEmail(req.user.id, req.body?.password, req.body?.newEmail);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- conversation export ----------
app.get('/api/conversations/:id/export', (req, res) => {
  const conv = stores.conversations.load().find((c) => c.id === req.params.id && c.userId === req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const fmt = (req.query.format || 'json').toLowerCase();
  if (fmt === 'md') {
    const lines = [`# ${conv.title || 'Chat'}`, '', `Agent: ${conv.agentId}`, `Exported: ${new Date().toISOString()}`, ''];
    for (const m of conv.messages || []) {
      lines.push(`**${m.role === 'user' ? 'You' : 'Assistant'}** (${new Date(m.ts || Date.now()).toLocaleString()})`);
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    res.type('text/markdown').setHeader('Content-Disposition', `attachment; filename="conversation-${conv.id}.md"`).send(lines.join('\n'));
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${conv.id}.json"`).json(conv);
  }
});

// ---------- agent export / import ----------
app.get('/api/agents/:id/export', (req, res) => {
  const a = stores.agents.load().find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  const { name, description, systemPrompt, model, temperature } = a;
  res.setHeader('Content-Disposition', `attachment; filename="agent-${(name || 'agent').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json"`);
  res.json({ name, description: description || '', systemPrompt: systemPrompt || '', model: model || '', temperature: typeof temperature === 'number' ? temperature : 0.7, schemaVersion: 1 });
});

app.post('/api/agents/import', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim().slice(0, 60) || 'Imported agent';
  const agent = {
    id: id(), userId: req.user.id, name,
    description: (b.description || '').slice(0, 200),
    systemPrompt: (b.systemPrompt || '').slice(0, 8000),
    model: (b.model || '').slice(0, 100),
    temperature: typeof b.temperature === 'number' ? Math.min(2, Math.max(0, b.temperature)) : 0.7,
    createdAt: new Date().toISOString(), shared: false, shareId: null,
  };
  stores.agents.cache = [...stores.agents.load(), agent];
  stores.agents.save();
  res.json(agent);
});

// ---------- agent pin ----------
app.patch('/api/agents/:id/pin', (req, res) => {
  const a = stores.agents.load().find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  a.pinned = !!req.body?.pinned;
  stores.agents.save();
  res.json({ ok: true, pinned: a.pinned });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Agent Studio running at http://localhost:${PORT}`);
  });
}
module.exports = app;
