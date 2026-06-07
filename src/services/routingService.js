const { config } = require("./configService");
const { httpError } = require("./httpError");
const { getSupabaseClient } = require("./supabaseService");

async function selectBackend() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("reserve_ai_backend");

  if (error) {
    console.warn("reserve_ai_backend failed, using current backend:", error.message);
    return currentBackendFallback();
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.backend_id || !row?.url) {
    return currentBackendFallback();
  }

  return {
    backendId: row.backend_id,
    url: row.url,
    reserved: true,
  };
}

function currentBackendFallback() {
  return {
    backendId: "",
    url: config.backendPublicUrl,
    reserved: false,
  };
}

async function releaseBackend(backendId, success, countUsage = true) {
  if (!backendId) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("release_ai_backend", {
    p_backend_id: backendId,
    p_success: Boolean(success),
    p_count_usage: Boolean(countUsage),
  });

  if (error) {
    // Do not hide the original analysis result because release failed.
    console.warn("release_ai_backend failed:", error.message);
  }
}

async function getBackendHealth() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backend_servers")
    .select("id,status,current_concurrent,daily_limit,max_concurrent")
    .eq("id", config.backendId)
    .maybeSingle();

  if (error) {
    throw httpError(500, "Lecture health backend impossible.", error.message);
  }

  const { data: usage, error: usageError } = await supabase
    .from("backend_daily_usage")
    .select("used,success,failed,limit")
    .eq("backend_id", config.backendId)
    .eq("day", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  if (usageError) {
    throw httpError(500, "Lecture usage backend impossible.", usageError.message);
  }

  return {
    backendId: config.backendId,
    backendType: config.backendType,
    status: data?.status || "local",
    currentConcurrent: data?.current_concurrent || 0,
    maxConcurrent: data?.max_concurrent || null,
    dailyUsage: usage?.used || 0,
    dailyLimit: usage?.limit || data?.daily_limit || null,
    success: usage?.success || 0,
    failed: usage?.failed || 0,
  };
}

module.exports = { selectBackend, releaseBackend, getBackendHealth };
