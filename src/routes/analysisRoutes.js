const express = require("express");
const { upload } = require("../services/uploadService");
const { analyzeSubject } = require("../services/analysisService");
const { askCourseChat } = require("../services/courseChatService");
const { generateReviewQuestions } = require("../services/reviewQuestionService");

const router = express.Router();

router.post(
  "/analyze-subject",
  upload.fields([{ name: "subject", maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const subjectFile = req.files?.subject?.[0] || null;
      const courseIds = parseJsonArray(req.body.courseIds);
      const result = await analyzeSubject({
        userId: req.body.userId,
        email: req.body.email,
        fullName: req.body.fullName,
        moduleId: req.body.moduleId,
        courseIds,
        provider: req.body.provider,
        model: req.body.model,
        subjectFile,
        subjectText: req.body.subjectText,
        reservedBackendId: req.body.reservedBackendId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post("/generate-review-questions", async (req, res, next) => {
  try {
    const result = await generateReviewQuestions({
      userId: req.body.userId,
      email: req.body.email,
      fullName: req.body.fullName,
      studyYear: req.body.studyYear,
      moduleId: req.body.moduleId,
      questionCount: req.body.questionCount,
      provider: req.body.provider,
      model: req.body.model,
      reservedBackendId: req.body.reservedBackendId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/course-chat", async (req, res, next) => {
  try {
    const result = await askCourseChat({
      userId: req.body.userId,
      email: req.body.email,
      fullName: req.body.fullName,
      studyYear: req.body.studyYear,
      moduleId: req.body.moduleId,
      courseIds: parseJsonArray(req.body.courseIds),
      question: req.body.question,
      history: parseJsonArray(req.body.history),
      provider: req.body.provider,
      model: req.body.model,
      reservedBackendId: req.body.reservedBackendId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

module.exports = router;
