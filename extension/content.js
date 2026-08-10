"use strict";

// Selection UI only — every Gemini call goes through background.js.
(() => {
  if (window.__arabizziContentLoaded) return;
  window.__arabizziContentLoaded = true;

  const MODES = ["fusha", "tunisian", "english", "french"];

  const I18N = {
    en: {
      dir: "ltr",
      translate: "Translate",
      loading: "Translating…",
      copy: "Copy",
      copied: "Copied!",
      close: "Close",
      keyMissing: "Add your free Gemini API key in the Arabizzi popup (⚙) to start translating.",
      error: "Translation failed. Please try again.",
      fusha: "Fusha",
      tunisian: "عامية",
      english: "English",
      french: "French",
    },
    ar: {
      dir: "rtl",
      translate: "ترجم",
      loading: "جاري الترجمة…",
      copy: "نسخ",
      copied: "تم النسخ!",
      close: "إغلاق",
      keyMissing: "أضف مفتاح Gemini المجاني من نافذة Arabizzi (⚙) لبدء الترجمة.",
      error: "فشلت الترجمة. يرجى المحاولة مرة أخرى.",
      fusha: "فصحى",
      tunisian: "عامية",
      english: "إنجليزي",
      french: "فرنسي",
    },
  };

  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed;
      z-index: 2147483647;
      max-width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1d2329;
      background: #ffffff;
      border: 1px solid #e4e0d6;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(29, 35, 41, 0.18);
      overflow: hidden;
    }
    .pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: #25876d;
      color: #ffffff;
      border: none;
      border-radius: 999px;
      font: inherit;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(37, 135, 109, 0.35);
    }
    .pill:hover { background: #1f7159; }
    .pill .glyph { font-size: 15px; line-height: 1; }
    .body { padding: 12px 14px; max-height: 220px; overflow-y: auto; white-space: pre-wrap; }
    .skeleton { width: 264px; padding: 14px; display: grid; gap: 9px; }
    .sk-line {
      height: 11px;
      border-radius: 6px;
      background: linear-gradient(90deg, #eceae3 25%, #f7f4ee 37%, #eceae3 63%);
      background-size: 400% 100%;
      animation: sk-shimmer 1.3s ease-in-out infinite;
    }
    .sk-line:nth-child(2) { width: 88%; }
    .sk-line:nth-child(3) { width: 62%; }
    @keyframes sk-shimmer {
      from { background-position: 100% 50%; }
      to { background-position: 0 50%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sk-line { animation: none; }
    }
    .body.muted { color: #6b7280; }
    .body.error { color: #dc2626; }
    .foot {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid #e4e0d6;
      background: #f7f4ee;
      flex-wrap: wrap;
    }
    .chip {
      padding: 4px 9px;
      border: 1px solid #e4e0d6;
      border-radius: 999px;
      background: #ffffff;
      color: #6b7280;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .chip:hover { border-color: #25876d; color: #25876d; }
    .chip.active { background: #25876d; border-color: #25876d; color: #ffffff; }
    .chip.copy { margin-inline-start: auto; color: #25876d; border-color: rgba(37, 135, 109, 0.4); }
  `;

  let host = null;
  let shadow = null;
  let lastSelection = null; // { text, rect }
  let lang = "ar";

  chrome.storage.local.get("language", (stored) => {
    if (stored?.language === "en" || stored?.language === "ar") {
      lang = stored.language;
    }
  });

  const t = () => I18N[lang];

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.setAttribute("data-arabizzi", "");
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function hide() {
    if (host?.isConnected) host.remove();
    host = null;
    shadow = null;
  }

  function place(el, rect) {
    // Rects come from getBoundingClientRect, and .panel is position:fixed, so
    // viewport coordinates go straight through.
    el.style.visibility = "hidden";
    el.style.left = "0px";
    el.style.top = "0px";
    requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const above = rect.top - box.height - 8;
      const top = above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - box.height - 8);
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - box.width - 8)
      );
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(8, top)}px`;
      el.style.visibility = "visible";
    });
  }

  function render(rect, build) {
    ensureHost();
    shadow.querySelector(".panel")?.remove();
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.dir = t().dir;
    build(panel);
    shadow.appendChild(panel);
    place(panel, rect);
    return panel;
  }

  function showPill(text, rect) {
    lastSelection = { text, rect };
    render(rect, (panel) => {
      panel.style.border = "none";
      panel.style.background = "transparent";
      panel.style.boxShadow = "none";
      const btn = document.createElement("button");
      btn.className = "pill";
      btn.innerHTML = `<span class="glyph">ع</span><span></span>`;
      btn.lastElementChild.textContent = t().translate;
      btn.addEventListener("click", () => translate(text, null, rect));
      panel.appendChild(btn);
    });
  }

  function showLoading(rect) {
    render(rect, (panel) => {
      const box = document.createElement("div");
      box.className = "skeleton";
      box.setAttribute("role", "status");
      box.setAttribute("aria-label", t().loading);
      for (let i = 0; i < 3; i++) {
        const line = document.createElement("div");
        line.className = "sk-line";
        box.appendChild(line);
      }
      panel.appendChild(box);
    });
  }

  function showMessage(rect, message, kind) {
    render(rect, (panel) => {
      const body = document.createElement("div");
      body.className = `body ${kind}`;
      body.textContent = message;
      panel.appendChild(body);
    });
  }

  function showResult(rect, text, mode, dir, source) {
    render(rect, (panel) => {
      const body = document.createElement("div");
      body.className = "body";
      body.dir = dir;
      body.textContent = text;
      panel.appendChild(body);

      const foot = document.createElement("div");
      foot.className = "foot";
      MODES.forEach((m) => {
        const chip = document.createElement("button");
        chip.className = `chip${m === mode ? " active" : ""}`;
        chip.textContent = t()[m];
        chip.addEventListener("click", () => translate(source, m, rect));
        foot.appendChild(chip);
      });

      const copy = document.createElement("button");
      copy.className = "chip copy";
      copy.textContent = t().copy;
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(text);
        copy.textContent = t().copied;
        setTimeout(() => (copy.textContent = t().copy), 1500);
      });
      foot.appendChild(copy);
      panel.appendChild(foot);
    });
  }

  function translate(text, mode, rect) {
    lastSelection = { text, rect };
    showLoading(rect);
    chrome.runtime.sendMessage({ action: "translate", text, mode }, (res) => {
      if (chrome.runtime.lastError || !res) {
        showMessage(rect, t().error, "error");
        return;
      }
      if (res.needsKey) {
        if (res.language === "en" || res.language === "ar") lang = res.language;
        showMessage(rect, t().keyMissing, "muted");
        return;
      }
      if (res.error || !res.output) {
        showMessage(rect, res.error || t().error, "error");
        return;
      }
      showResult(rect, res.output, res.mode, res.dir, text);
    });
  }

  function selectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text: sel.toString().trim(), rect };
  }

  // Capture phase: plenty of sites call stopPropagation() on mouse events, which
  // would never let a bubble-phase listener on document run.
  document.addEventListener(
    "mouseup",
    (e) => {
      if (host && e.composedPath().includes(host)) return;
      // Let the browser finish updating the selection first.
      setTimeout(() => {
        const current = selectionRect();
        if (!current?.text) {
          hide();
          return;
        }
        showPill(current.text, current.rect);
      }, 0);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (host && e.composedPath().includes(host)) return;
      hide();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  }, true);

  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== "translate-selection") return;
    const current = selectionRect();
    const rect = current?.rect ||
      lastSelection?.rect || {
        top: 80,
        bottom: 80,
        left: window.innerWidth / 2 - 180,
      };
    const text = msg.text?.trim() || current?.text || "";
    if (text) translate(text, msg.mode, rect);
  });
})();
