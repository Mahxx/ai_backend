const { getSupabaseClient } = require("./supabaseService");
const { httpError } = require("./httpError");

async function ensureUser({ userId, email, fullName }) {
  if (!userId) {
    throw httpError(400, "Utilisateur manquant.");
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("users").upsert(
    {
      id: userId,
      email: email || null,
      full_name: fullName || null,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw httpError(500, "Synchronisation utilisateur IA impossible.", error.message);
  }
}

module.exports = { ensureUser };
