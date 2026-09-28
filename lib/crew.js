const { runAgentStream } = require('./agent');

// Multi-agent "Crew" orchestration.
// The selected agents speak in order for `rounds` rounds. Each agent sees the
// original task plus every previous response (as one user message, so role
// alternation is preserved and every OpenAI-compatible endpoint accepts it).
async function runCrew({ agents, task, rounds, config, onEvent }) {
  const outputs = []; // { agentId, name, round, content }

  for (let r = 1; r <= rounds; r++) {
    for (const agent of agents) {
      onEvent({ type: 'agent_start', agentId: agent.id, name: agent.name, round: r });

      const prior = outputs
        .map((o) => `--- ${o.name} (round ${o.round}) ---\n${o.content}`)
        .join('\n\n');
      const userContent = prior
        ? `${task}\n\n=== Previous responses ===\n${prior}`
        : task;

      const content = await runAgentStream({
        agent,
        history: [{ role: 'user', content: userContent }],
        config,
        onToken: (delta) => onEvent({ type: 'token', agentId: agent.id, delta }),
      });

      outputs.push({ agentId: agent.id, name: agent.name, round: r, content });
      onEvent({ type: 'agent_end', agentId: agent.id, name: agent.name, round: r, content });
    }
  }

  onEvent({ type: 'done', outputs });
  return outputs;
}

module.exports = { runCrew };
