const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { cleanText } = require("./textCleaner");

async function extractFilesText(files) {
  const extracted = [];
  for (const file of files) {
    const text = await extractOneFile(file);
    extracted.push({
      filename: file.originalname,
      text: cleanText(text),
    });
  }
  return extracted;
}

async function extractOneFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".txt") {
    return file.buffer.toString("utf8");
  }

  if (ext === ".pdf") {
    const parsed = await pdfParse(file.buffer);
    return parsed.text || "";
  }

  if (ext === ".docx") {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return parsed.value || "";
  }

  const err = new Error("Format de fichier non supporte.");
  err.statusCode = 415;
  throw err;
}

module.exports = { extractFilesText };
