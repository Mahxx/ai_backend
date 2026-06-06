function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readString(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : value;
}

const config = {
  backendId: readString("BACKEND_ID", "local-ai-backend"),
  backendType: readString("BACKEND_TYPE", "local"),
  backendPublicUrl: readString("BACKEND_PUBLIC_URL", "http://localhost:8787"),
  maxFileSizeMb: readNumber("MAX_FILE_SIZE_MB", 2),
  maxSubjectChars: readNumber("MAX_SUBJECT_CHARS", 20000),
  maxCourseContextChars: readNumber("MAX_COURSE_CONTEXT_CHARS", 50000),
  userDailyLimit: readNumber("USER_DAILY_LIMIT", 5),
  requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 60000),
  storeAnalysisHistory: readString("STORE_ANALYSIS_HISTORY", "false") === "true",
};

module.exports = { config, readNumber, readString };
