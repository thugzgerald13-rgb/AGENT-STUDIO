// Multi-user foundation: API-key + email/password auth with session tokens.
// Passwords hashed with Node scrypt (no extra dependencies). Sessions are
// bearer tokens stored on the user; the frontend keeps the token in localStorage.
const crypto = require('crypto');
const { stores, id } = require('./store');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// --- Revocable API keys (for /v1 developer access) ---
function hashKey(key) { return crypto.createHash('sha256').update(key).digest('hex'); }

function createApiKey(user, name) {
  const key = 'sk_live_' + crypto.randomBytes(24).toString('hex');
  const record = {
    id: id(), name: name || 'API Key', prefix: key.slice(0, 14),
    keyHash: hashKey(key), createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false,
  };
  user.apiKeys = user.apiKeys || [];
  user.apiKeys.push(record);
  stores.users.save();
  return { id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt, key }; // full key shown once
}

function listApiKeys(user) {
  return (user.apiKeys || []).filter((k) => !k.revoked)
    .map(({ keyHash, ...rest }) => rest); // never return the hash
}

function revokeApiKey(user, keyId) {
  const k = (user.apiKeys || []).find((x) => x.id === keyId);
  if (!k) return false;
  k.revoked = true;
  stores.users.save();
  return true;
}

function getUserByApiKey(key) {
  if (!key) return null;
  const h = hashKey(key);
  const user = stores.users.load().find((u) => (u.apiKeys || []).some((k) => !k.revoked && k.keyHash === h));
  if (user) {
    const k = user.apiKeys.find((x) => !x.revoked && x.keyHash === h);
    k.lastUsedAt = new Date().toISOString();
    stores.users.save();
  }
  return user || null;
}

// Seed a local developer account so the app is usable out of the box.
function seedDefaultUser() {
  const users = stores.users.load();
  if (users.length > 0) return;
  const { salt, hash } = hashPassword('dev1234');
  stores.users.cache = [{
    id: id(),
    email: 'dev@local',
    name: 'Local Developer',
    passwordSalt: salt,
    passwordHash: hash,
    tier: 'pro',
    apiKey: 'local-dev',
    tokens: [],
    llm: { baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.LLM_API_KEY || '', defaultModel: process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini' },
    createdAt: new Date().toISOString(),
  }];
  stores.users.save();
}

function getUserByKey(apiKey) {
  if (!apiKey) return null;
  return stores.users.load().find((u) => u.apiKey === apiKey) || null;
}

function getUserByToken(token) {
  if (!token) return null;
  return stores.users.load().find((u) => (u.tokens || []).some((t) => t.token === token)) || null;
}

function getUserByEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return stores.users.load().find((u) => (u.email || '').toLowerCase() === e) || null;
}

function getDefaultUser() {
  seedDefaultUser();
  return stores.users.load()[0];
}

function signup({ email, password, name }) {
  email = (email || '').toLowerCase().trim();
  name = (name || '').trim() || email.split('@')[0];
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid email is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (getUserByEmail(email)) throw new Error('An account with this email already exists');

  const { salt, hash } = hashPassword(password);
  const user = {
    id: id(),
    email,
    name,
    passwordSalt: salt,
    passwordHash: hash,
    tier: 'free',
    apiKey: 'usr_' + crypto.randomBytes(12).toString('hex'),
    tokens: [],
    llm: { baseURL: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' },
    createdAt: new Date().toISOString(),
  };
  stores.users.load().push(user);
  stores.users.save();
  return user;
}

function login({ email, password }) {
  const user = getUserByEmail(email);
  if (!user || !user.passwordHash) throw new Error('Invalid email or password');
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) throw new Error('Invalid email or password');
  const token = newToken();
  user.tokens = user.tokens || [];
  user.tokens.push({ token, createdAt: new Date().toISOString() });
  // keep last 10 sessions
  if (user.tokens.length > 10) user.tokens = user.tokens.slice(-10);
  stores.users.save();
  return { token, user };
}

function changePassword(userId, oldPassword, newPassword) {
  const user = stores.users.load().find((u) => u.id === userId);
  if (!user || !user.passwordHash) throw new Error('User not found');
  if (!verifyPassword(oldPassword, user.passwordSalt, user.passwordHash)) throw new Error('Current password is incorrect');
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const { salt, hash } = hashPassword(newPassword);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  stores.users.save();
  return { ok: true };
}

function createPasswordResetToken(email) {
  const user = getUserByEmail(email);
  if (!user) return null; // do not reveal existence
  const raw = newToken() + newToken();
  user.resetTokenHash = hashKey(raw);
  user.resetExpiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  stores.users.save();
  return raw;
}

function resetPasswordByToken(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const hash = hashKey(token);
  const user = stores.users.load().find((u) => u.resetTokenHash === hash);
  if (!user || !user.resetExpiresAt || Date.now() > user.resetExpiresAt) throw new Error('Reset link is invalid or expired.');
  const { salt, hash: pwHash } = hashPassword(newPassword);
  user.passwordSalt = salt;
  user.passwordHash = pwHash;
  user.resetTokenHash = null;
  user.resetExpiresAt = null;
  stores.users.save();
  return { ok: true };
}

function changeEmail(userId, password, newEmail) {
  const user = stores.users.load().find((u) => u.id === userId);
  if (!user || !user.passwordHash) throw new Error('User not found');
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) throw new Error('Current password is incorrect');
  const email = (newEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address');
  if (stores.users.load().some((u) => u.id !== userId && u.email.toLowerCase() === email)) throw new Error('That email is already in use');
  user.email = email;
  stores.users.save();
  return { ok: true, email };
}

function revokeOtherSessions(userId, currentToken) {
  const user = stores.users.load().find((u) => u.id === userId);
  if (!user) return { revoked: 0 };
  const before = (user.tokens || []).length;
  user.tokens = (user.tokens || []).filter((t) => (typeof t === 'string' ? t : t.token) === currentToken);
  stores.users.save();
  return { revoked: Math.max(0, before - user.tokens.length), remaining: user.tokens.length };
}

function logout(token) {
  const user = getUserByToken(token);
  if (!user) return;
  user.tokens = (user.tokens || []).filter((t) => t.token !== token);
  stores.users.save();
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, tier: u.tier, apiKey: u.apiKey, createdAt: u.createdAt };
}

function issueEmailVerifyToken(userId) {
  const user = stores.users.load().find((u) => u.id === userId);
  if (!user) return null;
  const raw = newToken();
  user.emailVerifyTokenHash = hashKey(raw);
  user.emailVerifyExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  user.emailVerified = false;
  stores.users.save();
  return raw;
}

function verifyEmailByToken(token) {
  const hash = hashKey(token);
  const user = stores.users.load().find((u) => u.emailVerifyTokenHash === hash);
  if (!user || !user.emailVerifyExpiresAt || Date.now() > user.emailVerifyExpiresAt) throw new Error('Verification link is invalid or expired.');
  user.emailVerified = true;
  user.emailVerifyTokenHash = null;
  user.emailVerifyExpiresAt = null;
  stores.users.save();
  return { ok: true, email: user.email };
}

module.exports = {
  seedDefaultUser, getUserByKey, getUserByToken, getUserByEmail, getDefaultUser,
  publicUser, signup, login, logout, changePassword, createPasswordResetToken, resetPasswordByToken, revokeOtherSessions, changeEmail, issueEmailVerifyToken, verifyEmailByToken,
  createApiKey, listApiKeys, revokeApiKey, getUserByApiKey,
};
