const express = require("express");
const { upload } = require("../services/uploadService");
const { analyzeSubject } = require("../services/analysisService");

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
