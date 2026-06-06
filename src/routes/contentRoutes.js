const express = require("express");
const {
  listCourses,
  listModules,
} = require("../services/courseRetrievalService");
const { providerLinks, PROVIDER_DEFAULTS } = require("../services/llmProviderService");

const router = express.Router();

router.get("/modules", async (req, res, next) => {
  try {
    res.json({ modules: await listModules() });
  } catch (error) {
    next(error);
  }
});

router.get("/modules/:moduleId/courses", async (req, res, next) => {
  try {
    res.json({ courses: await listCourses(req.params.moduleId) });
  } catch (error) {
    next(error);
  }
});

router.get("/providers", (req, res) => {
  res.json({
    providers: Object.entries(PROVIDER_DEFAULTS).map(([id, data]) => ({
      id,
      label: data.label,
      defaultModel: data.model,
      keyUrl: providerLinks()[id],
    })),
  });
});

module.exports = router;
