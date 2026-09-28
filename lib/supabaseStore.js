// Supabase-backed store — drop-in replacement for lib/store.js JsonStore.
// Same interface: .load() → array, .cache, .save() → upsert.
// Set SUPABASE_URL + SUPABASE_SERVICE_KEY in env to activate.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function id() { return crypto.randomBytes(8).toString('hex'); }

let _client = null;
function client() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

class SupabaseStore {
  constructor(name) { this.name = name; this.cache = null; }

  async load() {
    if (this.cache) return this.cache;
    const { data, error } = await client()
      .from('app_data').select('data').eq('store', this.name);
    if (error) throw error;
    this.cache = (data || []).map((r) => r.data);
    return this.cache;
  }

  async save() {
    if (!this.cache) return;
    const rows = this.cache.map((item) => ({
      store: this.name,
      id: item.id || id(),
      data: item,
    }));
    // Upsert all; rows no longer in cache are deleted (full sync)
    const ids = rows.map((r) => r.id);
    const supabase = client();
    if (rows.length) {
      const { error: e1 } = await supabase.from('app_data').upsert(rows, { onConflict: 'store,id' });
      if (e1) throw e1;
    }
    const { error: e2 } = await supabase.from('app_data')
      .delete().eq('store', this.name).not('id', 'in', `(${ids.join(',')})`);
    if (e2 && ids.length) throw e2;
  }
}

function createStores() {
  return {
    config: new SupabaseStore('config'),
    agents: new SupabaseStore('agents'),
    conversations: new SupabaseStore('conversations'),
    crewRuns: new SupabaseStore('crewRuns'),
    users: new SupabaseStore('users'),
    usage: new SupabaseStore('usage'),
    apiKeys: new SupabaseStore('apiKeys'),
  };
}

module.exports = { createStores, id, client };
