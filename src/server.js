require("dotenv").config();

const express = require("express");
const cors = require("cors");
const analysisRoutes = require("./routes/analysisRoutes");
const aiKeyRoutes = require("./routes/aiKeyRoutes");
const contentRoutes = require("./routes/contentRoutes");
const pedagogicalAnalysisRoutes = require("./routes/pedagogicalAnalysisRoutes");
const routingRoutes = require("./routes/routingRoutes");
const { getBackendHealth } = require("./services/routingService");

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (req, res, next) => {
  try {
    res.json({
      ok: true,
      service: "qcm-edu-ai-backend",
      ...(await getBackendHealth()),
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", analysisRoutes);
app.use("/api/ai-content", contentRoutes);
app.use("/api/ai-key", aiKeyRoutes);
app.use("/api/routing", routingRoutes);
app.use("/api/pedagogical-analysis", pedagogicalAnalysisRoutes);

app.use((err, req, res, next) => {
  let status = err.statusCode || err.status || 500;
  let message = err.publicMessage || "Erreur interne du serveur IA.";

  if (err.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "Un fichier depasse la taille maximale autorisee.";
  } else if (err.code === "LIMIT_FILE_COUNT") {
    status = 413;
    message = "Trop de fichiers envoyes.";
  } else if (err.message?.includes("Type de fichier non accepte")) {
    status = 415;
    message = err.message;
  }

  res.status(status).json({
    message,
    details: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`AI backend running on http://0.0.0.0:${port}`);
});
