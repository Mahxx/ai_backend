const express = require("express");
const { upload } = require("../services/uploadService");
const { extractFilesText } = require("../services/textExtractor");
const { cleanText } = require("../services/textCleaner");
const { buildPedagogicalPrompt } = require("../services/promptBuilder");
const { sendToLLM, summarizeTextInChunks } = require("../services/llmService");

const router = express.Router();

router.post(
  "/analyze",
  upload.fields([
    { name: "courses", maxCount: 8 },
    { name: "subject", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const courseFiles = req.files?.courses || [];
      const subjectFiles = req.files?.subject || [];
      const subjectFile = subjectFiles[0];
      const userPrompt = cleanText(req.body.prompt || "");
      const provider = req.body.provider || "auto";

      if (courseFiles.length === 0) {
        return res.status(400).json({ message: "Ajoutez au moins un fichier de cours." });
      }
      if (!subjectFile) {
        return res.status(400).json({ message: "Ajoutez le fichier du sujet." });
      }
      if (!userPrompt) {
        return res.status(400).json({ message: "La consigne pedagogique est vide." });
      }

      const courses = await extractFilesText(courseFiles);
      const subject = await extractFilesText([subjectFile]);
      let coursesText = cleanText(courses.map((item) => item.text).join("\n\n"));
      const subjectText = cleanText(subject.map((item) => item.text).join("\n\n"));

      if (!coursesText) {
        return res.status(422).json({ message: "Impossible d'extraire le texte des cours." });
      }
      if (!subjectText) {
        return res.status(422).json({ message: "Impossible d'extraire le texte du sujet." });
      }

      const maxPromptChars = Number(process.env.MAX_FINAL_PROMPT_CHARS || 90000);
      let finalPrompt = buildPedagogicalPrompt({
        coursesText,
        subjectText,
        userPrompt,
      });
      let promptWasCompressed = false;

      if (finalPrompt.length > maxPromptChars) {
        coursesText = await summarizeTextInChunks(coursesText, provider);
        finalPrompt = buildPedagogicalPrompt({
          coursesText,
          subjectText,
          userPrompt,
        });
        promptWasCompressed = true;
      }

      if (finalPrompt.length > maxPromptChars * 1.2) {
        return res.status(413).json({
          message:
            "Les fichiers sont trop volumineux meme apres compression. Reduisez le nombre de cours ou divisez les fichiers.",
        });
      }

      const llmResult = await sendToLLM(finalPrompt, provider);

      res.json({
        answer: llmResult.answer,
        provider: llmResult.provider,
        triedProviders: llmResult.triedProviders,
        promptWasCompressed,
        stats: {
          courseFiles: courses.length,
          subjectFile: subjectFile.originalname,
          courseCharacters: coursesText.length,
          subjectCharacters: subjectText.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
