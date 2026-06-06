const { config } = require("./configService");
const { httpError } = require("./httpError");
const { getSupabaseClient } = require("./supabaseService");

async function consumeUserDailyQuota(userId) {
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
  };
}

module.exports = { consumeUserDailyQuota };
