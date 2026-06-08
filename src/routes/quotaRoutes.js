const express = require("express");
const { getUserDailyQuota } = require("../services/quotaService");

const router = express.Router();

router.post("/status", async (req, res, next) => {
  try {
    const quota = await getUserDailyQuota(req.body.userId);
    res.json({ quota });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
