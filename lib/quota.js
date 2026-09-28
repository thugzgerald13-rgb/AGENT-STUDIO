// Daily per-user quota enforcement. Usage is keyed by calendar date, so it
// resets automatically the next day — i.e. runs pause when the tier's daily
// quota is exhausted and resume tomorrow with no manual action.
const { stores } = require('./store');
const { TIERS } = require('./tiers');

function today() { return new Date().toISOString().slice(0, 10); }

function nextMidnightUTC() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

function getUsage(userId) {
  const usage = stores.usage.load();
  let u = usage[userId];
  if (!u || u.date !== today()) {
    u = { date: today(), used: 0 }; // reset for a new day
    usage[userId] = u;
    stores.usage.save();
  }
  return u;
}

function checkQuota(userId, tier) {
  const t = TIERS[tier] || TIERS.free;
  const limit = t.dailyRequests;
  const u = getUsage(userId);
  const remaining = Math.max(0, limit - u.used);
  return {
    ok: remaining > 0,
    tier,
    used: u.used,
    limit,
    remaining,
    resetsAt: nextMidnightUTC(),
  };
}

// Consume one request. Returns the updated usage snapshot.
function consumeQuota(userId, tier) {
  const u = getUsage(userId);
  u.used += 1;
  const usage = stores.usage.load();
  usage[userId] = u;
  stores.usage.save();
  return checkQuota(userId, tier);
}

module.exports = { checkQuota, consumeQuota, getUsage };
