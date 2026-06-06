const fs = require("fs");
const path = require("path");

let subjectAnalysisPrompt;

function getSubjectAnalysisPrompt() {
  if (subjectAnalysisPrompt) return subjectAnalysisPrompt;
  subjectAnalysisPrompt = fs.readFileSync(
    path.join(__dirname, "..", "prompts", "subject_analysis_prompt.txt"),
    "utf8"
  );
  return subjectAnalysisPrompt;
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

module.exports = { buildSubjectAnalysisUserPrompt, getSubjectAnalysisPrompt };
