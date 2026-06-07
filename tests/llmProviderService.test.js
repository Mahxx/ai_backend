const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultModel,
  enabledProviderIds,
  normalizeProvider,
} = require("../src/services/llmProviderService");

test("normalizeProvider maps claude to anthropic", () => {
  assert.equal(normalizeProvider("claude"), "anthropic");
});

test("defaultModel returns provider default", () => {
  assert.equal(defaultModel("deepseek"), "deepseek-v4-flash");
});

test("enabledProviderIds defaults to free-friendly providers", () => {
  delete process.env.ENABLED_AI_PROVIDERS;
  assert.deepEqual(enabledProviderIds(), ["gemini", "groqcloud", "openrouter"]);
});
