// Agent Studio frontend — vanilla JS, no build step.
const state = {
  token: localStorage.getItem('as_token') || null,
  authMode: 'login',
  agents: [],
  currentAgentId: null,
  conversations: [],
  currentConvId: null,
  messages: [],
  streaming: false,
  crewSelected: new Set(),
  crewStreaming: false,
  editingAgentId: null,
  tierName: '',
};
const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
function authHeaders() {
  return state.token ? { Authorization: 'Bearer ' + state.token } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem('as_token');
    state.token = null;
    showAuth();
    throw new Error('Session expired — please log in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// POST with SSE response; calls onEvent(evt) for each `data:` line. Resolves at end.
async function postSSE(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    localStorage.removeItem('as_token'); state.token = null; showAuth();
    throw new Error('Session expired — please log in again.');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { onEvent(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
  }
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 4000);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- auth ----------
function showAuth(mode) {
  if (mode) state.authMode = mode;
  setAuthTab(state.authMode);
  $('authOverlay').classList.remove('hidden');
  $('userEmail').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('docsLink')?.classList.add('hidden');
  $('exportConvBtn')?.classList.add('hidden');
}

function hideAuth() {
  $('authOverlay').classList.add('hidden');
  $('userEmail').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('docsLink')?.classList.remove('hidden');
  $('exportConvBtn')?.classList.remove('hidden');
}

function setAuthTab(mode) {
  state.authMode = mode;
  const login = mode === 'login';
  $('authTabLogin').className = 'flex-1 px-3 py-1.5 rounded-md font-medium ' + (login ? 'bg-slate-700' : 'text-slate-400');
  $('authTabSignup').className = 'flex-1 px-3 py-1.5 rounded-md font-medium ' + (!login ? 'bg-slate-700' : 'text-slate-400');
  $('authNameField').classList.toggle('hidden', login);
  $('authSubmit').textContent = login ? 'Log in' : 'Create account';
  $('authError').classList.add('hidden');
}

async function authSubmit() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const errEl = $('authError');
  try {
    const body = state.authMode === 'signup'
      ? { email, password, name: $('authName').value.trim() }
      : { email, password };
    const url = state.authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    state.token = data.token;
    localStorage.setItem('as_token', data.token);
    hideAuth();
    await afterLogin();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('as_token');
  state.token = null;
  location.reload();
}

async function afterLogin() {
  const me = await api('/api/me');
  $('userEmail').textContent = me.user.email;
  if (me.emailVerified === false) $('verifyBanner')?.classList.remove('hidden');
  else $('verifyBanner')?.classList.add('hidden');
  if (location.search.includes('verified=1')) { toast('Email verified!'); $('verifyBanner')?.classList.add('hidden'); history.replaceState(null, '', location.pathname); }
  if (location.search.includes('verified=0')) { toast(new URLSearchParams(location.search).get('msg') || 'Verification failed or link expired.'); history.replaceState(null, '', location.pathname); }
  state.tierName = me.tier.name;
  state.isAdmin = !!me.isAdmin;
  const isPro = me.tier.id === 'pro';
  $('upgradeBtn').classList.toggle('hidden', isPro);
  renderQuotaBadge(me.usage);
  loadConfig();
  await loadAgents();
}

async function upgradeToPro() {
  try {
    const r = await api('/api/billing/checkout', { method: 'POST' });
    if (r.url) window.location.href = r.url;
    else toast('Billing not available yet.');
  } catch (err) { toast(err.message); }
}

function renderQuotaBadge(usage) {
  const b = $('quotaBadge');
  if (!usage) return;
  b.classList.remove('hidden');
  b.textContent = `${state.tierName || 'Free'} · ${usage.used}/${usage.limit} today`;
  const pct = usage.limit > 0 ? usage.used / usage.limit : 0;
  b.className = 'text-xs px-2 py-0.5 rounded-full border ' +
    (pct > 0.9 ? 'bg-red-500/15 text-red-400 border-red-500/30'
     : pct > 0.6 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
     : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30');
}

// ---------- config ----------
async function loadConfig() {
  try {
    const c = await api('/api/config');
    const badge = $('configStatus');
    if (c.hasApiKey) {
      badge.textContent = c.defaultModel || 'Configured';
      badge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    } else {
      badge.textContent = 'No LLM key — Settings';
      badge.className = 'text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30';
    }
    return c;
  } catch { return null; }
}

// ---------- agents ----------
async function loadAgents() {
  state.agents = await api('/api/agents');
  renderAgents();
  renderCrewPicker();
  if (!state.currentAgentId && state.agents.length) {
    const last = localStorage.getItem('as_lastAgent');
    selectAgent((last && state.agents.find((a) => a.id === last)) ? last : state.agents[0].id);
  }
}

function renderAgents() {
  const list = $('agentList');
  list.innerHTML = '';
  const q = (state.search || '').toLowerCase();
  const shown = q ? state.agents.filter((a) => (a.name + ' ' + (a.description || '')).toLowerCase().includes(q)) : state.agents;
  if (!shown.length) { list.appendChild(el('div', 'px-3 py-2 text-xs text-slate-500', 'No agents match.')); return; }
  shown.sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0));
  for (const a of shown) {
    const row = el('div', 'flex items-center gap-1');
    const item = el('button', 'flex-1 min-w-0 text-left px-3 py-2 rounded-lg transition group ' +
      (a.id === state.currentAgentId ? 'bg-emerald-500/15 border border-emerald-500/40' : 'hover:bg-slate-800 border border-transparent'));
    const name = el('div', 'text-sm font-medium truncate', (a.pinned ? '📌 ' : '') + a.name);
    const meta = el('div', 'text-xs text-slate-500 truncate', a.description || (a.model || 'default model'));
    item.append(name, meta);
    item.onclick = () => selectAgent(a.id);
    const pin = el('button', 'text-xs px-1.5 py-1 rounded text-slate-500 hover:text-amber-300 hover:bg-slate-800 transition flex-shrink-0', a.pinned ? '★' : '☆');
    pin.title = a.pinned ? 'Unpin' : 'Pin to top';
    pin.onclick = async (e) => {
      e.stopPropagation();
      try { await api('/api/agents/' + a.id + '/pin', { method: 'PATCH', body: JSON.stringify({ pinned: !a.pinned }) }); await loadAgents(); }
      catch (err) { toast(err.message); }
    };
    row.append(item, pin);
    list.appendChild(row);
  }
  if (!state.agents.length) {
    list.appendChild(el('div', 'text-xs text-slate-600 px-3 py-4 text-center', 'No agents yet. Create one!'));
  }
}

function currentAgent() {
  return state.agents.find((a) => a.id === state.currentAgentId);
}

async function selectAgent(id) {
  state.currentAgentId = id;
  try { localStorage.setItem('as_lastAgent', id); } catch {}
  state.currentConvId = null;
  state.messages = [];
  renderAgents();
  const a = currentAgent();
  $('chatAgentName').textContent = a ? a.name : 'Select an agent';
  $('chatAgentDesc').textContent = a ? (a.description + (a.model ? ` · model: ${a.model}` : '')) : '';
  renderMessages();
  await loadConversations();
}

// ---------- conversations ----------
async function loadConversations() {
  if (!state.currentAgentId) { state.conversations = []; renderConvs(); return; }
  state.conversations = await api(`/api/conversations?agentId=${state.currentAgentId}`);
  renderConvs();
}

function renderConvs() {
  const list = $('convList');
  list.innerHTML = '';
  const q = (state.search || '').toLowerCase();
  let shown = q ? state.conversations.filter((c) => (c.title || '').toLowerCase().includes(q)) : state.conversations;
  if (q && Array.isArray(state.searchConvs)) {
    const seen = new Set(shown.map((c) => c.id));
    for (const c of state.searchConvs) if (!seen.has(c.id)) { shown.push(c); seen.add(c.id); }
  }
  if (!shown.length) { list.appendChild(el('div', 'px-3 py-2 text-xs text-slate-500', q ? 'No chats match.' : 'No chats yet.')); return; }
  for (const c of shown) {
    const row = el('div', 'flex items-center gap-1 group');
    const item = el('button', 'flex-1 min-w-0 text-left px-3 py-2 rounded-lg transition ' +
      (c.id === state.currentConvId ? 'bg-slate-800 border border-slate-600' : 'hover:bg-slate-800 border border-transparent'));
    const title = el('div', 'text-xs font-medium truncate', c.title || 'New chat');
    const sub = el('div', 'text-[10px] text-slate-500 truncate', c.lastMessage || `${c.messageCount} messages`);
    item.append(title, sub);
    item.onclick = () => selectConversation(c.id);
    item.ondblclick = async (e) => {
      e.stopPropagation();
      const title = prompt('Rename conversation:', c.title || '');
      if (title === null) return;
      try { await api('/api/conversations/' + c.id, { method: 'PATCH', body: JSON.stringify({ title }) }); loadConversations(); }
      catch (err) { toast(err.message); }
    };
    const del = el('button', 'opacity-0 group-hover:opacity-100 transition text-slate-500 hover:text-red-400 text-xs px-1.5 py-1 rounded', '✕');
    del.title = 'Delete conversation';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation? This cannot be undone.')) return;
      try {
        await api('/api/conversations/' + c.id, { method: 'DELETE' });
        if (state.currentConvId === c.id) { state.currentConvId = null; state.messages = []; renderMessages(); }
        loadConversations();
      } catch (err) { toast(err.message); }
    };
    row.append(item, del);
    list.appendChild(row);
  }
  if (!state.conversations.length) {
    list.appendChild(el('div', 'text-[11px] text-slate-600 px-3 py-3 text-center', 'No chats yet — send a message to start one.'));
  }
}

async function selectConversation(id) {
  const conv = await api(`/api/conversations/${id}`);
  state.currentConvId = id;
  state.messages = conv.messages || [];
  renderConvs();
  renderMessages();
}

// ---------- messages ----------
function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  const a = currentAgent();
  if (!a) {
    const welcome = el('div', 'text-center py-16 px-4');
    welcome.innerHTML = '<div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-500/10 flex items-center justify-center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z"/></svg></div><h3 class="font-semibold text-lg mb-2">Welcome to Agent Studio</h3><p class="text-sm text-slate-400 max-w-sm mx-auto mb-4">Pick an agent from the sidebar and start chatting. Try the Researcher, Writer, or Critic — or create your own.</p><p class="text-xs text-slate-500">Tip: switch to Crew Run to chain multiple agents together on one task.</p>';
    box.appendChild(welcome);
    return;
  }
  if (!state.messages.length && a) {
    const empty = el('div', 'text-center text-slate-500 text-sm py-12');
    empty.append(el('div', 'text-base font-medium text-slate-300 mb-1', a.name));
    empty.append(el('div', 'max-w-md mx-auto', a.systemPrompt ? a.systemPrompt.slice(0, 160) + (a.systemPrompt.length > 160 ? '…' : '') : 'Send a message to start.'));
    box.appendChild(empty);
    return;
  }
  for (const m of state.messages) box.appendChild(messageBubble(m));
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant' && !state.streaming) {
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const row = el('div', 'flex justify-start pl-1 mt-1');
      const btn = el('button', 'text-xs text-slate-400 hover:text-white px-3 py-1 rounded-lg hover:bg-slate-800 transition', 'Regenerate response');
      btn.onclick = () => { $('chatInput').value = lastUser.content; sendMessage(); };
      row.appendChild(btn);
      box.appendChild(row);
    }
  }
  box.scrollTop = box.scrollHeight;
}

function renderMarkdown(text) {
  let s = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => '<pre class="bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-x-auto text-xs my-2 whitespace-pre-wrap"><code>' + c.replace(/^\n/, '') + '</code></pre>');
  s = s.replace(/`([^`\n]+)`/g, '<code class="bg-slate-800 rounded px-1 text-xs">$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-emerald-400 underline">$1</a>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener" class="text-emerald-400 underline">$2</a>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

function messageBubble(m) {
  const wrap = el('div', 'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start'));
  const bubble = el('div', (m.role === 'user' ? 'msg-user' : 'msg-assistant') + ' max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap group');
  if (m.role === 'assistant') {
    const a = currentAgent();
    bubble.prepend(el('div', 'text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1', a ? a.name : 'Agent'));
  }
  const content = el('div', 'break-words');
  content.innerHTML = renderMarkdown(m.content);
  bubble.appendChild(content);
  const meta = el('div', 'flex items-center gap-2 mt-1.5 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition');
  if (m.ts) meta.appendChild(el('span', '', new Date(m.ts).toLocaleString()));
  const copy = el('button', 'hover:text-white transition uppercase tracking-wide', 'Copy');
  copy.onclick = () => {
    (navigator.clipboard ? navigator.clipboard.writeText(m.content || '') : Promise.reject())
      .then(() => toast('Copied to clipboard'))
      .catch(() => { try { const ta = document.createElement('textarea'); ta.value = m.content || ''; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied to clipboard'); } catch { toast('Copy failed'); } });
  };
  meta.appendChild(copy);
  bubble.appendChild(meta);
  wrap.appendChild(bubble);
  return wrap;
}

async function sendMessage() {
  const input = $('chatInput');
  const content = input.value.trim();
  if (!content || state.streaming) return;
  const a = currentAgent();
  if (!a) { toast('Select an agent first'); return; }
  input.value = '';
  state.streaming = true;
  const controller = new AbortController();
  state.abortController = controller;
  const sendBtn = $('sendBtn');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Stop';
  sendBtn.onclick = () => controller.abort();
  const box = $('messages');
  box.innerHTML = '';
  for (const m of state.messages) box.appendChild(messageBubble(m));
  let assistantContent;
  try {
    await postSSE('/api/chat', { agentId: a.id, conversationId: state.currentConvId, content }, (evt) => {
      if (evt.type === 'user_message') {
        state.currentConvId = evt.conversationId;
        state.messages.push(evt.message);
        box.appendChild(messageBubble(evt.message));
        const wrap = el('div', 'flex justify-start');
        const inner = el('div', 'msg-assistant max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap');
        inner.prepend(el('div', 'text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1', a.name));
        assistantContent = el('div', 'cursor-blink');
        inner.appendChild(assistantContent);
        wrap.appendChild(inner);
        box.appendChild(wrap);
      } else if (evt.type === 'token') {
        if (assistantContent) assistantContent.textContent += evt.delta;
      } else if (evt.type === 'done') {
        state.messages.push(evt.message);
        if (assistantContent) assistantContent.classList.remove('cursor-blink');
        loadConversations();
        if (evt.quota) renderQuotaBadge({ used: evt.quota.used, limit: evt.quota.limit });
      } else if (evt.type === 'error') {
        throw new Error(evt.error);
      }
      box.scrollTop = box.scrollHeight;
    }, controller.signal);
  } catch (err) {
    if (err.name === 'AbortError') {
      toast('Generation stopped.');
      if (assistantContent) {
        assistantContent.classList.remove('cursor-blink');
        const partial = assistantContent.textContent;
        if (partial.trim()) state.messages.push({ role: 'assistant', content: partial, ts: Date.now(), stopped: true });
      }
    } else {
      toast(err.message);
      if (assistantContent) assistantContent.classList.remove('cursor-blink');
    }
  } finally {
    state.streaming = false;
    state.abortController = null;
    sendBtn.textContent = 'Send';
    sendBtn.disabled = false;
    sendBtn.onclick = sendMessage;
    $('sendBtn').disabled = false;
    input.focus();
  }
}

// ---------- agent modal ----------
function openAgentModal(agent) {
  state.editingAgentId = agent ? agent.id : null;
  $('agentModalTitle').textContent = agent ? 'Edit Agent' : 'New Agent';
  $('agentName').value = agent?.name || '';
  $('agentDesc').value = agent?.description || '';
  $('agentSystem').value = agent?.systemPrompt || '';
  $('agentModel').value = agent?.model || '';
  $('agentTemp').value = agent?.temperature ?? 0.7;
  $('tempVal').textContent = agent?.temperature ?? 0.7;
  $('deleteAgentBtn').classList.toggle('hidden', !agent);
  $('cloneAgentBtn').classList.toggle('hidden', !agent);
  $('exportAgentBtn').classList.toggle('hidden', !agent);
  const shareToggle = $('agentShareToggle');
  shareToggle.checked = !!agent?.shared;
  const linkBox = $('agentShareLink');
  if (agent?.shared && agent?.shareId) { linkBox.classList.remove('hidden'); linkBox.textContent = location.origin + '/s/' + agent.shareId; }
  else linkBox.classList.add('hidden');
  shareToggle.onchange = () => {
    if (shareToggle.checked && agent?.shareId) { linkBox.classList.remove('hidden'); linkBox.textContent = location.origin + '/s/' + agent.shareId; }
    else linkBox.classList.add('hidden');
  };
  $('agentModal').classList.remove('hidden');
}

async function saveAgent() {
  const name = $('agentName').value.trim();
  if (!name) { toast('Name is required'); return; }
  const body = {
    name,
    description: $('agentDesc').value.trim(),
    systemPrompt: $('agentSystem').value,
    model: $('agentModel').value.trim(),
    temperature: parseFloat($('agentTemp').value) || 0.7,
  };
  try {
    if (state.editingAgentId) {
      await api(`/api/agents/${state.editingAgentId}`, { method: 'PUT', body });
      try { await api(`/api/agents/${state.editingAgentId}/share`, { method: 'PATCH', body: JSON.stringify({ shared: $('agentShareToggle').checked }) }); } catch {}
    } else {
      const created = await api('/api/agents', { method: 'POST', body });
      state.currentAgentId = created.id;
    }
    $('agentModal').classList.add('hidden');
    await loadAgents();
    const a = currentAgent();
    if (a) { $('chatAgentName').textContent = a.name; $('chatAgentDesc').textContent = a.description; }
  } catch (err) { toast(err.message); }
}

async function deleteAgent() {
  if (!state.editingAgentId) return;
  if (!confirm('Delete this agent and all its chats?')) return;
  try {
    await api(`/api/agents/${state.editingAgentId}`, { method: 'DELETE' });
    $('agentModal').classList.add('hidden');
    state.currentAgentId = null; state.currentConvId = null; state.messages = [];
    await loadAgents();
    if (state.agents.length) selectAgent(state.agents[0].id);
    else { renderMessages(); renderConvs(); $('chatAgentName').textContent = 'Select an agent'; $('chatAgentDesc').textContent = ''; }
  } catch (err) { toast(err.message); }
}

// ---------- settings modal ----------
async function openSettings() {
  const c = await api('/api/config');
  $('cfgBaseURL').value = c.baseURL || '';
  $('cfgModel').value = c.defaultModel || '';
  $('cfgApiKey').value = '';
  $('settingsModal').classList.remove('hidden');
  try {
    const u = await api('/api/usage/summary?days=30');
    const t = u.totals;
    const recent = u.history.slice(0, 7).map(d => `${d.day}: ${d.messages} msg`).join('<br>');
    $('usagePanel').innerHTML =
      `<div class="grid grid-cols-4 gap-2 mb-2">
        <div class="bg-slate-800 rounded p-2 text-center"><div class="text-base font-semibold text-white">${t.messages}</div><div>chats</div></div>
        <div class="bg-slate-800 rounded p-2 text-center"><div class="text-base font-semibold text-white">${t.crewRuns}</div><div>crew</div></div>
        <div class="bg-slate-800 rounded p-2 text-center"><div class="text-base font-semibold text-white">${t.tokens.toLocaleString()}</div><div>tokens</div></div>
        <div class="bg-slate-800 rounded p-2 text-center"><div class="text-base font-semibold text-emerald-400">$${t.cost.toFixed(4)}</div><div>est.</div></div>
      </div>
      <div class="text-slate-500">Last 7 days:<br>${recent || 'No usage yet.'}</div>`;
  } catch {
    $('usagePanel').textContent = 'Usage unavailable.';
  }
  loadApiKeys();
  if (state.isAdmin) { $('adminSection').classList.remove('hidden'); loadAdminUsers(); }
  else $('adminSection').classList.add('hidden');
}

async function loadAdminUsers() {
  try {
    const users = await api('/api/admin/users');
    if (!users.length) { $('adminUserList').innerHTML = '<div class="text-slate-500">No users.</div>'; return; }
    $('adminUserList').innerHTML = users.map(u =>
      `<div class="flex items-center justify-between bg-slate-800/60 rounded px-2.5 py-1.5">
        <div><span class="text-slate-200">${u.email}</span> <span class="text-slate-500">· ${(u.usage?.tokens||0)} tok · ${(u.usage?.chats||0)} chats</span></div>
        <select data-admin-tier="${u.id}" class="bg-slate-900 border border-slate-700 rounded text-xs px-1.5 py-0.5 text-slate-200">
          <option value="free" ${u.tier==='free'?'selected':''}>Free</option>
          <option value="pro" ${u.tier==='pro'?'selected':''}>Pro</option>
          <option value="enterprise" ${u.tier==='enterprise'?'selected':''}>Enterprise</option>
        </select>
      </div>`).join('');
    $('adminUserList').querySelectorAll('[data-admin-tier]').forEach(sel => {
      sel.onchange = async () => {
        try { await api('/api/admin/users/' + sel.dataset.adminTier + '/tier', { method: 'PATCH', body: JSON.stringify({ tier: sel.value }) }); toast('Tier updated to ' + sel.value); }
        catch (err) { toast(err.message); loadAdminUsers(); }
      };
    });
  } catch { $('adminUserList').textContent = 'Could not load users.'; }
}

async function loadApiKeys() {
  try {
    const keys = await api('/api/user/api-keys');
    if (!keys.length) { $('apiKeyList').innerHTML = '<div class="text-slate-500">No API keys yet. Create one to use the /v1 API.</div>'; return; }
    $('apiKeyList').innerHTML = keys.map(k =>
      `<div class="flex items-center justify-between bg-slate-800/60 rounded px-2.5 py-1.5">
        <div><span class="font-mono text-slate-300">${k.prefix}…</span> <span class="text-slate-500">${k.name || 'Unnamed'}</span></div>
        <button class="text-red-400 hover:text-red-300" data-revoke="${k.id}">Revoke</button>
      </div>`).join('');
    $('apiKeyList').querySelectorAll('[data-revoke]').forEach(btn => {
      btn.onclick = async () => {
        await api('/api/user/api-keys/' + btn.dataset.revoke, { method: 'DELETE' });
        loadApiKeys();
      };
    });
  } catch { $('apiKeyList').textContent = 'Could not load API keys.'; }
}

// Create API key — show full key once
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'createApiKeyBtn') return;
  const name = prompt('Name this key (e.g. "Production app"):', 'My API key');
  if (name === null) return;
  try {
    const created = await api('/api/user/api-keys', { method: 'POST', body: JSON.stringify({ name }) });
    const d = $('newApiKeyDisplay');
    d.classList.remove('hidden');
    d.textContent = 'Copy now (shown once): ' + created.key;
    loadApiKeys();
  } catch (err) { alert('Failed: ' + err.message); }
});

// Export user data as JSON download
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'exportDataBtn') return;
  try {
    const data = await api('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agent-studio-export.json'; a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert('Export failed: ' + err.message); }
});

// Delete account (GDPR) — double confirm, then logout
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'deleteAccountBtn') return;
  if (!confirm('Delete your account? This permanently removes all your agents, chats, and data. This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
  try {
    await api('/api/user/account', { method: 'DELETE' });
    localStorage.removeItem('as_token');
    location.reload();
  } catch (err) { alert('Delete failed: ' + err.message); }
});

// Change password
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'changePwBtn') return;
  const oldP = $('pwOld').value, newP = $('pwNew').value, conf = $('pwConfirm').value;
  if (!oldP || !newP) { toast('Fill in all fields'); return; }
  if (newP.length < 6) { toast('New password must be at least 6 characters'); return; }
  if (newP !== conf) { toast('New passwords do not match'); return; }
  try {
    await api('/api/user/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldP, newPassword: newP }) });
    toast('Password updated');
    $('pwOld').value = ''; $('pwNew').value = ''; $('pwConfirm').value = '';
  } catch (err) { toast(err.message); }
});

async function saveSettings() {
  try {
    const apiKey = $('cfgApiKey').value.trim();
    const body = { baseURL: $('cfgBaseURL').value.trim(), defaultModel: $('cfgModel').value.trim() };
    if (apiKey) body.apiKey = apiKey;
    await api('/api/config', { method: 'PUT', body });
    $('settingsModal').classList.add('hidden');
    loadConfig();
  } catch (err) { toast(err.message); }
}

// ---------- crew ----------
function renderCrewPicker() {
  const box = $('crewAgentPicker');
  box.innerHTML = '';
  for (const a of state.agents) {
    const selected = state.crewSelected.has(a.id);
    const chip = el('button', 'px-3 py-1.5 rounded-full text-sm border transition ' +
      (selected ? 'bg-emerald-500 text-slate-950 border-emerald-500 font-medium' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'));
    chip.textContent = a.name;
    chip.onclick = () => {
      if (state.crewSelected.has(a.id)) state.crewSelected.delete(a.id);
      else state.crewSelected.add(a.id);
      renderCrewPicker();
    };
    box.appendChild(chip);
  }
  if (!state.agents.length) box.appendChild(el('span', 'text-sm text-slate-500', 'Create agents first.'));
}

async function runCrew() {
  const task = $('crewTask').value.trim();
  const rounds = parseInt($('crewRounds').value, 10) || 1;
  const agentIds = [...state.crewSelected];
  if (!task) { toast('Enter a task'); return; }
  if (!agentIds.length) { toast('Select at least one agent'); return; }
  state.crewStreaming = true;
  $('crewRunBtn').disabled = true;
  const out = $('crewOutput');
  out.innerHTML = '';
  const cards = {};
  try {
    await postSSE('/api/crew/run', { agentIds, task, rounds }, (evt) => {
      if (evt.type === 'agent_start') {
        const key = `${evt.agentId}:${evt.round}`;
        const card = el('div', 'crew-card streaming bg-slate-900 border border-slate-800 rounded-xl p-4');
        const head = el('div', 'flex items-center gap-2 mb-2');
        head.appendChild(el('span', 'w-2 h-2 rounded-full bg-emerald-400 typing-dot'));
        head.appendChild(el('span', 'text-sm font-semibold text-emerald-400', `${evt.name} · Round ${evt.round}`));
        card.appendChild(head);
        const content = el('div', 'text-sm whitespace-pre-wrap text-slate-200 cursor-blink');
        card.appendChild(content);
        out.appendChild(card);
        cards[key] = { card, content };
        state._crewCurrentKey = key;
      } else if (evt.type === 'token') {
        const c = cards[state._crewCurrentKey];
        if (c) c.content.textContent += evt.delta;
      } else if (evt.type === 'agent_end') {
        const key = `${evt.agentId}:${evt.round}`;
        const c = cards[key];
        if (c) { c.card.classList.remove('streaming'); c.content.classList.remove('cursor-blink'); }
      } else if (evt.type === 'done' || evt.type === 'saved') {
        loadCrewHistory();
      } else if (evt.type === 'error') {
        throw new Error(evt.error);
      }
      out.scrollIntoView({ block: 'nearest' });
    });
  } catch (err) {
    toast(err.message);
  } finally {
    state.crewStreaming = false;
    $('crewRunBtn').disabled = false;
  }
}

async function loadCrewHistory() {
  try {
    const runs = await api('/api/crew/runs');
    const box = $('crewHistory');
    box.innerHTML = '';
    for (const r of runs.slice(0, 10)) {
      const item = el('div', 'flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 hover:border-slate-600 transition');
      const info = el('button', 'flex-1 text-left min-w-0');
      info.appendChild(el('div', 'text-sm font-medium truncate', r.task));
      info.appendChild(el('div', 'text-xs text-slate-500', `${r.agentNames?.join(', ') || ''} · ${r.rounds} round(s) · ${new Date(r.createdAt).toLocaleString()}`));
      info.onclick = () => showCrewRun(r.id);
      const del = el('button', 'text-slate-600 hover:text-red-400 text-xs px-1.5', '✕');
      del.title = 'Delete run';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this crew run history?')) return;
        try { await api('/api/crew/runs/' + r.id, { method: 'DELETE' }); loadCrewHistory(); } catch (err) { toast(err.message); }
      };
      item.append(info, del);
      box.appendChild(item);
    }
    if (!runs.length) box.appendChild(el('div', 'text-xs text-slate-600', 'No past runs.'));
  } catch {}
}

async function showCrewRun(id) {
  try {
    const r = await api(`/api/crew/runs/${id}`);
    const out = $('crewOutput');
    out.innerHTML = '';
    out.appendChild(el('div', 'text-sm text-slate-400 mb-2', 'Task: ' + r.task));
    for (const o of r.outputs || []) {
      const card = el('div', 'bg-slate-900 border border-slate-800 rounded-xl p-4');
      card.appendChild(el('div', 'text-sm font-semibold text-emerald-400 mb-2', `${o.name} · Round ${o.round}`));
      card.appendChild(el('div', 'text-sm whitespace-pre-wrap text-slate-200', o.content));
      out.appendChild(card);
    }
    out.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { toast(err.message); }
}

// ---------- tabs ----------
function setTab(tab) {
  const chat = tab === 'chat';
  $('chatPanel').classList.toggle('hidden', !chat);
  $('chatPanel').classList.toggle('flex', chat);
  $('crewPanel').classList.toggle('hidden', chat);
  $('crewPanel').classList.toggle('flex', !chat);
  $('tabChat').className = 'px-3 py-1.5 rounded-md font-medium transition ' + (chat ? 'bg-slate-700 text-white' : 'text-slate-400');
  $('tabCrew').className = 'px-3 py-1.5 rounded-md font-medium transition ' + (!chat ? 'bg-slate-700 text-white' : 'text-slate-400');
  $('convSection').style.display = chat ? '' : 'none';
  if (!chat) loadCrewHistory();
}

// ---------- wiring ----------
$('tabChat').onclick = () => setTab('chat');
$('tabCrew').onclick = () => setTab('crew');
$('settingsBtn').onclick = openSettings;
$('saveSettingsBtn').onclick = saveSettings;
$('newAgentBtn').onclick = () => openAgentModal(null);
$('editAgentBtn').onclick = () => { const a = currentAgent(); if (a) openAgentModal(a); };
$('saveAgentBtn').onclick = saveAgent;
$('deleteAgentBtn').onclick = deleteAgent;
$('cloneAgentBtn').onclick = async () => {
  if (!state.editingAgentId) return;
  try {
    const copy = await api('/api/agents/' + state.editingAgentId + '/clone', { method: 'POST' });
    $('agentModal').classList.add('hidden');
    await loadAgents();
    selectAgent(copy.id);
    toast('Duplicated as "' + copy.name + '"');
  } catch (err) { toast(err.message); }
};
$('agentTemp').oninput = (e) => { $('tempVal').textContent = e.target.value; };
$('sendBtn').onclick = sendMessage;
$('newChatBtn').onclick = () => { state.currentConvId = null; state.messages = []; renderConvs(); renderMessages(); $('chatInput').focus(); };
if ($('sidebarSearch')) $('sidebarSearch').oninput = (e) => {
  state.search = e.target.value.trim();
  state.searchConvs = null;
  renderAgents(); renderConvs();
  const q = state.search;
  if (q.length >= 2) {
    api('/api/conversations/search?q=' + encodeURIComponent(q)).then((results) => {
      if (state.search !== q) return; // stale
      state.searchConvs = results;
      renderConvs();
    }).catch(() => {});
  }
};
$('crewRunBtn').onclick = runCrew;
$('logoutBtn').onclick = logout;
$('upgradeBtn').onclick = upgradeToPro;
$('authTabLogin').onclick = () => setAuthTab('login');
$('authTabSignup').onclick = () => setAuthTab('signup');
$('forgotLink').onclick = async () => {
  const email = prompt('Enter your account email to receive a reset link:', '');
  if (!email) return;
  try {
    const r = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const j = await r.json();
    toast(j.message || 'Check your email for a reset link.');
  } catch (err) { toast(err.message); }
};
// Log out all other sessions
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'revokeSessionsBtn') return;
  if (!confirm('Log out of this account on all other devices/browsers? This session stays active.')) return;
  try {
    const r = await api('/api/user/sessions/revoke-other', { method: 'POST' });
    toast('Signed out ' + (r.revoked || 0) + ' other session(s).');
  } catch (err) { toast(err.message); }
});

// Export all agents as JSON bundle
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'exportAllAgentsBtn') return;
  try {
    const r = await fetch('/api/agents/export-all', { headers: { Authorization: 'Bearer ' + state.token } });
    if (!r.ok) throw new Error('Export failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agents-export.json'; a.click();
    URL.revokeObjectURL(url);
    toast('All agents exported.');
  } catch (err) { toast(err.message); }
});

// Export current agent as JSON
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'exportAgentBtn') return;
  if (!state.editingAgentId) return;
  try {
    const r = await fetch('/api/agents/' + state.editingAgentId + '/export', { headers: { Authorization: 'Bearer ' + state.token } });
    if (!r.ok) throw new Error('Export failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agent.json'; a.click();
    URL.revokeObjectURL(url);
    toast('Agent exported.');
  } catch (err) { toast(err.message); }
});

// Import agent from JSON file
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'importAgentFile') return;
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const agent = await api('/api/agents/import', { method: 'POST', body: JSON.stringify(data) });
    $('agentModal').classList.add('hidden');
    await loadAgents();
    selectAgent(agent.id);
    toast('Imported "' + agent.name + '"');
  } catch (err) { toast('Import failed: ' + err.message); }
});

// Resend verification email
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'resendVerifyBtn') return;
  try { await api('/api/auth/resend-verification', { method: 'POST' }); toast('Verification email resent.'); }
  catch (err) { toast(err.message); }
});

// Export current conversation as Markdown (fetch with auth → download blob)
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'exportConvBtn') return;
  if (!state.currentConvId) { toast('Start a chat first, then export it.'); return; }
  try {
    const r = await fetch('/api/conversations/' + state.currentConvId + '/export?format=md', { headers: { Authorization: 'Bearer ' + state.token } });
    if (!r.ok) throw new Error('Export failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'conversation.md'; a.click();
    URL.revokeObjectURL(url);
    toast('Conversation exported.');
  } catch (err) { toast(err.message); }
});

// Change email
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'changeEmailBtn') return;
  const newEmail = prompt('Enter your new email address:', '');
  if (!newEmail) return;
  const password = prompt('Enter your current password to confirm:', '');
  if (!password) return;
  try {
    const r = await api('/api/user/email', { method: 'POST', body: JSON.stringify({ newEmail, password }) });
    $('userEmail').textContent = r.email;
    toast('Email updated to ' + r.email);
  } catch (err) { toast(err.message); }
});

// Handle password-reset token from email link: /app?reset=TOKEN
(function handleResetToken() {
  const m = location.search.match(/reset=([^&]+)/);
  if (!m) return;
  const token = m[1];
  const pw = prompt('Enter your new password (min 6 characters):', '');
  if (!pw) return;
  fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: pw }) })
    .then(r => r.json()).then(j => { alert(j.error || j.message); location.search = ''; })
    .catch(err => alert('Reset failed: ' + err.message));
})();

// Keyboard shortcuts: Ctrl/Cmd+K = focus search, Ctrl/Cmd+N = new chat, Esc = close modal
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const s = $('sidebarSearch');
    if (s) { s.focus(); s.select(); }
  } else if (mod && e.key.toLowerCase() === 'n') {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    state.currentConvId = null; state.messages = []; renderConvs(); renderMessages(); $('chatInput')?.focus();
  } else if (e.key === 'Escape') {
    document.querySelectorAll('.modal-close').forEach((b) => { if (!b.closest('.hidden')) b.click(); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
});

// Password strength meter (signup)
(function () {
  function pwScore(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^a-zA-Z0-9]/.test(pw)) s++;
    return s;
  }
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#10b981'];
  const input = $('authPassword');
  if (!input) return;
  input.addEventListener('input', () => {
    const bar = $('pwStrengthBar'), wrap = $('pwStrength');
    if (!input.value) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    const s = pwScore(input.value);
    bar.style.width = ((s + 1) / 6 * 100) + '%';
    bar.style.background = colors[s];
  });
})();
$('authSubmit').onclick = authSubmit;
['authEmail', 'authPassword', 'authName'].forEach((fid) => {
  $(fid).addEventListener('keydown', (e) => { if (e.key === 'Enter') authSubmit(); });
});

$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.querySelectorAll('.modal-close').forEach((b) => {
  b.onclick = () => $(b.dataset.modal).classList.add('hidden');
});
document.querySelectorAll('[id$="Modal"]').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
});

// ---------- init ----------
(async function init() {
  setTab('chat');
  if (state.token) {
    try {
      await afterLogin();
      return;
    } catch {
      // token invalid — fall through to login screen
    }
  }
  showAuth('login');
})();
