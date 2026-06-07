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

const REVIEW_QUESTION_PROVIDERS = ["groqcloud", "openrouter"];

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

    const normalizedProvider = normalizeReviewQuestionProvider(provider);
    const key = await getDecryptedApiKey({
      userId,
      provider: normalizedProvider,
    });
    const selectedModel = model || key.model;
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
    const generation = await generateQuestionsWithFallback({
      userId,
      primaryProvider: normalizedProvider,
      primaryApiKey: key.apiKey,
      primaryModel: selectedModel,
      studyYear,
      moduleId,
      courses,
      count,
    });

    success = true;
    return {
      answer: generation.answer,
      questions: generation.questions,
      provider: generation.provider,
      model: generation.model,
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

async function generateQuestionsWithFallback({
  userId,
  primaryProvider,
  primaryApiKey,
  primaryModel,
  studyYear,
  moduleId,
  courses,
  count,
}) {
  const originalError = await tryGenerateWithProvider({
    provider: primaryProvider,
    apiKey: primaryApiKey,
    model: primaryModel,
    studyYear,
    moduleId,
    courses,
    count,
  }).catch((error) => error);

  if (!isError(originalError)) {
    return originalError;
  }

  console.warn("generated_questions_primary_failed", {
    provider: primaryProvider,
    model: primaryModel,
    message: originalError.message,
  });

  for (const fallbackProvider of fallbackProviders(primaryProvider)) {
    try {
      const key = await getDecryptedApiKey({
        userId,
        provider: fallbackProvider,
      });
      return await tryGenerateWithProvider({
        provider: fallbackProvider,
        apiKey: key.apiKey,
        model: key.model,
        studyYear,
        moduleId,
        courses,
        count,
      });
    } catch (error) {
      console.warn("generated_questions_fallback_failed", {
        provider: fallbackProvider,
        message: error.message,
      });
    }
  }

  throw originalError;
}

async function tryGenerateWithProvider({
  provider,
  apiKey,
  model,
  studyYear,
  moduleId,
  courses,
  count,
}) {
  let answer = await sendMessage({
    provider,
    apiKey,
    model,
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
    responseJsonSchema: reviewQuestionsSchema(),
  });
  let questions;
  try {
    questions = parseGeneratedQuestions(answer, count);
  } catch (error) {
    logInvalidGeneration({
      error,
      provider,
      model,
      answer,
    });
    throw error;
  }
  if (questions.length < count) {
    questions = await completeMissingQuestions({
      provider,
      apiKey,
      model,
      studyYear,
      moduleId,
      courses,
      questions,
      targetCount: count,
    });
    answer = JSON.stringify({ questions });
  }

  return { answer, questions, provider, model };
}

async function completeMissingQuestions({
  provider,
  apiKey,
  model,
  studyYear,
  moduleId,
  courses,
  questions,
  targetCount,
}) {
  const completed = [...questions];
  let attempts = 0;

  while (completed.length < targetCount && attempts < targetCount) {
    attempts++;
    const questionIndex = completed.length;
    const answer = await sendMessage({
      provider,
      apiKey,
      model,
      systemPrompt: getSingleReviewQuestionPrompt(),
      userPrompt: `${buildReviewQuestionsUserPrompt({
        studyYear,
        moduleId,
        questionCount: 1,
        selectedChunks: courses.selectedChunks,
      })}

Questions deja generees a ne pas repeter:
${completed.map((question) => `- ${question.text}`).join("\n")}

Genere uniquement la question numero ${questionIndex + 1}.
Retourne uniquement un objet JSON d'une seule question.`,
      context: courses.context,
      maxTokens: 1800,
      responseMimeType: "application/json",
      responseJsonSchema: singleQuestionSchema(),
    });

    try {
      const question = parseSingleQuestion(answer, questionIndex);
      if (!isDuplicateQuestion(completed, question)) {
        completed.push(question);
      }
    } catch (error) {
      logInvalidGeneration({
        error,
        provider,
        model,
        answer,
      });
    }
  }

  if (completed.length < targetCount) {
    console.warn("generated_questions_incomplete", {
      provider,
      model,
      requested: targetCount,
      generated: completed.length,
    });
  }

  return completed.slice(0, targetCount).map((question, index) => ({
    ...question,
    id: `q${index + 1}`,
  }));
}

function parseSingleQuestion(answer, index) {
  const parsed = parseJsonWithLightRepair(extractJson(answer));
  const rawQuestion = Array.isArray(parsed?.questions)
    ? parsed.questions[0]
    : parsed?.question || parsed;
  const question = normalizeQuestion(rawQuestion, index);
  if (!question) {
    throw new Error("Question individuelle invalide.");
  }
  return question;
}

function isDuplicateQuestion(questions, candidate) {
  const normalizedText = normalizeQuestionText(candidate.text);
  return questions.some(
    (question) => normalizeQuestionText(question.text) === normalizedText
  );
}

function normalizeQuestionText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getSingleReviewQuestionPrompt() {
  return `Tu es un expert en pedagogie medicale et en docimologie.

Genere une seule question de revision tres difficile a partir du cours fourni.

Regles obligatoires:
- Utilise uniquement les informations soutenues par le cours.
- La question doit avoir exactement 5 propositions A, B, C, D, E.
- Varie entre QCM et QRM.
- Type "QCM": une seule bonne reponse.
- Type "QRM": 2 ou 3 bonnes reponses.
- L'explication doit etre courte: 1 a 2 phrases.
- Retourne uniquement un JSON valide, sans markdown, sans texte avant ou apres.

Schema:
{
  "id": "q1",
  "type": "QCM",
  "text": "Enonce",
  "choices": [
    {"label": "A", "text": "Proposition A"},
    {"label": "B", "text": "Proposition B"},
    {"label": "C", "text": "Proposition C"},
    {"label": "D", "text": "Proposition D"},
    {"label": "E", "text": "Proposition E"}
  ],
  "correctAnswers": ["A"],
  "explanation": "Explication courte.",
  "trap": "Piege teste.",
  "source": "Concept du cours."
}`;
}

function singleQuestionSchema() {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["QCM", "QRM"] },
      text: { type: "string" },
      choices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", enum: ["A", "B", "C", "D", "E"] },
            text: { type: "string" },
          },
          required: ["label", "text"],
        },
        minItems: 5,
        maxItems: 5,
      },
      correctAnswers: {
        type: "array",
        items: { type: "string", enum: ["A", "B", "C", "D", "E"] },
        minItems: 1,
      },
      explanation: { type: "string" },
      trap: { type: "string" },
      source: { type: "string" },
    },
    required: [
      "id",
      "type",
      "text",
      "choices",
      "correctAnswers",
      "explanation",
      "trap",
      "source",
    ],
  };
}

function fallbackProviders(primaryProvider) {
  return REVIEW_QUESTION_PROVIDERS.filter(
    (provider) => provider !== primaryProvider
  );
}

function isError(value) {
  return value instanceof Error;
}

function reviewQuestionsSchema() {
  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["QCM", "QRM"] },
            text: { type: "string" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", enum: ["A", "B", "C", "D", "E"] },
                  text: { type: "string" },
                },
                required: ["label", "text"],
              },
              minItems: 5,
              maxItems: 5,
            },
            correctAnswers: {
              type: "array",
              items: { type: "string", enum: ["A", "B", "C", "D", "E"] },
              minItems: 1,
            },
            explanation: { type: "string" },
            trap: { type: "string" },
            source: { type: "string" },
          },
          required: [
            "id",
            "type",
            "text",
            "choices",
            "correctAnswers",
            "explanation",
            "trap",
            "source",
          ],
        },
      },
    },
    required: ["questions"],
  };
}

function parseGeneratedQuestions(answer, requestedCount) {
  let parsed;
  try {
    parsed = parseJsonWithLightRepair(extractJson(answer));
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

function parseJsonWithLightRepair(text) {
  const normalized = (text || "").trim().replace(/^\uFEFF/, "");
  try {
    return JSON.parse(normalized);
  } catch (error) {
    const repaired = normalized.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired);
  }
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
  if (uniqueCorrectAnswers.length > 3) return null;

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

function normalizeReviewQuestionProvider(provider) {
  const normalizedProvider = normalizeProvider(provider);
  if (!REVIEW_QUESTION_PROVIDERS.includes(normalizedProvider)) {
    throw httpError(
      400,
      "Questions generees par IA utilise seulement GroqCloud ou OpenRouter. Configurez une cle API pour l'un de ces providers."
    );
  }
  return normalizedProvider;
}

function normalizeQuestionCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(10, Math.max(1, Math.floor(parsed)));
}

function logInvalidGeneration({ error, provider, model, answer }) {
  console.warn("generated_questions_parse_failed", {
    provider,
    model,
    message: error?.message,
    answerLength: answer ? answer.length : 0,
    answerPreview: answer ? answer.slice(0, 800) : "",
  });
}

module.exports = { generateReviewQuestions };
