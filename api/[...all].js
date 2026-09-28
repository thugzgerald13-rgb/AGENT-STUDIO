// Vercel serverless entry — wraps the Express app.
// Activates Supabase storage when SUPABASE_URL is set.
const app = require('../server.js'); // server.js must `module.exports = app` and guard app.listen
module.exports = (req, res) => app(req, res);
