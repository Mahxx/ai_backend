const express = require("express");
const {
  listCourses,
  listModules,
} = require("../services/courseRetrievalService");
const { enabledProviderOptions } = require("../services/llmProviderService");

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
    providers: enabledProviderOptions(),
  });
});

module.exports = router;
