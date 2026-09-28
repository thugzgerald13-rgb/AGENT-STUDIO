// Subscription tiers — the commercialization foundation.
// dailyRequests enforces a per-day quota; when exhausted, agent runs pause
// and automatically resume the next day (usage is keyed by calendar date).
const TIERS = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    dailyRequests: 20,
    maxAgents: 3,
    maxCrewRounds: 1,
    maxConcurrentRuns: 1,
    features: ['Up to 3 agents', '1 round crew runs', 'Community support'],
  },
  pro: {
    name: 'Pro',
    priceMonthly: 20,
    dailyRequests: 500,
    maxAgents: 50,
    maxCrewRounds: 5,
    maxConcurrentRuns: 3,
    features: ['Unlimited-feel agents (50)', 'Up to 5 crew rounds', 'All models', 'Priority support'],
  },
  enterprise: {
    name: 'Enterprise',
    priceMonthly: null, // custom
    dailyRequests: 10000,
    maxAgents: 1000,
    maxCrewRounds: 10,
    maxConcurrentRuns: 10,
    features: ['SSO / SAML', 'Dedicated support', 'Custom limits & on-prem', 'Audit logs'],
  },
};

function publicTiers() {
  return Object.entries(TIERS).map(([id, t]) => ({
    id, name: t.name, priceMonthly: t.priceMonthly,
    dailyRequests: t.dailyRequests, maxAgents: t.maxAgents,
    maxCrewRounds: t.maxCrewRounds, features: t.features,
  }));
}

module.exports = { TIERS, publicTiers };
