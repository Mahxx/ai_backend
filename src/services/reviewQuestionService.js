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
    let answer = await sendMessage({
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
      responseJsonSchema: reviewQuestionsSchema(),
    });
    let questions;
    try {
      questions = parseGeneratedQuestions(answer, count);
    } catch (error) {
      logInvalidGeneration({
        error,
        provider: normalizedProvider,
        model: model || key.model,
        answer,
      });
      if (normalizedProvider !== "gemini") {
        throw error;
      }

      questions = await generateGeminiQuestionsOneByOne({
        apiKey: key.apiKey,
        model: model || key.model,
        studyYear,
        moduleId,
        courses,
        count: Math.min(count, 5),
      });
      answer = JSON.stringify({ questions });
    }

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

async function generateGeminiQuestionsOneByOne({
  apiKey,
  model,
  studyYear,
  moduleId,
  courses,
  count,
}) {
  const questions = [];
  for (let index = 0; index < count; index++) {
    const answer = await sendMessage({
      provider: "gemini",
      apiKey,
      model,
      systemPrompt: getSingleQuestionPrompt(),
      userPrompt: `${buildReviewQuestionsUserPrompt({
        studyYear,
        moduleId,
        questionCount: 1,
        selectedChunks: courses.selectedChunks,
      })}

Genere seulement la question numero ${index + 1}.
Evite de repeter les questions precedentes.
Retourne uniquement l'objet JSON d'une seule question, pas un tableau.`,
      context: courses.context,
      maxTokens: 2200,
      responseMimeType: "application/json",
      responseJsonSchema: singleQuestionSchema(),
    });

    try {
      const question = parseSingleQuestion(answer, index);
      questions.push(question);
    } catch (error) {
      logInvalidGeneration({
        error,
        provider: "gemini",
        model,
        answer,
      });
    }
  }

  if (questions.length === 0) {
    throw httpError(
      502,
      "Generation IA invalide. Reessayez avec GroqCloud ou OpenRouter."
    );
  }

  return questions;
}

function parseSingleQuestion(answer, index) {
  const parsed = parseJsonWithLightRepair(extractJson(answer));
  const rawQuestion = Array.isArray(parsed?.questions)
    ? parsed.questions[0]
    : parsed?.question || parsed;
  const question = normalizeQuestion(rawQuestion, index);
  if (!question) {
    throw new Error("Question individuelle Gemini invalide.");
  }
  return question;
}

function getSingleQuestionPrompt() {
  return `Tu es un expert en pedagogie medicale et en docimologie.

Ta mission est de generer une seule question de revision tres difficile a partir du cours fourni.

Regles:
- Utilise uniquement les informations soutenues par le cours.
- La question doit avoir exactement 5 propositions A, B, C, D, E.
- Une seule bonne reponse donne un type "QCM".
- Plusieurs bonnes reponses donnent un type "QRM".
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
