const {
  encryptSecret,
  decryptSecret,
  maskSecret,
} = require("./encryptionService");
const { httpError } = require("./httpError");
const {
  defaultModel,
  normalizeProvider,
  testApiKey: testProviderApiKey,
} = require("./llmProviderService");
const { getSupabaseClient } = require("./supabaseService");
const { ensureUser } = require("./userService");

async function testApiKey({ userId, email, fullName, provider, apiKey, model }) {
  await ensureUser({ userId, email, fullName });
  const normalizedProvider = normalizeProvider(provider);
  const selectedModel = model || defaultModel(normalizedProvider);
  await testProviderApiKey({
    provider: normalizedProvider,
    apiKey,
    model: selectedModel,
  });
  return {
    valid: true,
    provider: normalizedProvider,
    model: selectedModel,
    keyMask: maskSecret(apiKey),
  };
}

async function saveApiKey({ userId, email, fullName, provider, apiKey, model }) {
  const testResult = await testApiKey({
    userId,
    email,
    fullName,
    provider,
    apiKey,
    model,
  });

  const supabase = getSupabaseClient();
  const encrypted = encryptSecret(apiKey);
  const { error } = await supabase.from("user_ai_keys").upsert(
    {
      user_id: userId,
      provider: testResult.provider,
      model: testResult.model,
      encrypted_api_key: encrypted,
      key_mask: testResult.keyMask,
      active: true,
      tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    throw httpError(500, "Sauvegarde de la cle IA impossible.", error.message);
  }

  return testResult;
}

async function deleteApiKey({ userId, provider }) {
  const normalizedProvider = normalizeProvider(provider);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("user_ai_keys")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", normalizedProvider);

  if (error) {
    throw httpError(500, "Suppression de la cle IA impossible.", error.message);
  }

  return { success: true };
}

async function getKeyStatuses(userId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_ai_keys")
    .select("provider,model,key_mask,active,tested_at,updated_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    throw httpError(500, "Lecture des cles IA impossible.", error.message);
  }

  return data || [];
}

async function getDecryptedApiKey({ userId, provider }) {
  const normalizedProvider = normalizeProvider(provider);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_ai_keys")
    .select("provider,model,encrypted_api_key,active")
    .eq("user_id", userId)
    .eq("provider", normalizedProvider)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw httpError(500, "Lecture de la cle IA impossible.", error.message);
  }
  if (!data) {
    throw httpError(
      400,
      "Aucune cle API configuree pour ce provider. Ouvrez Parametres IA."
    );
  }

  return {
    provider: normalizedProvider,
    model: data.model || defaultModel(normalizedProvider),
    apiKey: decryptSecret(data.encrypted_api_key),
  };
}

module.exports = {
  deleteApiKey,
  getDecryptedApiKey,
  getKeyStatuses,
  saveApiKey,
  testApiKey,
};
