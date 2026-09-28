const { streamChatCompletion } = require('./llm');

// Run a single agent against a message history. Streams tokens via onToken;
// returns the full assistant text when complete.
async function runAgentStream({ agent, history, config, onToken }) {
  const messages = [];
  if (agent.systemPrompt) messages.push({ role: 'system', content: agent.systemPrompt });
  for (const m of history) messages.push({ role: m.role, content: m.content });

  let full = '';
  for await (const delta of streamChatCompletion({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: agent.model || config.defaultModel,
    messages,
    temperature: agent.temperature ?? 0.7,
  })) {
    full += delta;
    if (onToken) onToken(delta);
  }
  return full;
}

module.exports = { runAgentStream };
