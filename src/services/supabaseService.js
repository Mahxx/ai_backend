const { createClient } = require("@supabase/supabase-js");
const { httpError } = require("./httpError");

let client;

function getSupabaseClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw httpError(
      500,
      "Configuration Supabase manquante.",
      "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant."
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

async function requireSingle(query, publicMessage) {
  const { data, error } = await query;
  if (error) {
    throw httpError(500, publicMessage, error.message);
  }
  return data;
}

module.exports = { getSupabaseClient, requireSingle };
