const crypto = require("crypto");
const { httpError } = require("./httpError");

const PREFIX = "enc:v1";

function encryptionKey() {
  const raw = process.env.MASTER_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw httpError(
      500,
      "Configuration de chiffrement manquante.",
      "MASTER_ENCRYPTION_KEY doit contenir au moins 32 caracteres."
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptSecret(value) {
  const parts = (value || "").split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw httpError(500, "Cle API chiffree invalide.");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

function maskSecret(value) {
  if (!value) return "";
  const prefix = value.slice(0, Math.min(3, value.length));
  const suffix = value.slice(-4);
  return `${prefix}****${suffix}`;
}

module.exports = { encryptSecret, decryptSecret, maskSecret };
