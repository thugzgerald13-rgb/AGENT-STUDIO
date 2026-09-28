// OpenAI-compatible streaming chat completion client (uses global fetch, Node >= 18).
// Works with OpenAI, OpenRouter, Groq, Together, local Ollama (/v1), etc.

async function* streamChatCompletion({ baseURL, apiKey, model, messages, temperature = 0.7 }) {
  if (!apiKey) throw new Error('No API key set. Open Settings and add your LLM API key.');
  if (!model) throw new Error('No model selected. Set a default model in Settings or on the agent.');

  const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 600)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // ignore malformed chunk
        }
      }
    }
  }
}

module.exports = { streamChatCompletion };
