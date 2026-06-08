const { buildCourseContext } = require("./courseRetrievalService");
const { getDecryptedApiKey } = require("./apiKeyService");
const { httpError } = require("./httpError");
const { sendMessage, normalizeProvider } = require("./llmProviderService");
const {
  buildCourseChatUserPrompt,
  getCourseChatPrompt,
} = require("./promptService");
const { consumeUserDailyQuota } = require("./quotaService");
const { releaseBackend } = require("./routingService");
const { ensureUser } = require("./userService");

async function askCourseChat({
  userId,
  email,
  fullName,
  studyYear,
  moduleId,
  courseIds,
  question,
  history,
  provider,
  model,
  reservedBackendId,
}) {
  let success = false;
  let countBackendUsage = false;
  const backendIdToRelease = reservedBackendId || null;

  try {
    const cleanQuestion = validateInput({ userId, moduleId, provider, question });
    await ensureUser({ userId, email, fullName });

    const normalizedProvider = normalizeProvider(provider);
    const key = await getDecryptedApiKey({
      userId,
      provider: normalizedProvider,
    });
    const selectedModel = model || key.model;
    const recentHistory = normalizeHistory(history);

    const courses = await buildCourseContext({
      moduleId,
      courseIds: Array.isArray(courseIds) ? courseIds : [],
      subjectText: `${cleanQuestion}\n${recentHistory
        .map((item) => item.content)
        .join("\n")}`,
    });

    const quota = await consumeUserDailyQuota(userId);
    countBackendUsage = true;

    const answer = await sendMessage({
      provider: normalizedProvider,
      apiKey: key.apiKey,
      model: selectedModel,
      systemPrompt: getCourseChatPrompt(),
      userPrompt: buildCourseChatUserPrompt({
        studyYear,
        moduleId,
        question: cleanQuestion,
        history: recentHistory,
        selectedChunks: courses.selectedChunks,
      }),
      context: courses.context,
      maxTokens: 1800,
    });

    success = true;
    return {
      answer,
      provider: normalizedProvider,
      model: selectedModel,
      quota,
      selectedChunks: courses.selectedChunks,
      stats: {
        questionCharacters: cleanQuestion.length,
        courseContextCharacters: courses.context.length,
      },
    };
  } finally {
    if (backendIdToRelease) {
      await releaseBackend(backendIdToRelease, success, countBackendUsage);
    }
  }
}

function validateInput({ userId, moduleId, provider, question }) {
  const cleanQuestion = (question || "").toString().trim();
  if (!userId) throw httpError(400, "Utilisateur manquant.");
  if (!moduleId) throw httpError(400, "Module obligatoire.");
  if (!provider) throw httpError(400, "Provider IA obligatoire.");
  if (!cleanQuestion) throw httpError(400, "Question obligatoire.");
  if (cleanQuestion.length > 2500) {
    throw httpError(413, "Question trop longue. Reduisez le texte.");
  }
  return cleanQuestion;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-6)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: (message?.content || "").toString().trim().slice(0, 1200),
    }))
    .filter((message) => message.content);
}

module.exports = { askCourseChat };
