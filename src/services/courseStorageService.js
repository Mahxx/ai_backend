const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { httpError } = require("./httpError");

let client;
const textCache = new Map();
let textCacheBytes = 0;

function getCourseStorageClient() {
  if (client) return client;

  const provider = (process.env.COURSE_STORAGE_PROVIDER || "cloudflare-r2").toLowerCase();

  if (provider === "http" || provider === "cloudflare-pages") {
    return null;
  }

  if (provider === "cloudflare-r2" || provider === "r2") {
    client = createR2Client();
    return client;
  }

  if (provider === "oracle") {
    client = createOracleClient();
    return client;
  }

  throw httpError(
    500,
    "Provider de stockage des cours inconnu.",
    `COURSE_STORAGE_PROVIDER=${provider}`
  );
}

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw httpError(
      500,
      "Configuration Cloudflare R2 manquante.",
      "Variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID ou R2_SECRET_ACCESS_KEY manquantes."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function createOracleClient() {
  const region = process.env.ORACLE_REGION;
  const namespace = process.env.ORACLE_NAMESPACE;
  const accessKeyId = process.env.ORACLE_ACCESS_KEY;
  const secretAccessKey = process.env.ORACLE_SECRET_KEY;

  if (!region || !namespace || !accessKeyId || !secretAccessKey) {
    throw httpError(
      500,
      "Configuration Oracle Object Storage manquante.",
      "Variables ORACLE_REGION, ORACLE_NAMESPACE, ORACLE_ACCESS_KEY ou ORACLE_SECRET_KEY manquantes."
    );
  }

  return new S3Client({
    region,
    endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getCourseBucketName() {
  const provider = (process.env.COURSE_STORAGE_PROVIDER || "cloudflare-r2").toLowerCase();
  const bucket =
    provider === "oracle"
      ? process.env.ORACLE_BUCKET_NAME
      : process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw httpError(
      500,
      "Bucket de stockage des cours manquant.",
      provider === "oracle" ? "ORACLE_BUCKET_NAME manquant." : "R2_BUCKET_NAME manquant."
    );
  }

  return bucket;
}

async function readTextObject(storagePath) {
  const key = storagePath.replace(/^\/+/, "");
  const cached = readFromCache(key);
  if (cached !== null) return cached;

  const provider = (process.env.COURSE_STORAGE_PROVIDER || "cloudflare-r2").toLowerCase();
  if (provider === "http" || provider === "cloudflare-pages") {
    return readHttpTextObject(key);
  }

  try {
    const response = await getCourseStorageClient().send(
      new GetObjectCommand({
        Bucket: getCourseBucketName(),
        Key: key,
      })
    );
    const text = await streamToString(response.Body);
    writeToCache(key, text);
    return text;
  } catch (error) {
    throw httpError(
      502,
      "Lecture des cours optimises impossible.",
      error.message
    );
  }
}

async function readHttpTextObject(key) {
  const baseUrl = process.env.COURSE_CONTENT_BASE_URL;
  if (!baseUrl) {
    throw httpError(
      500,
      "URL des cours IA manquante.",
      "COURSE_CONTENT_BASE_URL manquant."
    );
  }

  const url = new URL(key, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    writeToCache(key, text);
    return text;
  } catch (error) {
    throw httpError(
      502,
      "Lecture des cours optimises impossible.",
      error.message
    );
  }
}

async function streamToString(stream) {
  if (!stream) return "";
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readFromCache(key) {
  const maxBytes = getCacheMaxBytes();
  if (maxBytes <= 0) return null;

  const entry = textCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > getCacheTtlMs()) {
    textCache.delete(key);
    textCacheBytes -= entry.bytes;
    return null;
  }

  entry.lastAccess = Date.now();
  return entry.text;
}

function writeToCache(key, text) {
  const maxBytes = getCacheMaxBytes();
  if (maxBytes <= 0) return;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) return;

  if (textCache.has(key)) {
    const old = textCache.get(key);
    textCacheBytes -= old.bytes;
  }

  textCache.set(key, {
    text,
    bytes,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  });
  textCacheBytes += bytes;
  evictCache(maxBytes);
}

function evictCache(maxBytes) {
  while (textCacheBytes > maxBytes && textCache.size > 0) {
    const oldest = [...textCache.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess
    )[0];
    if (!oldest) break;
    textCache.delete(oldest[0]);
    textCacheBytes -= oldest[1].bytes;
  }
}

function getCacheMaxBytes() {
  const mb = Number(process.env.COURSE_TEXT_CACHE_MAX_MB || 256);
  return Number.isFinite(mb) ? Math.max(0, mb) * 1024 * 1024 : 256 * 1024 * 1024;
}

function getCacheTtlMs() {
  const minutes = Number(process.env.COURSE_TEXT_CACHE_TTL_MINUTES || 720);
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, minutes) : 720;
  return safeMinutes * 60 * 1000;
}

module.exports = { readTextObject };
