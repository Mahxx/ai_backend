const express = require("express");
const {
  deleteApiKey,
  getKeyStatuses,
  saveApiKey,
  testApiKey,
} = require("../services/apiKeyService");

const router = express.Router();

router.get("/status/:userId", async (req, res, next) => {
  try {
    const keys = await getKeyStatuses(req.params.userId);
    res.json({ keys });
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const result = await testApiKey(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/save", async (req, res, next) => {
  try {
    const result = await saveApiKey(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/delete", async (req, res, next) => {
  try {
    const result = await deleteApiKey(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
