// Transactional email. If SMTP_* env vars are set, sends real email via
// nodemailer; otherwise logs to console (dev mode) so the app never breaks.
const nodemailer = require('nodemailer');

const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transporter = null;
if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.SMTP_FROM || 'Agent Studio <no-reply@agentstudio.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function send(to, subject, html) {
  if (!configured) {
    console.log(`[mailer:dev] To: ${to} | Subject: ${subject}`);
    console.log(`[mailer:dev] ${html.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
    return { delivered: false, mode: 'dev' };
  }
  await transporter.sendMail({ from: FROM, to, subject, html });
  return { delivered: true };
}

function sendWelcome(user) {
  return send(user.email, 'Welcome to Agent Studio',
    `<p>Hi ${user.name},</p><p>Your Agent Studio account is ready. Build your first agent here: <a href="${APP_URL}/app">${APP_URL}/app</a></p>`);
}

function sendQuotaWarning(user, remaining, limit) {
  return send(user.email, 'Agent Studio — 80% of daily quota used',
    `<p>Hi ${user.name},</p><p>You've used ${limit - remaining} of ${limit} requests today. You have ${remaining} left. Quota resets tomorrow, or <a href="${APP_URL}/app">upgrade to Pro</a> for more.</p>`);
}

function sendQuotaExhausted(user) {
  return send(user.email, 'Agent Studio — daily quota exhausted',
    `<p>Hi ${user.name},</p><p>You've reached your daily request limit. It resets automatically tomorrow. <a href="${APP_URL}/app">Upgrade to Pro</a> for a much higher limit.</p>`);
}

function sendReceipt(user, amount) {
  return send(user.email, 'Agent Studio — payment receipt',
    `<p>Hi ${user.name},</p><p>Thanks for your payment of $${(amount / 100).toFixed(2)}. Your Pro subscription is active.</p>`);
}

function sendPasswordReset(email, link) {
  return send(email, 'Reset your Agent Studio password', `Hi,<br>Click here to reset your password (valid for 1 hour):<br><a href="${link}">${link}</a><br>If you didn't request this, ignore this email.`);
}

function sendEmailVerify(email, link) {
  return send(email, 'Verify your Agent Studio email', `Hi,<br>Click here to verify your email address:<br><a href="${link}">${link}</a><br>This link expires in 24 hours. If you didn't sign up, ignore this email.`);
}

module.exports = { configured, sendWelcome, sendQuotaWarning, sendQuotaExhausted, sendReceipt, sendPasswordReset, sendEmailVerify };
