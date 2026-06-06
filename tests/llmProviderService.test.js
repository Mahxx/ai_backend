const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultModel,
  normalizeProvider,
} = require("../src/services/llmProviderService");

test("normalizeProvider maps claude to anthropic", () => {
  assert.equal(normalizeProvider("claude"), "anthropic");
});

test("defaultModel returns provider default", () => {
  assert.equal(defaultModel("deepseek"), "deepseek-chat");
});
