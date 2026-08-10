"use strict";

// Shared by popup.js (script tag) and background.js (importScripts).
// Keep it dependency-free so both classic contexts can load it.

const MODEL = "gemini-2.5-flash";
const OUTPUT_MODES = ["fusha", "tunisian", "english", "french"];
const MAX_RECENT = 10;
const MAX_SELECTION_CHARS = 4000;

const STORAGE = {
  apiKey: "gemini_api_key",
  language: "language",
  mode: "to_fusha",
  outputMode: "output_mode",
  history: "conversion_history",
};

const fushaPrompt = (text) => `Translate the following Tunisian Arabic text (written in Latin characters with numbers) into formal Modern Standard Arabic (MSA).

### **Rules:**
1. **Provide only the translated text** in Arabic script, without any explanations, notes, or additional text.
2. **Accurately interpret phonetic representations**, following these mappings:
   - '3' → 'ع'
   - '7' → 'ح'
   - '8' → 'غ'
   - '9' → 'ق'
   - '5' → 'خ'
   - '2' → 'ء'
3. **Ensure proper grammatical structure** in MSA while preserving the meaning of the original text.
4. **Exclude dialectal expressions** that are specific to Tunisian Arabic and use their equivalent in MSA.

### **Input Text:**
"${text}"

### **Output:**
(Provide only the translated text in Arabic script)`;

const latinaPrompt = (text) => `Convert the following Tunisian Arabic text (written in Latin characters with numbers) into **Tunisian Arabic written in Arabic script**.

### **Rules:**
1. **Provide only the converted text** in Arabic script, without any explanations, notes, or additional text.
2. **Preserve Tunisian Arabic expressions and informal tone**, ensuring the meaning remains the same.
3. **Use accurate phonetic transliteration**, following these mappings:
   - '3' → 'ع'
   - '7' → 'ح'
   - '8' → 'غ'
   - '9' → 'ق'
   - '5' → 'خ'
   - '2' → 'ء'
4. **Do not replace Tunisian dialect words** with MSA equivalents—keep them as they are, just written in Arabic script.

### **Input Text:**
"${text}"

### **Output:**
(Provide only the converted text in Arabic script)`;

const englishPrompt = (text) => `Translate the following Tunisian Arabic text (written in Latin characters with numbers, known as Arabizi) into natural English.

### **Rules:**
1. **Provide only the translated text** in English, without any explanations, notes, or additional text.
2. **Accurately interpret phonetic representations**, following these mappings:
   - '3' → 'ع'
   - '7' → 'ح'
   - '8' → 'غ'
   - '9' → 'ق'
   - '5' → 'خ'
   - '2' → 'ء'
3. **Preserve the meaning and tone** of the original Tunisian Arabic message.
4. **Use natural, fluent English** — not word-for-word literal translation when idioms are involved.

### **Input Text:**
"${text}"

### **Output:**
(Provide only the translated text in English)`;

const frenchPrompt = (text) => `Translate the following Tunisian Arabic text (written in Latin characters with numbers, known as Arabizi) into natural French.

### **Rules:**
1. **Provide only the translated text** in French, without any explanations, notes, or additional text.
2. **Accurately interpret phonetic representations**, following these mappings:
   - '3' → 'ع'
   - '7' → 'ح'
   - '8' → 'غ'
   - '9' → 'ق'
   - '5' → 'خ'
   - '2' → 'ء'
3. **Preserve the meaning and tone** of the original Tunisian Arabic message.
4. **Use natural, fluent French** — not word-for-word literal translation when idioms are involved.

### **Input Text:**
"${text}"

### **Output:**
(Provide only the translated text in French)`;

// The popup prompts above assume Arabizi input. Text selected on a web page can
// be in any language, so page selections use this auto-detecting variant.
// script is stated separately from lang so the Arabizi mapping in rule 2 can
// never be read as "answer in Arabic script" for an English/French target.
const SELECTION_TARGET = {
  fusha: { lang: "formal Modern Standard Arabic (Fusha)", script: "Arabic script" },
  tunisian: { lang: "Tunisian colloquial Arabic", script: "Arabic script" },
  english: { lang: "natural, fluent English", script: "the Latin alphabet, in the English language" },
  french: { lang: "natural, fluent French", script: "the Latin alphabet, in the French language" },
};

const selectionPrompt = (text, mode) => {
  const { lang: target, script } = SELECTION_TARGET[mode] || SELECTION_TARGET.fusha;
  return `You are a translation engine. Translate the input text into ${target}.

### **Rules:**
1. **Output only the translation**, written in ${script}. No explanations, notes, quotes, or the original text.
2. **Detect the source language yourself.** If the input is Arabizi (Arabic written in Latin letters with numbers), read '3' → 'ع', '7' → 'ح', '8' → 'غ', '9' → 'ق', '5' → 'خ', '2' → 'ء' **to understand it**. This mapping only helps you read the input — it must never change the language or script you output.
3. **Preserve meaning, tone, and formatting** (line breaks, lists, punctuation).
4. If the input is already in ${target}, return it unchanged.

### **Input Text:**
"""
${text}
"""

### **Output (${target}, ${script}):**`;
};

function promptForMode(mode, text) {
  if (mode === "tunisian") return latinaPrompt(text);
  if (mode === "english") return englishPrompt(text);
  if (mode === "french") return frenchPrompt(text);
  return fushaPrompt(text);
}

function outputDir(mode) {
  return mode === "english" || mode === "french" ? "ltr" : "rtl";
}

function normalizeOutputMode(stored) {
  if (
    stored[STORAGE.outputMode] &&
    OUTPUT_MODES.includes(stored[STORAGE.outputMode])
  ) {
    return stored[STORAGE.outputMode];
  }
  if (stored[STORAGE.mode] === false) return "tunisian";
  return "fusha";
}

function pruneHistory(entries) {
  const bookmarked = entries.filter((entry) => entry.bookmarked);
  const recent = entries
    .filter((entry) => !entry.bookmarked)
    .slice(0, MAX_RECENT);
  return [...bookmarked, ...recent].sort((a, b) => b.timestamp - a.timestamp);
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
        // gemini-2.5-flash thinks by default and reasoning tokens are billed
        // against maxOutputTokens — leave it on and translations come back
        // empty with finishReason MAX_TOKENS.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status})`);
  }
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) {
    // Never hand back "" — the caller would render an empty box and look broken.
    const reason =
      candidate?.finishReason ||
      data?.promptFeedback?.blockReason ||
      "EMPTY_RESPONSE";
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}
