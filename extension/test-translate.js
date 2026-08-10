// Self-check for the shared helpers: node extension/test-translate.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "translate.js"), "utf8");
const T = vm.runInThisContext(
  `${src}\n;({ selectionPrompt, promptForMode, pruneHistory, normalizeOutputMode, outputDir, callGemini, OUTPUT_MODES })`
);

// Every mode gets a real target language, and the input is embedded verbatim.
T.OUTPUT_MODES.forEach((mode) => {
  const p = T.selectionPrompt("3aslema", mode);
  assert.ok(p.includes("3aslema"), `${mode}: input missing`);
  assert.ok(!p.includes("undefined"), `${mode}: unmapped target`);
});
assert.ok(T.selectionPrompt("hi", "english").includes("fluent English"));
assert.ok(T.selectionPrompt("hi", "bogus").includes("Modern Standard Arabic"));

// A Latin-script target must never be told to answer in Arabic script — that is
// what made "English" come back as Arabic.
["english", "french"].forEach((mode) => {
  const p = T.selectionPrompt("3aslema", mode);
  assert.ok(!p.includes("in Arabic script"), `${mode}: asks for Arabic script`);
  assert.ok(p.includes("Latin alphabet"), `${mode}: script not pinned`);
});
["fusha", "tunisian"].forEach((mode) => {
  assert.ok(T.selectionPrompt("3aslema", mode).includes("Arabic script"));
});

// Popup prompts still route per mode.
assert.ok(T.promptForMode("french", "x").includes("natural French"));
assert.ok(T.promptForMode("nope", "x").includes("Modern Standard Arabic"));

assert.strictEqual(T.outputDir("english"), "ltr");
assert.strictEqual(T.outputDir("fusha"), "rtl");

// Bookmarks survive; only the newest MAX_RECENT unbookmarked entries do.
const entries = Array.from({ length: 15 }, (_, i) => ({
  id: String(i),
  timestamp: 100 - i,
  bookmarked: i === 14,
}));
const pruned = T.pruneHistory(entries);
assert.strictEqual(pruned.length, 11);
assert.ok(pruned.some((e) => e.id === "14"));
assert.ok(!pruned.some((e) => e.id === "13"));
assert.deepStrictEqual(
  pruned.map((e) => e.timestamp),
  [...pruned.map((e) => e.timestamp)].sort((a, b) => b - a)
);

assert.strictEqual(T.normalizeOutputMode({ output_mode: "french" }), "french");
assert.strictEqual(T.normalizeOutputMode({ output_mode: "junk" }), "fusha");
assert.strictEqual(T.normalizeOutputMode({ to_fusha: false }), "tunisian");
assert.strictEqual(T.normalizeOutputMode({}), "fusha");

// callGemini must never return "" — an empty candidate has to surface as an
// error, and thinking has to be switched off or 2.5-flash spends the whole
// output budget on reasoning.
(async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => FAKE };
  };

  let FAKE = { candidates: [{ finishReason: "MAX_TOKENS", content: {} }] };
  await assert.rejects(() => T.callGemini("p", "k"), /MAX_TOKENS/);

  FAKE = { promptFeedback: { blockReason: "SAFETY" } };
  await assert.rejects(() => T.callGemini("p", "k"), /SAFETY/);

  FAKE = { candidates: [{ content: { parts: [{ text: " hello " }] } }] };
  assert.strictEqual(await T.callGemini("p", "k"), "hello");

  assert.strictEqual(calls[0].generationConfig.thinkingConfig.thinkingBudget, 0);

  console.log("translate.js OK");
})();
