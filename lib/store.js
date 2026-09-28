// Tiny JSON-file persistence layer. Each collection is one JSON file in ./data.
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

class JsonStore {
  constructor(file, defaultValue) {
    this.file = path.join(dataDir, file);
    this.defaultValue = defaultValue;
    this.cache = null;
  }

  load() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.cache = typeof this.defaultValue === 'function' ? this.defaultValue() : this.defaultValue;
      this.save();
    }
    return this.cache;
  }

  save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const stores = {
  config: new JsonStore('config.json', () => ({
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    defaultModel: process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
  })),
  agents: new JsonStore('agents.json', []),
  conversations: new JsonStore('conversations.json', []),
  crewRuns: new JsonStore('crew-runs.json', []),
  users: new JsonStore('users.json', []),
  usage: new JsonStore('usage.json', {}),
};

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { stores, id };
