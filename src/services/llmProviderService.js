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
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
  },
  grok: {
    label: "xAI Grok",
    model: "grok-2-latest",
    baseUrl: "https://api.x.ai/v1",
  },
  gemini: {
    label: "Google Gemini",
    model: "gemini-2.5-flash",
  },
  anthropic: {
    label: "Anthropic Claude",
    model: "claude-3-5-sonnet-latest",
  },
};

function normalizeProvider(provider) {
  const normalized = (provider || "").toString().trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  return normalized;
}

function defaultModel(provider) {
  return PROVIDER_DEFAULTS[normalizeProvider(provider)]?.model || "";
}

function providerLinks() {
  return {
    openai: "https://platform.openai.com/api-keys",
    anthropic: "https://console.anthropic.com/settings/keys",
    gemini: "https://aistudio.google.com/app/apikey",
    grok: "https://console.x.ai/",
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
      `Provider ${provider} indisponible ou cle invalide.`,
      message
    );
  }

  return data;
}

module.exports = {
  PROVIDER_DEFAULTS,
  defaultModel,
  normalizeProvider,
  providerLinks,
  sendMessage,
  testApiKey,
};
