// Stripe billing integration. Requires STRIPE_SECRET_KEY and STRIPE_PRICE_ID
// env vars in production; when missing, billing routes return a clear 503 so
// the app still runs in dev. Webhook sets user.tier on successful payment.
const { stores } = require('./store');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Lazy-require so the app boots without Stripe installed/keys.
  const Stripe = require('stripe');
  return new Stripe(key);
}

function configured() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

async function createCheckoutSession({ user, baseUrl }) {
  const stripe = getStripe();
  if (!stripe || !configured()) throw new Error('Billing is not configured on this server (set STRIPE_SECRET_KEY and STRIPE_PRICE_ID).');

  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
    user.stripeCustomerId = customer.id;
    stores.users.save();
  }

  const session = await stripe.checkout.sessions.create({
    customer: user.stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${baseUrl}/?upgrade=success`,
    cancel_url: `${baseUrl}/?upgrade=cancelled`,
    client_reference_id: user.id,
    metadata: { userId: user.id },
  });
  return { url: session.url, sessionId: session.id };
}

async function createPortalSession({ user, baseUrl }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Billing is not configured on this server.');
  if (!user.stripeCustomerId) throw new Error('No billing account yet — upgrade first.');
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${baseUrl}/`,
  });
  return { url: portal.url };
}

// Verify + process a Stripe webhook payload. Returns { handled, userId?, tier?, eventType }.
async function handleWebhook(rawBody, signature) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) throw new Error('Webhook not configured.');
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  let userId = event.data?.object?.metadata?.userId
    || event.data?.object?.client_reference_id
    || event.data?.object?.metadata?.user_id;

  // Resolve via customer if needed.
  const customerId = event.data?.object?.customer;
  if (!userId && customerId) {
    const u = stores.users.load().find((x) => x.stripeCustomerId === customerId);
    if (u) userId = u.id;
  }
  if (!userId) return { handled: false, reason: 'no user on event', eventType: event.type };

  const user = stores.users.load().find((u) => u.id === userId);
  if (!user) return { handled: false, reason: 'user not found', eventType: event.type };

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.updated':
    case 'invoice.paid': {
      const status = event.data?.object?.subscription?.status || event.data?.object?.status;
      user.tier = (status === 'canceled' || status === 'incomplete_expired') ? 'free' : 'pro';
      user.stripeSubscriptionId = event.data?.object?.subscription || user.stripeSubscriptionId || event.data?.object?.id;
      break;
    }
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed':
      user.tier = 'free';
      break;
    default:
      return { handled: false, eventType: event.type, userId };
  }
  stores.users.save();
  return { handled: true, eventType: event.type, userId, tier: user.tier };
}

module.exports = { configured, createCheckoutSession, createPortalSession, handleWebhook };
