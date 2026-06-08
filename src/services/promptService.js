const fs = require("fs");
const path = require("path");

let subjectAnalysisPrompt;
let reviewQuestionsPrompt;
let courseChatPrompt;

function getSubjectAnalysisPrompt() {
  if (subjectAnalysisPrompt) return subjectAnalysisPrompt;
  subjectAnalysisPrompt = fs.readFileSync(
    path.join(__dirname, "..", "prompts", "subject_analysis_prompt.txt"),
    "utf8"
  );
  return subjectAnalysisPrompt;
}

function getReviewQuestionsPrompt() {
  if (reviewQuestionsPrompt) return reviewQuestionsPrompt;
  reviewQuestionsPrompt = fs.readFileSync(
    path.join(__dirname, "..", "prompts", "review_questions_prompt.txt"),
    "utf8"
  );
  return reviewQuestionsPrompt;
}

function getCourseChatPrompt() {
  if (courseChatPrompt) return courseChatPrompt;
  courseChatPrompt = fs.readFileSync(
    path.join(__dirname, "..", "prompts", "course_chat_prompt.txt"),
    "utf8"
  );
  return courseChatPrompt;
}

function buildSubjectAnalysisUserPrompt({ subjectText, selectedChunks }) {
  return `Voici le sujet a analyser:

${subjectText}

Chunks de cours utilises:
${selectedChunks
  .map(
    (chunk) =>
      `- ${chunk.courseId} / chunk ${chunk.chunkIndex} (${chunk.storagePath})`
  )
  .join("\n")}

Analyse le sujet selon la structure obligatoire du prompt systeme.`;
}

function buildReviewQuestionsUserPrompt({
  studyYear,
  moduleId,
  questionCount,
  selectedChunks,
}) {
  return `Parametres de generation:
- Annee d'etude: ${studyYear || "non precisee"}
- Module: ${moduleId}
- Nombre de questions demande: ${questionCount}
- Niveau: tres difficile

Chunks de cours utilises:
${selectedChunks
  .map(
    (chunk) =>
      `- ${chunk.courseId} / chunk ${chunk.chunkIndex} (${chunk.storagePath})`
  )
  .join("\n")}

Genere les questions selon la structure obligatoire du prompt systeme.`;
}

function buildCourseChatUserPrompt({
  studyYear,
  moduleId,
  question,
  history,
  selectedChunks,
}) {
  const historyBlock = formatHistory(history);
  return `Parametres:
- Annee d'etude: ${studyYear || "non precisee"}
- Module: ${moduleId}

${historyBlock ? `Discussion recente non sauvegardee:\n${historyBlock}\n\n` : ""}Question actuelle de l'etudiant:
${question}

Chunks de cours utilises:
${selectedChunks
  .map(
    (chunk) =>
      `- ${chunk.courseId} / chunk ${chunk.chunkIndex} (${chunk.storagePath})`
  )
  .join("\n")}

Reponds uniquement a la question actuelle, en tenant compte de la discussion recente si elle aide a comprendre le contexte.`;
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .slice(-6)
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "Etudiant";
      const content = (message.content || "").toString().trim();
      return content ? `${role}: ${content.slice(0, 1200)}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  buildCourseChatUserPrompt,
  buildReviewQuestionsUserPrompt,
  buildSubjectAnalysisUserPrompt,
  getCourseChatPrompt,
  getReviewQuestionsPrompt,
  getSubjectAnalysisPrompt,
};
