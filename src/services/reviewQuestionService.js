const { config } = require("./configService");
const { buildCourseContext } = require("./courseRetrievalService");
const { getDecryptedApiKey } = require("./apiKeyService");
const { httpError } = require("./httpError");
const { sendMessage, normalizeProvider } = require("./llmProviderService");
const {
  buildReviewQuestionsUserPrompt,
  getReviewQuestionsPrompt,
} = require("./promptService");
const { consumeUserDailyQuota } = require("./quotaService");
const { releaseBackend } = require("./routingService");
const { ensureUser } = require("./userService");

async function generateReviewQuestions({
  userId,
  email,
  fullName,
  studyYear,
  moduleId,
  questionCount,
  provider,
  model,
  reservedBackendId,
}) {
  let success = false;
  let countBackendUsage = false;
  const backendIdToRelease = reservedBackendId || null;

  try {
    const count = normalizeQuestionCount(questionCount);
    validateInput({ userId, moduleId, provider });
    await ensureUser({ userId, email, fullName });

    const normalizedProvider = normalizeProvider(provider);
    const key = await getDecryptedApiKey({
      userId,
      provider: normalizedProvider,
    });
    const quota = await consumeUserDailyQuota(userId);
    const selectionText = [
      studyYear ? `Annee d'etude: ${studyYear}` : "",
      `Module: ${moduleId}`,
      `Objectif: generer ${count} questions de revision tres difficiles.`,
    ]
      .filter(Boolean)
      .join("\n");

    const courses = await buildCourseContext({
      moduleId,
      courseIds: [],
      subjectText: selectionText,
    });

    countBackendUsage = true;
    const answer = await sendMessage({
      provider: normalizedProvider,
      apiKey: key.apiKey,
      model: model || key.model,
      systemPrompt: getReviewQuestionsPrompt(),
      userPrompt: buildReviewQuestionsUserPrompt({
        studyYear,
        moduleId,
        questionCount: count,
        selectedChunks: courses.selectedChunks,
      }),
      context: courses.context,
      maxTokens: Math.min(4096, Math.max(1400, count * 650)),
    });

    success = true;
    return {
      answer,
      provider: normalizedProvider,
      model: model || key.model,
      quota,
      selectedChunks: courses.selectedChunks,
      stats: {
        questionCount: count,
        courseContextCharacters: courses.context.length,
      },
    };
  } finally {
    if (backendIdToRelease) {
      await releaseBackend(backendIdToRelease, success, countBackendUsage);
    }
  }
}

function validateInput({ userId, moduleId, provider }) {
  if (!userId) throw httpError(400, "Utilisateur manquant.");
  if (!moduleId) throw httpError(400, "Module obligatoire.");
  if (!provider) throw httpError(400, "Provider IA obligatoire.");
}

function normalizeQuestionCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(20, Math.max(1, Math.floor(parsed)));
}

module.exports = { generateReviewQuestions };
