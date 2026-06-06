const { config } = require("./configService");
const { buildCourseContext } = require("./courseRetrievalService");
const { getDecryptedApiKey } = require("./apiKeyService");
const { httpError } = require("./httpError");
const { sendMessage, normalizeProvider } = require("./llmProviderService");
const {
  buildSubjectAnalysisUserPrompt,
  getSubjectAnalysisPrompt,
} = require("./promptService");
const { consumeUserDailyQuota } = require("./quotaService");
const { releaseBackend } = require("./routingService");
const { getSupabaseClient } = require("./supabaseService");
const { extractSubjectText } = require("./subjectExtractionService");
const { ensureUser } = require("./userService");

async function analyzeSubject({
  userId,
  email,
  fullName,
  moduleId,
  courseIds,
  provider,
  model,
  subjectFile,
  subjectText,
  reservedBackendId,
}) {
  let success = false;
  let countBackendUsage = false;
  const backendIdToRelease = reservedBackendId || null;

  try {
    validateAnalyzeInput({ userId, moduleId, provider });
    await ensureUser({ userId, email, fullName });

    const normalizedProvider = normalizeProvider(provider);
    const subject = await extractSubjectText({ subjectFile, subjectText });
    const key = await getDecryptedApiKey({
      userId,
      provider: normalizedProvider,
    });
    const quota = await consumeUserDailyQuota(userId);
    const courses = await buildCourseContext({
      moduleId,
      courseIds,
      subjectText: subject,
    });

    countBackendUsage = true;
    const answer = await sendMessage({
      provider: normalizedProvider,
      apiKey: key.apiKey,
      model: model || key.model,
      systemPrompt: getSubjectAnalysisPrompt(),
      userPrompt: buildSubjectAnalysisUserPrompt({
        subjectText: subject,
        selectedChunks: courses.selectedChunks,
      }),
      context: courses.context,
    });

    success = true;

    if (config.storeAnalysisHistory) {
      await saveHistory({
        userId,
        moduleId,
        courseIds,
        provider: normalizedProvider,
        model: model || key.model,
        status: "success",
        answer,
      });
    }

    return {
      answer,
      provider: normalizedProvider,
      model: model || key.model,
      quota,
      selectedChunks: courses.selectedChunks,
      stats: {
        subjectCharacters: subject.length,
        courseContextCharacters: courses.context.length,
      },
    };
  } catch (error) {
    if (config.storeAnalysisHistory && userId && moduleId) {
      await saveHistory({
        userId,
        moduleId,
        courseIds,
        provider,
        model,
        status: "failed",
        answer: error.publicMessage || error.message,
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (backendIdToRelease) {
      await releaseBackend(backendIdToRelease, success, countBackendUsage);
    }
  }
}

function validateAnalyzeInput({ userId, moduleId, provider }) {
  if (!userId) throw httpError(400, "Utilisateur manquant.");
  if (!moduleId) throw httpError(400, "Module obligatoire.");
  if (!provider) throw httpError(400, "Provider IA obligatoire.");
}

async function saveHistory({
  userId,
  moduleId,
  courseIds,
  provider,
  model,
  status,
  answer,
}) {
  const supabase = getSupabaseClient();
  await supabase.from("analysis_history").insert({
    user_id: userId,
    module_id: moduleId,
    course_ids: courseIds || [],
    provider,
    model,
    status,
    result_preview: (answer || "").slice(0, 600),
    full_result: status === "success" ? answer : null,
  });
}

module.exports = { analyzeSubject };
