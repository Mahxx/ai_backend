const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MASTER_ENCRYPTION_KEY =
  "test-master-key-with-at-least-32-characters";

const {
  decryptSecret,
  encryptSecret,
  maskSecret,
} = require("../src/services/encryptionService");

test("encryptSecret and decryptSecret round trip", () => {
  const encrypted = encryptSecret("sk-test-secret");
  assert.notEqual(encrypted, "sk-test-secret");
  assert.equal(decryptSecret(encrypted), "sk-test-secret");
});

test("maskSecret hides the middle of the key", () => {
  assert.equal(maskSecret("sk-abcdef1234"), "sk-****1234");
});
