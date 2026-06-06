const express = require("express");
const { selectBackend } = require("../services/routingService");

const router = express.Router();

router.post("/select-backend", async (req, res, next) => {
  try {
    const backend = await selectBackend();
    res.json(backend);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
