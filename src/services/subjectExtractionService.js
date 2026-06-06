const { config } = require("./configService");
const { httpError } = require("./httpError");
const { cleanText } = require("./textCleaner");
const { extractFilesText } = require("./textExtractor");

async function extractSubjectText({ subjectFile, subjectText }) {
  let text = cleanText(subjectText || "");

  if (!text && subjectFile) {
    const extracted = await extractFilesText([subjectFile]);
    text = cleanText(extracted.map((item) => item.text).join("\n\n"));
  }

  if (!text) {
    throw httpError(422, "Impossible d'extraire le texte du sujet.");
  }

  if (text.length > config.maxSubjectChars) {
    text = text.slice(0, config.maxSubjectChars);
  }

  return text;
}

module.exports = { extractSubjectText };
