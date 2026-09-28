// Usage metering — records per-request token estimates and cost, keyed by user
// and calendar day. Used for /api/usage/* endpoints and (later) invoice line items.
const { stores } = require('./store');

// Rough estimate: ~4 chars per token for English text.
function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

// Configurable cost per 1M tokens (USD). Override with USAGE_COST_PER_1M env var.
const COST_PER_1M = parseFloat(process.env.USAGE_COST_PER_1M || '2.5');

function record({ userId, type, agentId, prompt, completion }) {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  const tokens = promptTokens + completionTokens;
  const cost = (tokens / 1_000_000) * COST_PER_1M;
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const usage = stores.usage.load();
  if (!usage[userId]) usage[userId] = {};
  if (!usage[userId][day]) usage[userId][day] = { messages: 0, crewRuns: 0, tokens: 0, cost: 0 };
  const bucket = usage[userId][day];
  if (type === 'chat') bucket.messages += 1;
  if (type === 'crew') bucket.crewRuns += 1;
  bucket.tokens += tokens;
  bucket.cost = +(bucket.cost + cost).toFixed(6);
  stores.usage.save();
  return { tokens, cost: +cost.toFixed(6), day };
}

function summary(userId, days = 30) {
  const usage = stores.usage.load();
  const userDays = usage[userId] || {};
  const sorted = Object.entries(userDays).sort((a, b) => b[0].localeCompare(a[0])).slice(0, days);
  const totals = { messages: 0, crewRuns: 0, tokens: 0, cost: 0 };
  const history = sorted.map(([day, b]) => {
    totals.messages += b.messages;
    totals.crewRuns += b.crewRuns;
    totals.tokens += b.tokens;
    totals.cost += b.cost;
    return { day, ...b, cost: +b.cost.toFixed(4) };
  });
  totals.cost = +totals.cost.toFixed(4);
  return { totals, history, costPer1M: COST_PER_1M };
}

module.exports = { record, summary, estimateTokens };
