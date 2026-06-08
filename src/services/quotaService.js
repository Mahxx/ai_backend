const { config } = require("./configService");
const { httpError } = require("./httpError");
const { getSupabaseClient } = require("./supabaseService");

async function consumeUserDailyQuota(userId) {
  validateUserId(userId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("consume_user_daily_quota", {
    p_user_id: userId,
    p_daily_limit: config.userDailyLimit,
  });

  if (error) {
    throw httpError(500, "Verification du quota impossible.", error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    throw httpError(
      429,
      `Quota IA depasse. Limite: ${row?.daily_limit || config.userDailyLimit} analyses par jour.`
    );
  }

  return {
    used: row.used,
    dailyLimit: row.daily_limit,
    remaining: Math.max(Number(row.daily_limit || 0) - Number(row.used || 0), 0),
  };
}

async function getUserDailyQuota(userId) {
  validateUserId(userId);
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("user_daily_usage")
    .select("used,daily_limit")
    .eq("user_id", userId)
    .eq("day", today)
    .maybeSingle();

  if (error) {
    throw httpError(500, "Lecture du quota impossible.", error.message);
  }

  const dailyLimit = Number(data?.daily_limit || config.userDailyLimit);
  const used = Math.min(Number(data?.used || 0), dailyLimit);
  return {
    used,
    dailyLimit,
    remaining: Math.max(dailyLimit - used, 0),
  };
}

function validateUserId(userId) {
  if (!userId) {
    throw httpError(400, "Utilisateur manquant.");
  }
}

module.exports = { consumeUserDailyQuota, getUserDailyQuota };
