"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBatch = createBatch;
exports.insertKeywords = insertKeywords;
exports.listRecentBatches = listRecentBatches;
exports.countKeywords = countKeywords;
exports.fetchKeywordsPreview = fetchKeywordsPreview;
exports.fetchAllKeywords = fetchAllKeywords;
const supabase_js_1 = require("@supabase/supabase-js");

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return (0, supabase_js_1.createClient)(url, key, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'slackbot/pgvector' } },
  });
}

async function createBatch(slackUserId, channelId) {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.from('batches').insert({ slack_user_id: slackUserId, channel_id: channelId }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function insertKeywords(batchId, rows) {
  const client = getClient();
  if (!client) return { inserted: 0 };
  if (!rows || rows.length === 0) return { inserted: 0 };
  const payload = rows.map((r) => ({ batch_id: batchId, cleaned: r.cleaned, embedding: r.embedding }));
  const { error, count } = await client.from('keywords').insert(payload, { count: 'exact' });
  if (error) throw error;
  return { inserted: count || payload.length };
}

async function listRecentBatches(slackUserId, limit = 10) {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('batches')
    .select('id, channel_id, created_at')
    .eq('slack_user_id', slackUserId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function countKeywords(batchId) {
  const client = getClient();
  if (!client) return 0;
  const { count, error } = await client
    .from('keywords')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId);
  if (error) throw error;
  return count || 0;
}

async function fetchKeywordsPreview(batchId, limit = 4) {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('keywords')
    .select('cleaned')
    .eq('batch_id', batchId)
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.cleaned);
}

async function fetchAllKeywords(batchId) {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('keywords')
    .select('cleaned')
    .eq('batch_id', batchId);
  if (error) throw error;
  return (data || []).map((r) => r.cleaned);
}


