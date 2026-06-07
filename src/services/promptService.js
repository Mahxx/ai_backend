const fs = require("fs");
const path = require("path");

let subjectAnalysisPrompt;
let reviewQuestionsPrompt;

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

module.exports = {
  buildReviewQuestionsUserPrompt,
  buildSubjectAnalysisUserPrompt,
  getReviewQuestionsPrompt,
  getSubjectAnalysisPrompt,
};
