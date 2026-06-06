const DEFAULT_PROVIDER_ORDER = ["openai", "deepseek", "gemini", "anthropic", "grok", "custom"];

async function sendToLLM(prompt, provider = "auto") {
  const providers = provider === "auto" ? configuredProviderOrder() : [provider];
  const triedProviders = [];
  let lastError;

  for (const currentProvider of providers) {
    try {
      const answer = await callProvider(currentProvider, prompt);
      return { answer, provider: currentProvider, triedProviders };
    } catch (err) {
      triedProviders.push({
        provider: currentProvider,
        error: err.publicMessage || err.message,
      });
      lastError = err;
    }
  }

  const error = new Error(lastError?.message || "Aucun provider IA disponible.");
  error.statusCode = 502;
  error.publicMessage =
    "Aucun provider IA n'a repondu. Verifiez les cles API ou reessayez plus tard.";
  throw error;
}

async function summarizeTextInChunks(text, provider = "auto") {
  const chunkSize = Number(process.env.SUMMARY_CHUNK_CHARS || 12000);
  const maxChunks = Number(process.env.SUMMARY_MAX_CHUNKS || 8);
  const chunks = splitText(text, chunkSize).slice(0, maxChunks);
  const summaries = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const summaryPrompt = `Resume ce morceau de cours pour une analyse pedagogique medicale.
Garde les definitions, classifications, tableaux, mots-cles, mecanismes, diagnostics, examens complementaires, traitements et pieges QCM.

Morceau ${i + 1}/${chunks.length}:
${chunks[i]}`;
    const result = await sendToLLM(summaryPrompt, provider);
    summaries.push(`Resume morceau ${i + 1}:\n${result.answer}`);
  }

  if (splitText(text, chunkSize).length > maxChunks) {
    summaries.push(
      "Note: une partie des cours a ete ignoree car le volume depasse la limite configuree."
    );
  }

  return summaries.join("\n\n");
}

function configuredProviderOrder() {
  const configured = (process.env.AI_PROVIDER_ORDER || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_PROVIDER_ORDER;
}

async function callProvider(provider, prompt) {
  switch (provider) {
    case "openai":
      return callOpenAICompatible({
        provider,
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        prompt,
      });
    case "deepseek":
      return callOpenAICompatible({
        provider,
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        prompt,
      });
    case "grok":
      return callOpenAICompatible({
        provider,
        apiKey: process.env.GROK_API_KEY,
        baseUrl: process.env.GROK_BASE_URL || "https://api.x.ai/v1",
        model: process.env.GROK_MODEL || "grok-2-latest",
        prompt,
      });
    case "custom":
      return callOpenAICompatible({
        provider,
        apiKey: process.env.CUSTOM_LLM_API_KEY,
        baseUrl: process.env.CUSTOM_LLM_BASE_URL,
        model: process.env.CUSTOM_LLM_MODEL,
        prompt,
      });
    case "gemini":
      return callGemini(prompt);
    case "anthropic":
    case "claude":
      return callAnthropic(prompt);
    default:
      throw missingProviderError(provider, "Provider IA inconnu.");
  }
}

async function callOpenAICompatible({ provider, apiKey, baseUrl, model, prompt }) {
  if (!apiKey || !baseUrl || !model) {
    throw missingProviderError(provider, "Cle API ou modele manquant.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert en pedagogie medicale, docimologie et analyse de sujets d'examen.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await readJsonResponse(response, provider);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  if (!apiKey) {
    throw missingProviderError("gemini", "Cle API Gemini manquante.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  const data = await readJsonResponse(response, "gemini");
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  if (!apiKey) {
    throw missingProviderError("anthropic", "Cle API Anthropic manquante.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await readJsonResponse(response, "anthropic");
  return data.content?.map((item) => item.text || "").join("").trim() || "";
}

async function readJsonResponse(response, provider) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data.error?.message ||
      data.message ||
      `Erreur provider ${provider}: HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    error.publicMessage = `Provider ${provider} indisponible.`;
    throw error;
  }

  return data;
}

function missingProviderError(provider, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicMessage = `Provider ${provider} non configure.`;
  return error;
}

function splitText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

module.exports = { sendToLLM, summarizeTextInChunks };
