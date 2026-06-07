const { config } = require("./configService");
const { httpError } = require("./httpError");

const PROVIDER_DEFAULTS = {
  openai: {
    label: "OpenAI",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
  },
  deepseek: {
    label: "DeepSeek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  },
  grok: {
    label: "xAI Grok",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
  },
  groqcloud: {
    label: "GroqCloud",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  openrouter: {
    label: "OpenRouter Free",
    model: "openrouter/free",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  gemini: {
    label: "Google Gemini",
    model: "gemini-3.5-flash",
  },
  anthropic: {
    label: "Anthropic Claude",
    model: "claude-sonnet-4-20250514",
  },
};

function normalizeProvider(provider) {
  const normalized = (provider || "").toString().trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  if (normalized === "groq") return "groqcloud";
  return normalized;
}

function defaultModel(provider) {
  return PROVIDER_DEFAULTS[normalizeProvider(provider)]?.model || "";
}

function enabledProviderIds() {
  const configured =
    process.env.ENABLED_AI_PROVIDERS || "gemini,groqcloud,openrouter";
  return configured
    .split(",")
    .map((provider) => normalizeProvider(provider))
    .filter((provider) => PROVIDER_DEFAULTS[provider]);
}

function enabledProviderOptions() {
  const links = providerLinks();
  return enabledProviderIds().map((id) => ({
    id,
    label: PROVIDER_DEFAULTS[id].label,
    defaultModel: PROVIDER_DEFAULTS[id].model,
    keyUrl: links[id],
  }));
}

function providerLinks() {
  return {
    openai: "https://platform.openai.com/api-keys",
    anthropic: "https://console.anthropic.com/settings/keys",
    gemini: "https://aistudio.google.com/app/apikey",
    grok: "https://console.x.ai/",
    groqcloud: "https://console.groq.com/keys",
    openrouter: "https://openrouter.ai/settings/keys",
    deepseek: "https://platform.deepseek.com/api_keys",
  };
}

async function testApiKey({ provider, apiKey, model }) {
  const answer = await sendMessage({
    provider,
    apiKey,
    model,
    systemPrompt: "Tu verifies seulement que la cle API fonctionne.",
    userPrompt: "Reponds uniquement: OK",
    context: "",
    maxTokens: 16,
  });
  return { valid: Boolean(answer), provider: normalizeProvider(provider) };
}

async function sendMessage({
  provider,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  context,
  maxTokens = 4096,
}) {
  const normalizedProvider = normalizeProvider(provider);
  const selectedModel = model || defaultModel(normalizedProvider);

  if (!enabledProviderIds().includes(normalizedProvider)) {
    throw httpError(
      400,
      "Ce fournisseur IA est desactive. Utilisez Gemini pour le mode gratuit."
    );
  }
  if (!apiKey) {
    throw httpError(400, "Cle API manquante.");
  }
  if (!selectedModel) {
    throw httpError(400, "Modele IA manquant.");
  }

  switch (normalizedProvider) {
    case "openai":
      return callOpenAICompatible({
        provider: normalizedProvider,
        apiKey,
        baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "deepseek":
      return callOpenAICompatible({
        provider: normalizedProvider,
        apiKey,
        baseUrl: PROVIDER_DEFAULTS.deepseek.baseUrl,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "grok":
      return callOpenAICompatible({
        provider: normalizedProvider,
        apiKey,
        baseUrl: PROVIDER_DEFAULTS.grok.baseUrl,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "groqcloud":
      return callOpenAICompatible({
        provider: normalizedProvider,
        apiKey,
        baseUrl: PROVIDER_DEFAULTS.groqcloud.baseUrl,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "openrouter":
      return callOpenAICompatible({
        provider: normalizedProvider,
        apiKey,
        baseUrl: PROVIDER_DEFAULTS.openrouter.baseUrl,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "gemini":
      return callGemini({
        apiKey,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    case "anthropic":
      return callAnthropic({
        apiKey,
        model: selectedModel,
        systemPrompt,
        userPrompt,
        context,
        maxTokens,
      });
    default:
      throw httpError(400, "Provider IA inconnu.");
  }
}

async function callOpenAICompatible({
  provider,
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  context,
  maxTokens,
}) {
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserContent(userPrompt, context) },
        ],
      }),
    }
  );
  const data = await readJsonResponse(response, provider);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callGemini({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  context,
  maxTokens,
}) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: buildUserContent(userPrompt, context) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
    }),
  });
  const data = await readJsonResponse(response, "gemini");
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
}

async function callAnthropic({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  context,
  maxTokens,
}) {
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: buildUserContent(userPrompt, context) }],
    }),
  });
  const data = await readJsonResponse(response, "anthropic");
  return data.content?.map((item) => item.text || "").join("").trim() || "";
}

function buildUserContent(userPrompt, context) {
  return `${userPrompt}\n\nCONTEXTE COURS:\n${context}`;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, provider) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data.error?.message ||
      data.message ||
      `Erreur provider ${provider}: HTTP ${response.status}`;
    throw httpError(
      response.status >= 500 ? 502 : response.status,
      providerPublicMessage(provider, response.status, message),
      message
    );
  }

  return data;
}

function providerPublicMessage(provider, status, detail) {
  const cleanProvider = providerLabel(provider);
  const normalizedDetail = (detail || "").toLowerCase();

  if (status === 401 || status === 403) {
    return `${cleanProvider}: cle API invalide ou sans permission.`;
  }
  if (status === 404 || normalizedDetail.includes("model")) {
    return `${cleanProvider}: modele IA introuvable ou non autorise pour cette cle.`;
  }
  if (
    status === 429 ||
    normalizedDetail.includes("quota") ||
    normalizedDetail.includes("billing") ||
    normalizedDetail.includes("credit") ||
    normalizedDetail.includes("insufficient")
  ) {
    return `${cleanProvider}: quota depasse, limite atteinte ou compte sans credits API.`;
  }
  if (status >= 500) {
    return `${cleanProvider}: service IA indisponible pour le moment.`;
  }
  return `${cleanProvider}: requete refusee. Verifiez la cle API et le modele.`;
}

function providerLabel(provider) {
  return PROVIDER_DEFAULTS[normalizeProvider(provider)]?.label || provider;
}

module.exports = {
  PROVIDER_DEFAULTS,
  defaultModel,
  enabledProviderIds,
  enabledProviderOptions,
  normalizeProvider,
  providerLinks,
  sendMessage,
  testApiKey,
};
