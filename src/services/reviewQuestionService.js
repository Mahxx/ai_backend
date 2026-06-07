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
      maxTokens: Math.min(12000, Math.max(2200, count * 850)),
      responseMimeType: "application/json",
    });
    const questions = parseGeneratedQuestions(answer, count);

    success = true;
    return {
      answer,
      questions,
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

function parseGeneratedQuestions(answer, requestedCount) {
  let parsed;
  try {
    parsed = JSON.parse(extractJson(answer));
  } catch (error) {
    throw httpError(
      502,
      "Generation IA invalide. Reessayez avec le meme provider ou un autre provider.",
      error.message
    );
  }

  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions = rawQuestions
    .map((item, index) => normalizeQuestion(item, index))
    .filter(Boolean)
    .slice(0, requestedCount);

  if (questions.length === 0) {
    throw httpError(
      502,
      "Aucune question structuree n'a ete generee. Reessayez."
    );
  }

  return questions;
}

function extractJson(text) {
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeQuestion(item, index) {
  const labels = ["A", "B", "C", "D", "E"];
  const text = String(item?.text || "").trim();
  if (!text) return null;

  const rawChoices = normalizeChoicesInput(item?.choices);
  const choices = Array.isArray(rawChoices)
    ? rawChoices
        .map((choice) => ({
          label: String(choice?.label || "").trim().toUpperCase(),
          text: String(choice?.text || "").trim(),
        }))
        .filter((choice) => labels.includes(choice.label) && choice.text)
    : [];

  const uniqueChoices = labels
    .map((label) => choices.find((choice) => choice.label === label))
    .filter(Boolean);
  if (uniqueChoices.length !== 5) return null;

  const rawCorrectAnswers = normalizeCorrectAnswersInput(
    item?.correctAnswers || item?.answer || item?.answers
  );
  const correctAnswers = Array.isArray(rawCorrectAnswers)
    ? rawCorrectAnswers
        .map((label) => String(label).trim().toUpperCase())
        .filter((label) => labels.includes(label))
    : [];
  const uniqueCorrectAnswers = [...new Set(correctAnswers)];
  if (uniqueCorrectAnswers.length === 0) return null;

  return {
    id: String(item?.id || `q${index + 1}`),
    type: uniqueCorrectAnswers.length > 1 ? "QRM" : "QCM",
    text,
    choices: uniqueChoices,
    correctAnswers: uniqueCorrectAnswers,
    explanation: String(item?.explanation || "").trim(),
    trap: String(item?.trap || "").trim(),
    source: String(item?.source || "").trim(),
  };
}

function normalizeChoicesInput(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return ["A", "B", "C", "D", "E"].map((label) => ({
    label,
    text: value[label] || value[label.toLowerCase()] || "",
  }));
}

function normalizeCorrectAnswersInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(/[,;|\s]+/)
    .map((label) => label.trim())
    .filter(Boolean);
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
