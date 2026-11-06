// electron/modules/agent-runtime-policy.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs2 from "node:fs/promises";
import path2 from "node:path";
import os from "node:os";
import http from "node:http";
import { pathToFileURL } from "node:url";

// shared/app-shortcuts.ts
var configurableAppShortcutIds = ["conversation.new", "conversation.search", "conversation.openFile", "app.quit"];
function createDefaultAppShortcuts() {
  return Object.fromEntries(configurableAppShortcutIds.map((id) => [id, true]));
}

// shared/browser-automation.ts
var BROWSER_CURSOR_STYLES = ["windows-glow", "navora-arrow", "focus-ring", "precision-cross", "ice-arrow", "diamond", "laser", "windows-standard"];
function createDefaultBrowserAutomation() {
  return {
    auto_mute: true,
    show_virtual_cursor: true,
    show_control_feedback: true,
    protect_input: true,
    smooth_pointer: true,
    pointer_profile: "natural",
    speed_multiplier: 0.6,
    interval_ms: 1e3 / 120,
    cursor_fps: 60,
    cursor_style: "windows-glow",
    cursor_scale: 1
  };
}
function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}
function finite(value, name, min, max, positive = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || positive && value <= 0) {
    throw new RangeError(`${name} must be a finite number ${positive ? "greater than zero and " : ""}between ${min} and ${max}`);
  }
  return value;
}
function normalizeBrowserAutomation(value) {
  const defaults = createDefaultBrowserAutomation();
  if (value === void 0) return defaults;
  const source = record(value, "browser.automation");
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown browser.automation setting: ${key}`);
  }
  const result = { ...defaults };
  for (const key of ["auto_mute", "show_virtual_cursor", "show_control_feedback", "protect_input", "smooth_pointer"]) {
    if (source[key] === void 0) continue;
    if (typeof source[key] !== "boolean") throw new TypeError(`browser.automation.${key} must be a boolean`);
    result[key] = source[key];
  }
  if (source.pointer_profile !== void 0) {
    if (source.pointer_profile !== "natural" && source.pointer_profile !== "precise") throw new TypeError("Invalid browser.automation.pointer_profile");
    result.pointer_profile = source.pointer_profile;
  }
  if (source.cursor_style !== void 0) {
    if (typeof source.cursor_style !== "string" || !BROWSER_CURSOR_STYLES.includes(source.cursor_style)) throw new TypeError("Invalid browser.automation.cursor_style");
    result.cursor_style = source.cursor_style;
  }
  if (source.cursor_scale !== void 0) result.cursor_scale = finite(source.cursor_scale, "cursor_scale", 0.75, 2);
  if (source.speed_multiplier !== void 0) result.speed_multiplier = finite(source.speed_multiplier, "speed_multiplier", 0, Number.MAX_VALUE, true);
  if (source.interval_ms !== void 0) result.interval_ms = finite(source.interval_ms, "interval_ms", 0, 6e4, true);
  if (source.cursor_fps !== void 0) {
    result.cursor_fps = finite(source.cursor_fps, "cursor_fps", 0, 1e3);
    if (!Number.isInteger(result.cursor_fps)) throw new RangeError("cursor_fps must be an integer");
  }
  return result;
}
function createBrowserAutomationState() {
  return {
    owner: "ai",
    activity: "idle",
    epoch: 0,
    activeOperations: 0,
    cursorEnabled: false,
    inputProtected: false,
    isolateInput: false,
    keepRendering: false,
    nativeConfirmed: true,
    nativePending: false
  };
}

// shared/user-agent.ts
var DEFAULT_ACCEPT_LANGUAGE_LIST = "zh-CN,zh,en,en-GB,en-US";
function toAcceptLanguageList(raw) {
  return String(raw || "").split(",").map((part) => part.trim().split(";")[0].trim()).filter(Boolean).join(",");
}
function generateAcceptLanguageHeader(rawLanguageList) {
  const langs = toAcceptLanguageList(rawLanguageList).split(",").map((s) => s.trim()).filter(Boolean);
  if (!langs.length) return "";
  let q10 = 10;
  const out = [];
  for (const language of langs) {
    if (q10 === 10) out.push(language);
    else out.push(`${language};q=0.${q10}`);
    if (q10 > 1) q10 -= 1;
  }
  return out.join(",");
}
var DEFAULT_ACCEPT_LANGUAGE = generateAcceptLanguageHeader(
  DEFAULT_ACCEPT_LANGUAGE_LIST
);
var FALLBACK_CHROME_UA_VERSION = "152.0.0.0";

// shared/ua-presets.ts
var V = FALLBACK_CHROME_UA_VERSION;
var CHROME_WIN = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`;
var CHROME_MAC = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`;
var CHROME_LINUX = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${V} Safari/537.36`;
var EDGE_MAC = `${CHROME_MAC} Edg/${V}`;
var EDGE_LINUX = `${CHROME_LINUX} Edg/${V}`;

// shared/config.ts
var DEFAULT_REMOTE_PASSWORD_HASH = "scrypt$84d1e3974951ea77e6bb823dbe9a2d67$a43bac39a620e3d129cb2f2c81442cf917d292d716d9457c56ac486d0398b8fd";
var DEFAULT_SHELL_ALLOWLIST = [
  "git",
  "node",
  "npm",
  "npx",
  "navora-plugin",
  "python",
  "python3",
  "py",
  "pip",
  "pip3",
  "dir",
  "ls",
  "echo",
  "type",
  "cat",
  "where",
  "which",
  "powershell",
  "pwsh",
  "curl",
  "curl.exe"
];
var FORK_ASK_TIMEOUT_DEFAULT_MS = 0;
function createDefaultForkDecision() {
  return {
    enabled: true,
    allow_custom: true,
    option_hints: true,
    context_evidence: true,
    recommended: true,
    remember_in_chat: true,
    inline_low_risk: false,
    allow_revise: false,
    ask_timeout_ms: FORK_ASK_TIMEOUT_DEFAULT_MS
  };
}
function createDefaultSubchat() {
  return {
    enabled: true,
    max_parallel: 4
  };
}
var BALANCED_PERMISSION_MODES = {
  "session.create": "allow",
  "session.persist": "ask",
  "session.close": "allow",
  "session.clear": "allow",
  "session.set_proxy": "ask",
  "session.set_ua": "ask_chat",
  "session.cookies_read": "ask_chat",
  "session.cookies_write": "ask",
  "session.fetch": "allow_notify",
  "window.create": "allow",
  "window.close": "allow",
  "window.set_visible": "allow",
  navigate: "allow_notify",
  wait: "allow",
  click: "allow",
  type: "ask_chat",
  get_page: "allow",
  evaluate: "ask",
  screenshot: "allow_notify",
  "desktop.screenshot": "ask",
  "network.request": "ask",
  "network.observe": "allow",
  "network.modify": "ask",
  "network.block": "ask",
  "file.read": "allow",
  "file.write": "ask",
  "file.download": "ask",
  "file.download.passive": "ask",
  "shell.open": "ask",
  "shell.exec": "ask",
  "settings.read": "allow",
  "settings.write": "ask",
  "skills.write": "ask",
  "browser.geolocation": "ask",
  "compute.local": "allow"
};
function createDefaultConfig() {
  return {
    app: {
      language: "zh-CN",
      appearance_theme: "mist",
      appearance_mode: "auto",
      subchat_glyph_style: "mixed",
      window_acrylic: true,
      close_to_tray: true,
      show_main_on_start: true,
      show_followup_suggestions: false,
      running_message_mode: "queue",
      ai_generate_chat_title: true,
      show_read_pages: true,
      show_run_logs: true,
      collapse_tool_runs: true,
      collapse_run_logs: true,
      max_composer_chars: 16e3,
      onboarding_completed: false,
      shortcuts: createDefaultAppShortcuts()
    },
    browser: {
      link_open_mode: "window",
      automation: createDefaultBrowserAutomation(),
      default_ua_preset: "edge152",
      custom_ua: "",
      accept_language: DEFAULT_ACCEPT_LANGUAGE,
      show_agent_windows: false,
      default_width: 1280,
      default_height: 800,
      navigation_timeout_ms: 3e4,
      action_timeout_ms: 15e3,
      wait: {
        load: true,
        network_idle: false,
        network_idle_ms: 500,
        delay_ms: 0
      },
      page_get_max_chars: 8e4,
      network_log_buffer: 200,
      evaluate_world_id: 1e3,
      evaluate_code_max_chars: 32e3,
      evaluate_result_max_chars: 8e4,
      fetch_timeout_ms: 3e4,
      fetch_max_body_chars: 2e5,
      fetch_max_body_bytes: 524288,
      block_window_open: false,
      url_allowlist: [],
      max_windows_total: 24,
      max_fetch_inflight: 8,
      max_parallel_agent_chats: 4,
      tree_update_debounce_ms: 100,
      log_datadome_telemetry: false
    },
    files: {
      root_dirname: "workspace",
      custom_root: "",
      max_read_chars: 2e5,
      max_write_bytes: 52428800,
      max_list_entries: 500,
      download_timeout_ms: 6e5,
      download_max_bytes: 524288e3,
      shell_timeout_ms: 3e4,
      shell_timeout_ms_max: 12e4,
      shell_max_output_chars: 8e4,
      shell_allowlist: [...DEFAULT_SHELL_ALLOWLIST],
      shell_allow_shell_flag: false
    },
    permissions: {
      preset: "balanced",
      confirm_timeout_ms: 12e4,
      user_intent_bypass_ask: true,
      modes: { ...BALANCED_PERMISSION_MODES }
    },
    ai: {
      default_provider: "openai_compatible",
      providers: [
        {
          id: "openai_compatible",
          type: "openai_compatible",
          label: "OpenAI Compatible",
          base_url: "https://api.openai.com/v1",
          api_key_ref: "secrets/openai",
          model: "gpt-4.1",
          models: ["gpt-4.1", "gpt-4.1-mini", "gpt-5.4", "gpt-5-mini"],
          timeout_ms: 12e4
        }
      ],
      max_tool_rounds: 24,
      continue_tool_rounds: 12
    },
    fork_decision: createDefaultForkDecision(),
    subchat: createDefaultSubchat(),
    remote: {
      enabled: false,
      host: "127.0.0.1",
      port: 8790,
      username: "admin",
      passwordHash: DEFAULT_REMOTE_PASSWORD_HASH
    },
    store: {
      base_url: "http://127.0.0.1:8791"
    },
    plugins: {
      dev_mode: false
    }
  };
}

// electron/modules/questionnaire-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// shared/questionnaire.ts
var own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
var plain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var text = (value, max) => typeof value === "string" && value.length <= max;
var identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value);
function validateQuestionnaireDefinition(value) {
  if (!plain(value)) return ["\u95EE\u5377\u5B9A\u4E49\u5FC5\u987B\u662F\u5BF9\u8C61"];
  const errors = [];
  if (!text(value.title, 200) || !value.title.trim()) errors.push("\u95EE\u5377\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u6700\u591A 200 \u5B57\u7B26");
  if (value.description !== void 0 && !text(value.description, 4e3)) errors.push("\u95EE\u5377\u8BF4\u660E\u6700\u591A 4000 \u5B57\u7B26");
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 30) return [...errors, "\u95EE\u5377\u9700\u8981 1 \u81F3 30 \u4E2A\u95EE\u9898"];
  const ids = /* @__PURE__ */ new Set();
  for (const [index, q] of value.questions.entries()) {
    const prefix = `\u95EE\u9898 ${index + 1}`;
    if (!plain(q)) {
      errors.push(`${prefix}\u683C\u5F0F\u65E0\u6548`);
      continue;
    }
    if (!identifier(q.id) || ids.has(q.id)) errors.push(`${prefix}\u9700\u8981\u552F\u4E00\u4E14\u7A33\u5B9A\u7684 ID`);
    ids.add(String(q.id));
    if (!["single", "multi", "toggle", "text", "textarea", "number"].includes(String(q.type))) errors.push(`${prefix}\u9898\u578B\u65E0\u6548`);
    if (!text(q.title, 500) || !q.title.trim()) errors.push(`${prefix}\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u6700\u591A 500 \u5B57\u7B26`);
    for (const key of ["description", "placeholder", "unit"]) if (q[key] !== void 0 && !text(q[key], key === "description" ? 4e3 : 300)) errors.push(`${prefix}\u7684 ${key} \u65E0\u6548`);
    for (const key of ["required", "allowOther", "allowUnknown", "allowDelegate", "allowSkip", "allowNote"]) if (q[key] !== void 0 && typeof q[key] !== "boolean") errors.push(`${prefix}\u7684 ${key} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
    for (const key of ["min", "max"]) if (q[key] !== void 0 && (typeof q[key] !== "number" || !Number.isFinite(q[key]))) errors.push(`${prefix}\u7684 ${key} \u65E0\u6548`);
    if (typeof q.min === "number" && typeof q.max === "number" && q.min > q.max) errors.push(`${prefix}\u7684\u6700\u5C0F\u503C\u4E0D\u80FD\u8D85\u8FC7\u6700\u5927\u503C`);
    if (q.type === "single" || q.type === "multi") {
      if (!Array.isArray(q.options) || !q.options.length || q.options.length > 50) {
        errors.push(`${prefix}\u9700\u8981 1 \u81F3 50 \u4E2A\u9009\u9879`);
        continue;
      }
      const options = /* @__PURE__ */ new Set();
      for (const option of q.options) {
        if (!plain(option) || !identifier(option.id) || options.has(option.id) || !text(option.label, 500) || !option.label.trim()) {
          errors.push(`${prefix}\u7684\u9009\u9879 ID \u6216\u6587\u6848\u65E0\u6548`);
          continue;
        }
        options.add(option.id);
        if (option.description !== void 0 && !text(option.description, 2e3)) errors.push(`${prefix}\u9009\u9879\u8BF4\u660E\u8FC7\u957F`);
        if (option.recommended !== void 0 && typeof option.recommended !== "boolean") errors.push(`${prefix}\u63A8\u8350\u6807\u8BB0\u65E0\u6548`);
      }
    } else if (q.allowOther) errors.push(`${prefix}\u4EC5\u9009\u62E9\u9898\u652F\u6301\u5176\u4ED6\u7B54\u6848`);
  }
  return errors;
}
function validateQuestionnaireAnswers(questions, answers, supplement = "", complete = true) {
  const errors = [];
  const add = (questionId, message) => errors.push({ questionId, message });
  if (!plain(answers)) return [{ questionId: "", message: "\u7B54\u6848\u683C\u5F0F\u65E0\u6548" }];
  if (!text(supplement, 2e4)) add("", "\u8865\u5145\u8BF4\u660E\u6700\u591A 20000 \u5B57\u7B26");
  const ids = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(answers)) if (!ids.has(id)) add(id, "\u7B54\u6848\u4E0D\u5C5E\u4E8E\u8FD9\u4EFD\u95EE\u5377");
  for (const q of questions) {
    const a = own(answers, q.id) ? answers[q.id] : void 0;
    if (a === void 0) {
      if (complete && q.required) add(q.id, "\u8BF7\u56DE\u7B54\u8FD9\u9053\u5FC5\u586B\u9898");
      continue;
    }
    if (!plain(a) || !["unanswered", "answered", "unknown", "delegate", "skip"].includes(String(a.state))) {
      add(q.id, "\u7B54\u6848\u72B6\u6001\u65E0\u6548");
      continue;
    }
    if (a.note !== void 0 && (!q.allowNote || !text(a.note, 1e4))) add(q.id, "\u5907\u6CE8\u65E0\u6548\u6216\u8FC7\u957F");
    if (a.other !== void 0 && (!q.allowOther || !text(a.other, 1e4))) add(q.id, "\u5176\u4ED6\u7B54\u6848\u65E0\u6548\u6216\u8FC7\u957F");
    if (a.state !== "answered") {
      if (own(a, "value") && a.value !== void 0) add(q.id, "\u672A\u4F5C\u7B54\u72B6\u6001\u4E0D\u80FD\u5305\u542B\u7B54\u6848\u503C");
      if (a.state === "unknown" && !q.allowUnknown) add(q.id, "\u8FD9\u9053\u9898\u4E0D\u5141\u8BB8\u9009\u62E9\u4E0D\u786E\u5B9A");
      if (a.state === "delegate" && !q.allowDelegate) add(q.id, "\u8FD9\u9053\u9898\u4E0D\u80FD\u4EA4\u7ED9 Agent \u51B3\u5B9A");
      if (a.state === "skip" && !q.allowSkip) add(q.id, "\u8FD9\u9053\u9898\u4E0D\u5141\u8BB8\u8DF3\u8FC7");
      if (complete && q.required && a.state === "unanswered") add(q.id, "\u8BF7\u56DE\u7B54\u8FD9\u9053\u5FC5\u586B\u9898");
      continue;
    }
    const other = typeof a.other === "string" && !!a.other.trim();
    const optionIds = new Set((q.options || []).map((o) => o.id));
    if (q.type === "single") {
      if (typeof a.value !== "string" || a.value !== "" && !optionIds.has(a.value)) add(q.id, "\u8BF7\u9009\u62E9\u6709\u6548\u9009\u9879");
      else if (!a.value && complete && !other) add(q.id, "\u8BF7\u9009\u62E9\u9009\u9879\u6216\u586B\u5199\u5176\u4ED6\u7B54\u6848");
    } else if (q.type === "multi") {
      if (!Array.isArray(a.value) || a.value.some((v) => typeof v !== "string" || !optionIds.has(v)) || new Set(a.value).size !== a.value.length) add(q.id, "\u591A\u9009\u7B54\u6848\u5305\u542B\u65E0\u6548\u6216\u91CD\u590D\u9009\u9879");
      else if (complete) {
        const count = a.value.length + (other ? 1 : 0);
        if (count < (q.min ?? 1)) add(q.id, `\u81F3\u5C11\u9009\u62E9 ${q.min ?? 1} \u9879`);
        if (q.max !== void 0 && count > q.max) add(q.id, `\u6700\u591A\u9009\u62E9 ${q.max} \u9879`);
      }
    } else if (q.type === "toggle") {
      if (typeof a.value !== "boolean") add(q.id, "\u8BF7\u9009\u62E9\u5F00\u542F\u6216\u5173\u95ED");
    } else if (q.type === "number") {
      if (typeof a.value !== "number" || !Number.isFinite(a.value)) add(q.id, "\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57");
      else if (complete && (q.min !== void 0 && a.value < q.min || q.max !== void 0 && a.value > q.max)) add(q.id, "\u6570\u5B57\u8D85\u51FA\u5141\u8BB8\u8303\u56F4");
    } else if (!text(a.value, q.type === "text" ? 4e3 : 2e4) || complete && !a.value.trim()) add(q.id, "\u8BF7\u8F93\u5165\u6709\u6548\u5185\u5BB9");
  }
  return errors;
}

// electron/modules/questionnaire-store.ts
var QuestionnaireStore = class {
  records = /* @__PURE__ */ new Map();
  waiters = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  directory;
  constructor(dataRoot) {
    this.directory = path.join(dataRoot, "questionnaires");
    fs.mkdirSync(this.directory, { recursive: true });
    for (const filename of fs.readdirSync(this.directory)) {
      if (!filename.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.directory, filename), "utf8"));
        if (raw?.schemaRevision !== 1 || !raw.id || filename !== raw.id + ".json" || !raw.chatId || !raw.runId || validateQuestionnaireDefinition(raw).length || !raw.draft || !Number.isSafeInteger(raw.draft.revision) || raw.draft.revision < 0 || validateQuestionnaireAnswers(raw.questions, raw.draft.answers, raw.draft.supplement, false).length || !["pending", "submitted", "cancelled", "stale"].includes(raw.status)) continue;
        if (raw.status === "submitted" && (!raw.submission || validateQuestionnaireAnswers(raw.questions, raw.submission.answers, raw.submission.supplement).length)) continue;
        this.records.set(raw.id, raw);
      } catch {
      }
    }
  }
  onChanged(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  list(chatId) {
    return [...this.records.values()].filter((r) => !chatId || r.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt).map((r) => structuredClone(r));
  }
  get(id) {
    const value = this.records.get(id);
    return value ? structuredClone(value) : null;
  }
  require(id) {
    const record2 = this.get(id);
    if (!record2) throw Error("questionnaire_not_found");
    return record2;
  }
  commit(record2) {
    const filename = path.join(this.directory, record2.id + ".json"), temporary = filename + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(record2), "utf8");
      fs.renameSync(temporary, filename);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
      }
      throw error;
    }
    this.records.set(record2.id, structuredClone(record2));
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(record2));
      } catch (error) {
        console.warn("[questionnaire] listener failed", error);
      }
    }
    if (record2.status !== "pending") {
      const resolve = this.waiters.get(record2.id);
      if (resolve) {
        this.waiters.delete(record2.id);
        resolve(structuredClone(record2));
      }
    }
    return structuredClone(record2);
  }
  create(definition, owner) {
    const errors = validateQuestionnaireDefinition(definition);
    if (errors.length) throw Error("invalid_questionnaire: " + errors.join("\uFF1B"));
    if (this.list(owner.chatId).some((r) => r.status === "pending")) throw Error("questionnaire_already_pending");
    const now = Date.now(), record2 = { ...structuredClone(definition), ...structuredClone(owner), id: randomUUID(), schemaRevision: 1, status: "pending", createdAt: now, updatedAt: now, draft: { revision: 0, answers: {}, supplement: "", updatedAt: now } };
    return this.commit(record2);
  }
  saveDraft(id, input) {
    const record2 = this.require(id);
    if (record2.status !== "pending") return { ok: false, record: record2, error: "questionnaire_not_pending" };
    if (!input || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw Error("invalid_draft_revision");
    const errors = validateQuestionnaireAnswers(record2.questions, input.answers, input.supplement, false);
    if (errors.length) throw Error("invalid_questionnaire_draft: " + errors.map((e) => e.message).join("\uFF1B"));
    if (input.baseRevision !== record2.draft.revision) {
      const conflict = { ...structuredClone(input), id: randomUUID(), savedAt: Date.now() };
      record2.recoveries = [...record2.recoveries || [], conflict].slice(-20);
      record2.updatedAt = Date.now();
      return { ok: false, record: this.commit(record2), conflict, error: "questionnaire_draft_conflict" };
    }
    record2.draft = { revision: record2.draft.revision + 1, answers: structuredClone(input.answers), supplement: input.supplement, updatedAt: Date.now() };
    record2.updatedAt = Date.now();
    return { ok: true, record: this.commit(record2) };
  }
  submit(id, input) {
    const record2 = this.require(id);
    if (!input || typeof input.submissionId !== "string" || !input.submissionId || input.submissionId.length > 200 || /[\u0000-\u0020]/.test(input.submissionId)) throw Error("invalid_submission_id");
    if (record2.submission?.submissionId === input.submissionId) {
      if (input.answers !== void 0 && !isDeepStrictEqual(record2.submission.answers, input.answers) || input.supplement !== void 0 && record2.submission.supplement !== input.supplement) return { ok: false, record: record2, conflict: true, error: "submission_id_conflict" };
      return { ok: true, record: record2 };
    }
    if (record2.status !== "pending") return { ok: false, record: record2, error: "questionnaire_not_pending", conflict: !!record2.submission };
    if (input.revision !== record2.draft.revision || input.answers !== void 0 && !isDeepStrictEqual(input.answers, record2.draft.answers) || input.supplement !== void 0 && input.supplement !== record2.draft.supplement) return { ok: false, record: record2, conflict: true, error: "questionnaire_draft_conflict" };
    const errors = validateQuestionnaireAnswers(record2.questions, record2.draft.answers, record2.draft.supplement);
    if (errors.length) return { ok: false, record: record2, errors, error: "questionnaire_answers_invalid" };
    record2.submission = { submissionId: input.submissionId, submittedAt: Date.now(), revision: record2.draft.revision, answers: structuredClone(record2.draft.answers), supplement: record2.draft.supplement };
    record2.status = "submitted";
    record2.updatedAt = Date.now();
    record2.continuation = { state: "pending" };
    return { ok: true, record: this.commit(record2) };
  }
  cancel(id, reason = "cancelled") {
    const record2 = this.require(id);
    if (record2.status !== "pending") return { ok: false, record: record2, error: "questionnaire_not_pending" };
    record2.status = ["stopped", "deleted", "replaced"].includes(reason) ? "stale" : "cancelled";
    record2.cancelReason = String(reason).slice(0, 200);
    record2.updatedAt = Date.now();
    return { ok: true, record: this.commit(record2) };
  }
  invalidateChat(chatId, reason = "stopped") {
    let count = 0;
    for (const record2 of this.list(chatId)) {
      if (record2.status === "pending") {
        this.cancel(record2.id, reason);
        count++;
      } else if (record2.status === "submitted" && record2.continuation?.state !== "done") {
        record2.continuation = { ...record2.continuation, state: "done", error: reason };
        record2.updatedAt = Date.now();
        this.commit(record2);
        count++;
      }
    }
    return count;
  }
  removeChat(chatId) {
    this.invalidateChat(chatId, "deleted");
    for (const record2 of this.list(chatId)) {
      fs.unlinkSync(path.join(this.directory, record2.id + ".json"));
      this.records.delete(record2.id);
    }
  }
  hasWaiter(id) {
    return this.waiters.has(id);
  }
  wait(id, signal) {
    const record2 = this.require(id);
    if (record2.status !== "pending") return Promise.resolve(record2);
    if (signal.aborted) return Promise.reject(Error("aborted"));
    if (this.waiters.has(id)) throw Error("questionnaire_already_waiting");
    return new Promise((resolve, reject) => {
      const aborted = () => {
        this.waiters.delete(id);
        reject(Error("aborted"));
      };
      this.waiters.set(id, (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      });
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
  setContinuation(id, continuation) {
    const record2 = this.require(id);
    record2.continuation = continuation;
    record2.updatedAt = Date.now();
    return this.commit(record2);
  }
  finishRun(runId) {
    for (const record2 of this.list()) if (record2.status === "submitted" && record2.continuation?.state === "claimed" && record2.continuation.runId === runId) this.setContinuation(record2.id, { state: "done", runId });
  }
  releaseRun(runId) {
    for (const record2 of this.list()) if (record2.status === "submitted" && record2.continuation?.state === "claimed" && record2.continuation.runId === runId) this.setContinuation(record2.id, { state: "pending" });
  }
};

// electron/modules/agent-runtime-policy.test.ts
import { EventEmitter } from "node:events";

// electron/modules/browser-automation-controller.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// shared/pointer-trajectory.ts
var TWO_PI = Math.PI * 2;

// electron/modules/pointer-motion.ts
var states = /* @__PURE__ */ new WeakMap();
function reset(state, reason = "explicit_invalidation") {
  state.position = void 0;
  state.invalidationReason = reason;
  state.generation++;
}
function invalidatePointerMotion(wc, reason = "external_input_or_geometry_change") {
  const state = states.get(wc);
  if (state) reset(state, reason);
}

// shared/browser-cursor.ts
var color = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255];
var polygon = (hex, points) => ({ kind: "polygon", color: color(hex), points });
var line = (hex, width, points) => ({ kind: "line", color: color(hex), width, points });
var circle = (hex, x, y, radius) => ({ kind: "ring", color: color(hex), x, y, radius: 0, width: radius * 2 });
var arc = (hex, width, radius, start, end) => {
  const steps = Math.ceil((end - start) / 8);
  return line(hex, width, Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (start + (end - start) * i / steps) * Math.PI / 180;
    return [16 + radius * Math.cos(angle), 16 + radius * Math.sin(angle)];
  }));
};
function browserCursorDesign(style, scale = 1) {
  if (!Number.isFinite(scale) || scale < 0.75 || scale > 2) throw new RangeError("Cursor size must be between 75% and 200%");
  let hotspot = { x: 16, y: 16 };
  const shapes = [];
  const outline = (hex, width, points) => {
    shapes.push(line(hex, width, [...points, points[0]]));
  };
  if (style === "windows-glow" || style === "windows-standard") {
    hotspot = { x: 4, y: 2 };
    const arrow = [[4, 2], [4, 25.5], [9.6, 20.3], [14.5, 30], [18.8, 27.8], [14, 18.4], [22.5, 18.4]];
    shapes.push(polygon("ffffff", arrow));
    outline("101820", 1.1, arrow);
  } else if (style === "navora-arrow") {
    hotspot = { x: 3, y: 2 };
    const arrow = [[3, 2], [28, 14.5], [18.3, 18.8], [15, 30]];
    shapes.push(polygon("0b1733", arrow));
    outline("5cefff", 1.25, arrow);
    shapes.push(
      polygon("3576f4", [[4.4, 4.1], [13, 14.2], [15, 27.6], [5.2, 7]]),
      polygon("173b6b", [[4.4, 4.1], [25.2, 14.2], [13, 14.2]]),
      line("e8ffff", 1, [[3.8, 3.3], [13, 14.2], [15, 27.8]]),
      line("ff56cf", 1.7, [[18.4, 18.7], [15.2, 29]])
    );
  } else if (style === "focus-ring") {
    shapes.push(circle("08182ad9", 16, 16, 10.7));
    for (const [start, end] of [[8, 70], [100, 160], [190, 250], [280, 340]]) shapes.push(arc("06202d", 3.2, 11.6, start, end), arc("45e9ff", 1.4, 11.6, start, end));
    shapes.push(
      line("65b9ff", 1.4, [[3.5, 10], [3.5, 6.5], [7, 3], [11, 3]]),
      line("65b9ff", 1.4, [[21, 29], [25, 29], [28.5, 25.5], [28.5, 22]]),
      line("ff61c8", 1.8, [[16, 1], [16, 5]]),
      line("7ceaff", 1.1, [[16, 27], [16, 31]])
    );
    for (const points of [[[11, 16], [13, 16]], [[19, 16], [21, 16]], [[16, 11], [16, 13]], [[16, 19], [16, 21]]]) shapes.push(line("8fefff", 1, points));
    shapes.push(circle("ffffff", 16, 16, 1.5));
  } else if (style === "precision-cross") {
    const arms = [
      [[13, 3], [16, 0], [19, 3], [19, 10], [16, 8], [13, 10]],
      [[22, 13], [29, 13], [32, 16], [29, 19], [22, 19], [24, 16]],
      [[13, 22], [16, 24], [19, 22], [19, 29], [16, 32], [13, 29]],
      [[0, 16], [3, 13], [10, 13], [8, 16], [10, 19], [3, 19]]
    ];
    for (const arm of arms) {
      shapes.push(polygon("10213c", arm));
      outline("57ddff", 0.9, arm);
    }
    shapes.push(
      line("f0ffff", 1.2, [[16, 2], [16, 7]]),
      line("edffff", 1.2, [[25, 16], [30, 16]]),
      line("487bff", 1.6, [[16, 25], [16, 30]]),
      line("ed65d0", 1.2, [[2, 16], [7, 16]]),
      polygon("b9faff", [[16, 13], [19, 16], [16, 19], [13, 16]]),
      circle("ffffff", 16, 16, 0.75)
    );
  } else if (style === "ice-arrow") {
    hotspot = { x: 4, y: 2 };
    const arrow = [[4, 2], [27, 17], [16.3, 18.5], [21.4, 28], [16.7, 30.5], [11.5, 21], [4, 28]];
    shapes.push(polygon("0a2338", arrow));
    outline("68edff", 1.1, arrow);
    shapes.push(
      polygon("c5f5ff", [[6, 6], [22.5, 16], [13.7, 17.2], [18.8, 27], [17.4, 27.6], [11.7, 17.5], [6, 23]]),
      line("3b8bff", 1.3, [[1, 8], [1, 19]]),
      line("fc59ca", 1.3, [[25, 24], [28, 27]])
    );
  } else if (style === "diamond") {
    const corners = [[[4, 12], [4, 8], [8, 4], [12, 4]], [[20, 4], [24, 4], [28, 8], [28, 12]], [[28, 20], [28, 24], [24, 28], [20, 28]], [[12, 28], [8, 28], [4, 24], [4, 20]]];
    for (const points of corners) shapes.push(line("0d2442", 3.2, points), line("5feaff", 1.3, points));
    const diamond = [[16, 8], [24, 16], [16, 24], [8, 16]];
    shapes.push(polygon("102744", diamond));
    outline("81efff", 1.1, diamond);
    shapes.push(polygon("7fdaff", [[16, 9.3], [22.3, 16], [16, 16]]), polygon("417cf7", [[16, 16], [16, 22.3], [9.7, 16]]), line("f273d5", 1.7, [[25, 25], [28, 22]]), circle("ffffff", 16, 16, 1.1));
  } else {
    shapes.push(
      circle("10213bc0", 16, 16, 9.6),
      { kind: "ring", color: color("267bce"), x: 16, y: 16, radius: 9.6, width: 1 },
      arc("b5fbff", 1.6, 10, 225, 315),
      arc("f166ce", 1.5, 10, 45, 110),
      circle("258ef8", 16, 16, 4.4),
      { kind: "ring", color: color("6eeaff"), x: 16, y: 16, radius: 4.4, width: 1.1 },
      circle("ffffff", 16, 16, 1.8)
    );
    for (const points of [[[16, 1], [16, 3]], [[29, 16], [31, 16]], [[16, 29], [16, 31]], [[1, 16], [3, 16]]]) shapes.push(line("5be9ff", 1.2, points));
  }
  const coordinate = (value) => (24 + value) * scale;
  return {
    size: 80 * scale,
    hotspot: { x: Math.round(coordinate(hotspot.x)), y: Math.round(coordinate(hotspot.y)) },
    shapes: shapes.map((shape) => shape.kind === "ring" ? { ...shape, x: coordinate(shape.x), y: coordinate(shape.y), radius: shape.radius * scale, width: shape.width * scale } : { ...shape, points: shape.points.map(([x, y]) => [coordinate(x), coordinate(y)]), ...shape.kind === "line" ? { width: shape.width * scale } : {} }),
    glow: style === "windows-standard" ? [] : [
      { spread: 3 * scale, blur: 7.8 * scale, opacity: 1.35, color: color("1c72ff") },
      { spread: 2 * scale, blur: 4.2 * scale, opacity: 0.85, color: color("2889ff") },
      { spread: 0.7 * scale, blur: 1.1 * scale, opacity: 0.72, color: color("40afff") }
    ]
  };
}

// electron/modules/browser-native-cursor.ts
function contains(shape, x, y) {
  if (shape.kind === "ring") return Math.abs(Math.hypot(x - shape.x, y - shape.y) - shape.radius) <= shape.width / 2;
  const points = shape.points;
  if (shape.kind === "line") {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (shape.width / 2) ** 2) return true;
    }
    return false;
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function bounds(shape) {
  if (shape.kind === "ring") {
    const r2 = shape.radius + shape.width / 2;
    return [shape.x - r2, shape.y - r2, shape.x + r2, shape.y + r2];
  }
  const r = shape.kind === "line" ? shape.width / 2 : 0;
  return [
    Math.min(...shape.points.map((p) => p[0])) - r,
    Math.min(...shape.points.map((p) => p[1])) - r,
    Math.max(...shape.points.map((p) => p[0])) + r,
    Math.max(...shape.points.map((p) => p[1])) + r
  ];
}
function dilate(source, width, radius) {
  const horizontal = new Float32Array(source.length), out = new Float32Array(source.length);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let offset = -radius; offset <= radius; offset++) if (x + offset >= 0 && x + offset < width) value = Math.max(value, source[y * width + x + offset]);
    horizontal[y * width + x] = value;
  }
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let offset = -radius; offset <= radius; offset++) if (y + offset >= 0 && y + offset < width) value = Math.max(value, horizontal[(y + offset) * width + x]);
    out[y * width + x] = value;
  }
  return out;
}
function blur(source, width, sigma) {
  const ideal = Math.sqrt(4 * sigma * sigma + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower);
  const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  let current = source;
  for (let pass = 0; pass < 3; pass++) {
    const radius = ((pass < count ? lower : lower + 2) - 1) / 2, divisor = radius * 2 + 1;
    const horizontal = new Float32Array(source.length), out = new Float32Array(source.length);
    for (let y = 0; y < width; y++) {
      let sum = 0;
      for (let x = 0; x <= radius && x < width; x++) sum += current[y * width + x];
      for (let x = 0; x < width; x++) {
        horizontal[y * width + x] = sum / divisor;
        if (x - radius >= 0) sum -= current[y * width + x - radius];
        if (x + radius + 1 < width) sum += current[y * width + x + radius + 1];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y <= radius && y < width; y++) sum += horizontal[y * width + x];
      for (let y = 0; y < width; y++) {
        out[y * width + x] = sum / divisor;
        if (y - radius >= 0) sum -= horizontal[(y - radius) * width + x];
        if (y + radius + 1 < width) sum += horizontal[(y + radius + 1) * width + x];
      }
    }
    current = out;
  }
  return current;
}
function rasterizeBrowserCursor(style, scaleFactor = 1, visible = true, cursorScale = 1) {
  if (![1, 1.25, 1.5, 2, 3].includes(scaleFactor)) throw new RangeError("Unsupported cursor image scale");
  const design = browserCursorDesign(style, cursorScale), width = Math.round(design.size * scaleFactor);
  const bitmap = Buffer.alloc(width * width * 4);
  if (!visible) return { bitmap, width, height: width, scaleFactor, hotspot: design.hotspot };
  const body = new Float32Array(bitmap.length), alpha = new Float32Array(width * width);
  const shapes = design.shapes.map((shape) => ({ shape, bounds: bounds(shape) }));
  const extent = [
    Math.min(...shapes.map((s) => s.bounds[0])),
    Math.min(...shapes.map((s) => s.bounds[1])),
    Math.max(...shapes.map((s) => s.bounds[2])),
    Math.max(...shapes.map((s) => s.bounds[3]))
  ];
  for (let y = Math.max(0, Math.floor(extent[1] * scaleFactor)); y < Math.min(width, Math.ceil(extent[3] * scaleFactor)); y++) {
    for (let x = Math.max(0, Math.floor(extent[0] * scaleFactor)); x < Math.min(width, Math.ceil(extent[2] * scaleFactor)); x++) {
      const channels = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = (x + (sx + 0.5) / 4) / scaleFactor, py = (y + (sy + 0.5) / 4) / scaleFactor;
        const sample = [0, 0, 0, 0];
        for (const { shape, bounds: [left, top, right, bottom] } of shapes) {
          if (px < left || px > right || py < top || py > bottom || !contains(shape, px, py)) continue;
          const a = shape.color[3] / 255;
          for (let channel = 0; channel < 3; channel++) sample[channel] = shape.color[2 - channel] * a + sample[channel] * (1 - a);
          sample[3] = shape.color[3] + sample[3] * (1 - a);
        }
        for (let channel = 0; channel < 4; channel++) channels[channel] += sample[channel] / 16;
      }
      const offset = (y * width + x) * 4;
      body.set(channels, offset);
      alpha[y * width + x] = channels[3];
    }
  }
  const composed = new Float32Array(bitmap.length);
  for (const glow of design.glow) {
    const mask = blur(dilate(alpha, width, Math.round(glow.spread * scaleFactor)), width, glow.blur * scaleFactor);
    for (let index = 0; index < mask.length; index++) {
      const a = Math.max(0, Math.min(1, mask[index] * glow.opacity / 255)), offset = index * 4;
      for (let channel = 0; channel < 3; channel++) composed[offset + channel] = glow.color[2 - channel] * a + composed[offset + channel] * (1 - a);
      composed[offset + 3] = a * 255 + composed[offset + 3] * (1 - a);
    }
  }
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const remaining = 1 - body[offset + 3] / 255;
    for (let channel = 0; channel < 4; channel++) bitmap[offset + channel] = Math.round(body[offset + channel] + composed[offset + channel] * remaining);
  }
  return { bitmap, width, height: width, scaleFactor, hotspot: design.hotspot };
}
var images = /* @__PURE__ */ new Map();
async function createBrowserCursorImage(style, visible, cursorScale = 1) {
  browserCursorDesign(style, cursorScale);
  const key = `${style}:${visible}:${cursorScale}`, cached = images.get(key);
  if (cached) {
    images.delete(key);
    images.set(key, cached);
    return cached;
  }
  const { nativeImage } = await import("electron");
  const variants = [1, 1.25, 1.5, 2, 3].map((scale) => rasterizeBrowserCursor(style, scale, visible, cursorScale));
  const primary = variants[0];
  const image = nativeImage.createFromBitmap(primary.bitmap, { width: primary.width, height: primary.height, scaleFactor: 1 });
  for (const variant of variants.slice(1)) {
    const representation = nativeImage.createFromBitmap(variant.bitmap, { width: variant.width, height: variant.height, scaleFactor: variant.scaleFactor });
    image.addRepresentation({ scaleFactor: variant.scaleFactor, buffer: representation.toPNG({ scaleFactor: variant.scaleFactor }) });
  }
  const result = { image, hotspot: primary.hotspot };
  images.set(key, result);
  if (images.size > 16) images.delete(images.keys().next().value);
  return result;
}

// electron/modules/browser-automation-controller.ts
var BrowserAutomationError = class extends Error {
  constructor(code, message = code, diagnostic) {
    super(message);
    this.code = code;
    this.name = "BrowserAutomationError";
    const cause = code === "browser_document_changed" ? "document_changed" : code === "browser_geometry_changed" ? "geometry_changed" : code === "browser_page_destroyed" ? "page_destroyed" : code === "renderer_gone" ? "renderer_gone" : ["cleanup_unconfirmed", "release_unconfirmed"].includes(code) ? "native_cleanup_unconfirmed" : code === "aborted" ? "run_cancelled" : "unknown";
    this.diagnostic = { cause, stage: cause === "native_cleanup_unconfirmed" ? "cleanup" : "before_dispatch", requiresObservation: true, ...diagnostic };
  }
  lastResult;
  pageBlocker;
  diagnostic;
};
var controllers = /* @__PURE__ */ new WeakMap();
var live = /* @__PURE__ */ new Set();
var settings = createDefaultBrowserAutomation();
var revision = 0;
function getBrowserAutomationController(wc, options) {
  let controller = controllers.get(wc);
  if (!controller) {
    controller = new BrowserAutomationController(wc, options);
    controllers.set(wc, controller);
  } else if (options) controller.bind(options);
  return controller;
}
var BrowserAutomationController = class {
  constructor(wc, options = {}) {
    this.wc = wc;
    this.options = options;
    this.config = normalizeBrowserAutomation(options.getSettings?.() ?? settings);
    this.state.revision = revision;
    const api = wc;
    this.state.cursorAvailable = !!(api.setAutomationOptions && api.getAutomationState && api.resetAutomationOptions);
    this.state.cursorImageAvailable = typeof api.setVirtualCursorImage === "function";
    live.add(this);
    this.listen("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame === false || inPlace) return;
      this.documentEpoch++;
      this.expirePageBlocker("DOCUMENT_CHANGED");
      if (!this.active) this.observationRequired = true;
      invalidatePointerMotion(wc);
      this.publish();
    });
    this.listen("did-navigate", () => {
      this.unsafeCleanup = false;
      if (this.state.error === "cleanup_unconfirmed" && this.state.nativeConfirmed && !this.state.inputProtected) {
        this.state.error = void 0;
        if (!this.active && !this.state.nativePending && this.state.activity !== "handoff") {
          this.state.activity = "idle";
          this.state.handoffTarget = void 0;
        }
      }
      this.publish();
    });
    this.listen("did-navigate-in-page", () => {
      this.documentEpoch++;
      this.expirePageBlocker("DOCUMENT_CHANGED");
      invalidatePointerMotion(wc);
      this.publish();
    });
    this.listen("render-process-gone", () => {
      this.documentEpoch++;
      this.unsafeCleanup = false;
      this.expirePageBlocker("RENDERER_GONE");
      this.invalidate("renderer_gone");
      this.state.owner = "paused";
      this.state.activity = "error";
      this.state.error = "renderer_gone";
      this.publish();
    });
    this.listen("destroyed", () => this.dispose());
    const intervention = (_event, input) => {
      if (input?.type && /^(mouseMove[d]?|mouseEnter[ed]*|mouseLeave|mouseExit[ed]*|pointerMove[d]?|pointerEnter[ed]*|pointerLeave)$/i.test(input.type)) return;
      if (this.disposed || this.active || this.options.getManualControl?.() || this.state.inputProtected || this.state.owner !== "ai" || !["idle", "waiting"].includes(this.state.activity)) return;
      void this.pause().catch(() => {
      });
    };
    this.listen("before-mouse-event", intervention);
    this.listen("before-input-event", intervention);
  }
  state = createBrowserAutomationState();
  options;
  config;
  tail = Promise.resolve();
  controls = Promise.resolve();
  nativeTail = Promise.resolve();
  admission = Promise.resolve();
  externalPending = /* @__PURE__ */ new Set();
  active;
  controlGeneration = 0;
  nativeCancellationGeneration;
  nativeCancellationBarrier;
  gated = false;
  disposed = false;
  documentEpoch = 0;
  observationRequired = false;
  leaseRunId;
  cancelledRun;
  cursorImageKey;
  unsafeCleanup = false;
  stateRevision = 0;
  wasBusy = false;
  controlWaitStartedAt;
  controlWaitTimer;
  manualSession;
  epochWatchers = /* @__PURE__ */ new Set();
  listeners = [];
  recheckPageBlocker;
  blockerRecheck;
  bind(options) {
    this.options = { ...this.options, ...options };
  }
  listen(event, fn) {
    this.listeners.push({ event, fn });
    this.wc.on(event, fn);
  }
  publish() {
    const waiting = !this.disposed && (this.state.activity === "handoff" || this.state.nativePending);
    if (waiting && this.controlWaitStartedAt === void 0) {
      this.controlWaitStartedAt = Date.now();
      this.controlWaitTimer = setTimeout(() => {
        this.controlWaitTimer = void 0;
        if (!this.disposed && this.controlWaitStartedAt !== void 0) this.publish();
      }, this.options.controlWaitWarningMs ?? 15e3);
      this.controlWaitTimer.unref?.();
    } else if (!waiting) {
      if (this.controlWaitTimer) clearTimeout(this.controlWaitTimer);
      this.controlWaitTimer = void 0;
      this.controlWaitStartedAt = void 0;
    }
    const busy = this.isBusy(), becameIdle = this.wasBusy && !busy;
    this.wasBusy = busy;
    this.stateRevision++;
    this.options.onChanged?.(this.snapshot());
    if (becameIdle && !this.disposed) queueMicrotask(() => {
      if (!this.disposed && !this.isBusy()) this.options.onIdle?.();
    });
  }
  snapshot() {
    return {
      ...structuredClone(this.state),
      epoch: this.state.epoch,
      documentEpoch: this.documentEpoch,
      stateRevision: this.stateRevision,
      needsObservation: this.observationRequired,
      leaseRunId: this.leaseRunId,
      ...this.controlWaitStartedAt === void 0 ? {} : { controlWait: {
        stage: this.state.nativePending ? "native" : this.active?.commits.size ? "submitted-input" : this.active?.cleaning ? "cleanup" : this.active ? "operation" : this.externalPending.size ? "navigation" : "queued",
        startedAt: this.controlWaitStartedAt,
        elapsedMs: Math.max(0, Date.now() - this.controlWaitStartedAt),
        overdue: Date.now() - this.controlWaitStartedAt >= (this.options.controlWaitWarningMs ?? 15e3),
        committedInputs: this.active?.commits.size ?? 0,
        pendingNavigation: this.externalPending.size
      } },
      ...this.options.getManualControl?.() && this.state.owner === "ai" && this.state.activity !== "handoff" && this.state.nativeConfirmed && !this.state.nativePending && !this.state.inputProtected ? { owner: "user" } : {}
    };
  }
  captureEpoch() {
    return this.state.epoch;
  }
  captureDocumentEpoch() {
    return this.documentEpoch;
  }
  setPageBlocker(summary, recheck) {
    if (this.disposed || summary.webContentsId !== this.wc.id || summary.documentEpoch !== this.documentEpoch || summary.controlEpoch !== this.state.epoch) return false;
    this.state.pageBlocker = summary;
    this.recheckPageBlocker = recheck;
    this.publish();
    return true;
  }
  expirePageBlocker(reason) {
    if (!this.state.pageBlocker) return;
    this.state.pageBlocker = { ...this.state.pageBlocker, ...this.state.pageBlocker.requiresUser ? { previouslyBlockedAt: this.state.pageBlocker.observedAt } : {}, state: "unknown", requiresUser: false, blocksInteraction: "unknown", coverage: "unavailable", reasonCodes: [reason], documentEpoch: this.documentEpoch, controlEpoch: this.state.epoch, followup: "none", evidence: [] };
  }
  /** A user completion statement requests a fresh observation, never proof or replay. */
  async recheckBlocker() {
    if (!this.recheckPageBlocker) return this.state.pageBlocker;
    if (!this.blockerRecheck) this.blockerRecheck = this.recheckPageBlocker().finally(() => {
      this.blockerRecheck = void 0;
    });
    return this.blockerRecheck;
  }
  /** Actual viewport/zoom changes invalidate coordinates without granting control. */
  geometryChanged() {
    if (this.disposed) return;
    this.advanceEpoch();
    this.observationRequired = true;
    this.expirePageBlocker("GEOMETRY_CHANGED");
    this.active?.abort.abort(new BrowserAutomationError("browser_geometry_changed"));
    invalidatePointerMotion(this.wc);
    this.publish();
  }
  watchEpoch(epoch, onInvalidated) {
    if (epoch !== this.state.epoch || this.disposed) {
      onInvalidated();
      return () => {
      };
    }
    this.epochWatchers.add(onInvalidated);
    return () => {
      this.epochWatchers.delete(onInvalidated);
    };
  }
  needsObservation() {
    return this.observationRequired;
  }
  noteObservation(epoch, documentEpoch) {
    this.assertEpoch(epoch);
    if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError("browser_document_changed");
    if (this.active) this.active.observedDocEpoch = documentEpoch;
    this.observationRequired = false;
    this.publish();
  }
  assertEpoch(epoch, options) {
    if (this.disposed || this.wc.isDestroyed()) throw new BrowserAutomationError("browser_page_destroyed");
    if (epoch !== this.state.epoch) throw new BrowserAutomationError("browser_operation_invalidated", "browser_operation_invalidated", { expectedEpoch: epoch, actualEpoch: this.state.epoch, actualDocumentEpoch: this.documentEpoch, dispatched: false });
    if (!options?.readOnly && (this.gated || this.state.owner !== "ai" || this.options.getManualControl?.())) throw new BrowserAutomationError("browser_manual_control");
  }
  isBusy() {
    return !!this.active || this.externalPending.size > 0 || this.state.nativePending;
  }
  /** A just-created Agent page has no previous document credential to reuse. */
  claimRun(runId) {
    if (this.manualSession) return Promise.reject(new BrowserAutomationError("browser_manual_control"));
    if (!runId) return Promise.reject(new TypeError("A browser task id is required"));
    const epoch = this.captureEpoch();
    const pending = this.tail;
    const applied = this.serializeControl(async () => {
      await pending;
      this.assertEpoch(epoch);
      if (this.leaseRunId && this.leaseRunId !== runId) throw new BrowserAutomationError("browser_page_in_use");
      this.leaseRunId = runId;
      this.state.activity = "acting";
      this.publish();
      try {
        await this.syncNative(this.config.show_virtual_cursor, true);
      } catch (error) {
        if (this.state.epoch === epoch) {
          try {
            await this.syncNative(false, false);
            this.leaseRunId = void 0;
            this.state.activity = "error";
            this.state.error = error instanceof Error ? error.message : String(error);
          } catch {
            this.invalidate("release_unconfirmed");
            this.state.owner = "paused";
            this.state.activity = "error";
            this.state.error = "release_unconfirmed";
          }
          this.publish();
        }
        throw error;
      }
      this.assertEpoch(epoch);
      this.state.activity = "waiting";
      this.publish();
      return this.snapshot();
    });
    this.admission = applied.then(() => {
    }, () => {
    });
    return applied;
  }
  /** Register work already submitted outside an action, such as initial navigation. */
  trackPending(pending) {
    this.externalPending.add(pending);
    this.publish();
    const settled = () => {
      this.externalPending.delete(pending);
      this.publish();
    };
    void pending.then(settled, settled);
    return pending;
  }
  /** A native stop/cleanup could not be confirmed; fresh reads alone cannot unlock it. */
  markUncertain(reason) {
    this.noteResult({ status: "failed", reason, dispatchedCount: null });
    if (!this.gated) void this.pause().catch(() => {
    });
    else {
      this.state.owner = "paused";
      this.state.activity = "error";
      this.publish();
    }
  }
  async drain(pending) {
    await pending;
    while (this.externalPending.size) await Promise.allSettled([...this.externalPending]);
  }
  advanceEpoch() {
    this.state.epoch++;
    const watchers = [...this.epochWatchers];
    this.epochWatchers.clear();
    for (const notify of watchers) {
      try {
        notify();
      } catch {
      }
    }
  }
  invalidate(reason) {
    this.gated = true;
    this.controlGeneration++;
    this.advanceEpoch();
    this.observationRequired = true;
    this.active?.abort.abort(new BrowserAutomationError(reason));
    invalidatePointerMotion(this.wc);
  }
  serializeControl(action) {
    const result = this.controls.then(action);
    this.controls = result.then(() => {
    }, () => {
    });
    return result;
  }
  readNative(api) {
    if (!api.getAutomationState) throw new BrowserAutomationError("automation_api_unavailable");
    const actual = api.getAutomationState.call(this.wc);
    const rendering = actual.rendering;
    this.state.isolateInput = actual.isolateInput;
    this.state.keepRendering = actual.keepRendering;
    this.state.inputProtected = actual.blockRealPointer === true && actual.blockRealKeyboard === true;
    this.state.cursorEnabled = actual.virtualCursor?.enabled === true;
    this.state.cursorVisible = this.state.cursorEnabled;
    this.state.rendering = rendering ? { ...rendering } : void 0;
    return actual;
  }
  confirmNative(api, enabled, protect, reset2 = false) {
    const actual = this.readNative(api);
    if (actual.isolateInput !== protect || actual.blockRealPointer !== protect || actual.blockRealKeyboard !== protect || actual.keepRendering !== protect || actual.virtualCursor?.enabled !== enabled || reset2 && actual.inputActive !== false) {
      throw new BrowserAutomationError("automation_configuration_unconfirmed");
    }
    if (protect && (!this.state.rendering?.viewAvailable || !this.state.rendering.keepAlive || this.state.rendering.effectiveBackgroundThrottling !== false)) {
      throw new BrowserAutomationError("automation_rendering_unavailable");
    }
    this.state.nativeConfirmed = true;
  }
  syncNative(enabled, protect, expectedGeneration) {
    const operation = this.nativeTail.then(async () => {
      if (this.disposed || this.wc.isDestroyed()) throw new BrowserAutomationError("browser_page_destroyed");
      if (expectedGeneration !== void 0 && expectedGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
      const api = this.wc;
      this.state.nativePending = true;
      this.publish();
      try {
        if (!api.setAutomationOptions || !api.getAutomationState || !api.resetAutomationOptions) {
          throw new BrowserAutomationError("automation_api_unavailable");
        }
        if (!protect) {
          await api.resetAutomationOptions.call(this.wc);
          this.cursorImageKey = void 0;
          this.confirmNative(api, false, false, true);
        }
        if (protect || enabled) {
          const virtualCursor = { enabled, frameRate: this.config.cursor_fps };
          const imageKey = `${this.config.cursor_style}:${this.config.cursor_scale}`;
          if (enabled && api.setVirtualCursorImage && imageKey !== this.cursorImageKey) {
            const cursor = await (this.options.getCursorImage ?? createBrowserCursorImage)(this.config.cursor_style, true, this.config.cursor_scale);
            virtualCursor.image = cursor.image;
            virtualCursor.hotspot = cursor.hotspot;
          }
          await api.setAutomationOptions.call(this.wc, {
            isolateInput: protect,
            blockRealPointer: protect,
            blockRealKeyboard: protect,
            keepRendering: protect,
            virtualCursor
          });
          this.confirmNative(api, enabled, protect);
          if (enabled) this.cursorImageKey = imageKey;
        }
        if (this.disposed) return;
        this.state.cursorStyle = this.config.cursor_style;
      } catch (error) {
        if (!this.disposed) {
          try {
            this.readNative(api);
          } catch {
          }
          this.state.nativeConfirmed = false;
        }
        throw error;
      } finally {
        if (!this.disposed) {
          this.state.nativePending = false;
          this.publish();
        }
      }
    });
    this.nativeTail = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  noteResult(result, seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (!result || typeof result !== "object" || seen.has(result) || depth > 6 || seen.size > 1e3) return;
    seen.add(result);
    if (Array.isArray(result)) {
      for (const item of result) this.noteResult(item, seen, depth + 1);
      return;
    }
    const value = result;
    const cleanup = value.cleanup;
    const warning = typeof value.deliveryWarning === "string" ? value.deliveryWarning : "";
    const reason = typeof value.reason === "string" ? value.reason : typeof value.error === "string" ? value.error : warning || void 0;
    const failed = value.ok === false || value.status === "failed" || value.status === "cancelled";
    const expectedResetCancellation = reason === "AUTOMATION_RESET" && this.nativeCancellationGeneration === this.controlGeneration;
    const unsafe = (cleanup?.failed ?? 0) > 0 || !!reason?.includes("PARTIAL_CLICK_SEQUENCE") || !!warning || failed && value.dispatchedCount === null && !expectedResetCancellation;
    if ((unsafe || !this.unsafeCleanup) && (typeof value.status === "string" || reason || cleanup)) {
      this.state.lastResult = {
        ...typeof value.status === "string" ? { status: value.status } : {},
        ...reason ? { reason } : {},
        ...typeof value.dispatchedCount === "number" || value.dispatchedCount === null ? { dispatchedCount: value.dispatchedCount } : {},
        ...cleanup && typeof cleanup.dispatched === "number" && typeof cleanup.failed === "number" ? { cleanup: { dispatched: cleanup.dispatched, failed: cleanup.failed } } : {}
      };
    }
    if (unsafe) {
      this.unsafeCleanup = true;
      this.observationRequired = true;
      this.state.error = "cleanup_unconfirmed";
    }
    for (const key of ["dispatch", "clickDispatch", "steps", "failedResult", "result", "results"]) this.noteResult(value[key], seen, depth + 1);
    this.publish();
  }
  run(options, action) {
    if (this.manualSession) return Promise.reject(new BrowserAutomationError("browser_manual_control"));
    const guardsInput = !options.readOnly || options.claimInput === true;
    const permissionOptions = { readOnly: !guardsInput };
    const epoch = options.expectedEpoch ?? this.captureEpoch();
    const documentEpoch = options.expectedDocumentEpoch ?? this.documentEpoch;
    const admission = this.admission;
    try {
      this.assertEpoch(epoch, permissionOptions);
    } catch (error) {
      return Promise.reject(error);
    }
    const queued = this.tail.then(async () => {
      await admission;
      this.assertEpoch(epoch, permissionOptions);
      if (guardsInput && this.leaseRunId && this.leaseRunId !== options.runId) throw new BrowserAutomationError("browser_page_in_use");
      if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError("browser_document_changed", "browser_document_changed", { expectedDocumentEpoch: documentEpoch, actualDocumentEpoch: this.documentEpoch, expectedEpoch: epoch, actualEpoch: this.state.epoch, dispatched: false });
      if (options.signal?.aborted) throw new BrowserAutomationError("aborted");
      const abort = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
      const active = { abort, commits: /* @__PURE__ */ new Set(), nativeCommits: /* @__PURE__ */ new Set(), cleanups: /* @__PURE__ */ new Set(), nativeResetConfirmed: false, observedDocEpoch: documentEpoch, accepting: true };
      this.active = active;
      this.state.activeOperations = 1;
      const previousActivity = this.state.activity;
      const previousError = this.state.error;
      this.state.label = options.label;
      if (guardsInput) {
        this.state.error = void 0;
        this.state.lastResult = void 0;
        this.state.activity = "acting";
      }
      this.publish();
      const assertCurrent = () => {
        if (!active.accepting || this.active !== active) throw new BrowserAutomationError("browser_operation_invalidated");
        this.assertEpoch(epoch, permissionOptions);
        if (signal.aborted) throw new BrowserAutomationError("aborted");
      };
      const operation = {
        signal,
        epoch,
        get documentEpoch() {
          return active.observedDocEpoch;
        },
        assertCurrent,
        noteResult: (result2) => {
          if (this.active === active) this.noteResult(result2);
        },
        registerCleanup: (cleanup) => {
          assertCurrent();
          active.cleanups.add(cleanup);
          return () => {
            active.cleanups.delete(cleanup);
          };
        },
        track: async (submitted) => {
          assertCurrent();
          const pending = submitted();
          active.commits.add(pending);
          try {
            return await pending;
          } finally {
            active.commits.delete(pending);
          }
        },
        commit: async (native) => {
          assertCurrent();
          active.submittedInput = true;
          const pending = native();
          active.commits.add(pending);
          active.nativeCommits.add(pending);
          try {
            const result2 = await pending;
            this.noteResult(result2);
            return result2;
          } catch (error) {
            this.noteResult({ status: "failed", dispatchedCount: null, reason: error instanceof Error ? error.message : String(error) });
            throw error;
          } finally {
            active.commits.delete(pending);
            active.nativeCommits.delete(pending);
          }
        },
        setActivity: async (activity, label) => {
          assertCurrent();
          this.state.activity = activity;
          if (label) this.state.label = label;
          this.publish();
        }
      };
      let result;
      let failure;
      let nativeAcquired = false;
      try {
        if (guardsInput) {
          if (options.runId) this.leaseRunId = options.runId;
          await this.syncNative(this.config.show_virtual_cursor, true);
          nativeAcquired = true;
        }
        assertCurrent();
        if (documentEpoch !== this.documentEpoch) throw new BrowserAutomationError("browser_document_changed");
        result = await action(operation);
        this.noteResult(result);
        if (!(options.allowDisposedCompletion && this.disposed && this.wc.isDestroyed() && this.state.epoch === epoch + 1)) assertCurrent();
      } catch (error) {
        failure = error;
      } finally {
        active.accepting = false;
        await Promise.allSettled([...active.commits]);
        const cancellation = this.nativeCancellationBarrier;
        if (cancellation && cancellation.generation === this.controlGeneration) await cancellation.settled;
        active.cleaning = true;
        this.publish();
        for (const cleanup of [...active.cleanups]) {
          try {
            await cleanup({ nativeResetConfirmed: active.nativeResetConfirmed });
          } catch {
            this.unsafeCleanup = true;
            this.state.error = "cleanup_unconfirmed";
            this.observationRequired = true;
          }
        }
        active.cleanups.clear();
        active.cleaning = false;
        this.active = void 0;
        this.state.activeOperations = 0;
        if (!this.disposed && this.state.epoch === epoch && (!this.gated || !guardsInput)) {
          try {
            if (guardsInput && !nativeAcquired) {
              await this.syncNative(false, false);
              this.leaseRunId = void 0;
            } else if (guardsInput && !this.leaseRunId) {
              await this.syncNative(this.config.show_virtual_cursor, false);
              this.observationRequired = true;
              invalidatePointerMotion(this.wc);
            }
            if (this.state.epoch !== epoch || this.gated && guardsInput) {
            } else if (this.unsafeCleanup) {
              if (this.leaseRunId) {
                await this.syncNative(false, false);
                this.leaseRunId = void 0;
              }
              this.invalidate("cleanup_unconfirmed");
              this.state.owner = "paused";
              this.state.activity = "error";
              this.state.error = "cleanup_unconfirmed";
              failure = new BrowserAutomationError("cleanup_unconfirmed");
            } else {
              this.state.activity = !guardsInput ? previousActivity : failure ? "error" : "waiting";
              this.state.error = !guardsInput ? previousError : failure instanceof Error ? failure.message : failure ? String(failure) : void 0;
            }
          } catch (error) {
            this.invalidate("release_unconfirmed");
            this.state.owner = "paused";
            this.state.activity = "error";
            this.state.error = "release_unconfirmed";
            failure = new BrowserAutomationError("release_unconfirmed", String(error));
          }
        }
        this.publish();
      }
      if (failure) {
        if (failure instanceof BrowserAutomationError) {
          Object.assign(failure.diagnostic, { expectedEpoch: epoch, actualEpoch: this.state.epoch, expectedDocumentEpoch: documentEpoch, actualDocumentEpoch: this.documentEpoch, ...failure.diagnostic.stage === "cleanup" ? {} : { stage: active.submittedInput ? "after_dispatch" : "before_dispatch" }, ...active.submittedInput ? {} : { dispatched: false } });
          if (this.state.lastResult) {
            failure.lastResult = structuredClone(this.state.lastResult);
            if ((this.state.lastResult.dispatchedCount ?? 0) > 0 || this.state.lastResult.status === "dispatched") failure.diagnostic.dispatched = true;
          }
        }
        throw failure;
      }
      return result;
    });
    this.tail = queued.then(() => {
    }, () => {
    });
    return queued;
  }
  handoff(owner) {
    this.invalidate("browser_operation_invalidated");
    this.options.setManualControl?.(true);
    this.state.activity = "handoff";
    this.state.handoffTarget = owner;
    this.state.label = "\u7B49\u5F85\u5F53\u524D\u8F93\u5165\u4E0E\u6E05\u7406\u5B8C\u6210";
    this.publish();
    const controlGeneration = this.controlGeneration;
    const pending = this.tail;
    this.nativeCancellationGeneration = controlGeneration;
    let nativeInputActive = false;
    try {
      nativeInputActive = this.wc.getAutomationState?.call(this.wc).inputActive === true;
    } catch {
    }
    const cancelNativeInput = this.externalPending.size === 0 && (!!this.active?.nativeCommits.size || nativeInputActive);
    const cancelledActive = this.active;
    const releasing = cancelNativeInput ? this.syncNative(false, false, controlGeneration).then(
      () => {
        if (cancelledActive) cancelledActive.nativeResetConfirmed = true;
        return { ok: true };
      },
      (error) => ({ ok: false, error })
    ) : void 0;
    if (releasing) this.nativeCancellationBarrier = { generation: controlGeneration, settled: releasing.then(() => {
    }) };
    return this.serializeControl(async () => {
      await this.drain(pending);
      if (this.disposed || this.controlGeneration !== controlGeneration) return this.snapshot();
      try {
        if (releasing) {
          const released = await releasing;
          if (!released.ok) throw released.error;
        } else await this.syncNative(false, false, controlGeneration);
        this.confirmNative(this.wc, false, false, true);
        if (this.controlGeneration !== controlGeneration) return this.snapshot();
        this.state.owner = this.unsafeCleanup ? "paused" : owner;
        this.state.activity = this.unsafeCleanup ? "error" : "idle";
        this.leaseRunId = void 0;
        this.state.error = this.unsafeCleanup ? "cleanup_unconfirmed" : void 0;
      } catch {
        if (this.controlGeneration !== controlGeneration) return this.snapshot();
        this.state.nativeConfirmed = false;
        this.state.owner = "paused";
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
      }
      if (!this.state.error) this.state.handoffTarget = void 0;
      this.state.label = void 0;
      this.publish();
      return this.snapshot();
    });
  }
  takeControl() {
    return this.handoff("user");
  }
  pause() {
    return this.handoff("paused");
  }
  retryRelease() {
    return this.handoff(this.state.handoffTarget ?? (this.state.owner === "user" ? "user" : "paused"));
  }
  /** Explicit Agent cancellation affects only the matching task's page lease. */
  cancelRun(runId) {
    if (!runId) return Promise.resolve();
    if (this.cancelledRun?.id === runId) return this.cancelledRun.settled;
    if (this.manualSession?.leaseRunId === runId) {
      this.manualSession.runEnded = true;
      this.publish();
      return Promise.resolve();
    }
    if (this.leaseRunId !== runId) return Promise.resolve();
    const settled = this.pause().then((state) => {
      if (!state.nativeConfirmed || state.inputProtected || state.isolateInput || state.keepRendering || state.error || state.activity === "handoff") {
        throw new BrowserAutomationError(state.error || "release_unconfirmed");
      }
    });
    this.cancelledRun = { id: runId, settled };
    return settled;
  }
  finishRun(runId) {
    if (this.manualSession && (!this.manualSession.leaseRunId || this.manualSession.leaseRunId === runId)) this.manualSession.runEnded = true;
    if (this.leaseRunId && this.leaseRunId !== runId) return Promise.resolve();
    const controlGeneration = this.controlGeneration;
    const pending = this.tail;
    return this.serializeControl(async () => {
      await this.drain(pending);
      if (this.disposed || this.controlGeneration !== controlGeneration || this.tail !== pending || this.active || this.gated || this.state.owner !== "ai" || this.leaseRunId && this.leaseRunId !== runId) return;
      if (!this.state.nativeConfirmed || this.unsafeCleanup) return;
      try {
        await this.syncNative(false, false);
        if (this.controlGeneration !== controlGeneration || this.tail !== pending || this.active || this.gated) return;
        if (this.state.activity !== "error") this.state.activity = "idle";
        this.leaseRunId = void 0;
        this.state.label = void 0;
      } catch {
        this.gated = true;
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
      }
      this.publish();
    });
  }
  async resume() {
    if (this.state.pageBlocker && this.state.pageBlocker.state !== "not_observed" && !(this.state.pageBlocker.state === "confirmed" && !this.state.pageBlocker.requiresUser)) {
      const blocker = await this.recheckBlocker();
      if (blocker?.state !== "not_observed" && !(blocker?.state === "confirmed" && !blocker.requiresUser)) throw new BrowserAutomationError(blocker?.state === "confirmed" ? "browser_page_blocked" : "browser_page_unverified", blocker?.state === "confirmed" ? "\u9875\u9762\u4ECD\u9700\u672C\u4EBA\u5904\u7406\uFF0C\u8BF7\u5B8C\u6210\u540E\u91CD\u65B0\u68C0\u67E5\u3002" : "\u5C1A\u672A\u786E\u8BA4\u9875\u9762\u53EF\u4EE5\u7EE7\u7EED\u64CD\u4F5C\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
    }
    const controlGeneration = this.controlGeneration;
    const pending = this.tail;
    return this.serializeControl(async () => {
      await this.drain(pending);
      if (this.disposed) throw new BrowserAutomationError("browser_page_destroyed");
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
      if (this.unsafeCleanup) throw new BrowserAutomationError("cleanup_unconfirmed", "Input cleanup was not confirmed; reload and observe the page before resuming.");
      try {
        await this.syncNative(false, false);
      } catch {
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
        this.publish();
        throw new BrowserAutomationError("release_unconfirmed");
      }
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
      this.controlGeneration++;
      this.advanceEpoch();
      this.gated = false;
      this.observationRequired = true;
      this.options.setManualControl?.(false);
      this.state.owner = "ai";
      this.state.activity = "idle";
      this.state.error = void 0;
      this.publish();
      return this.snapshot();
    });
  }
  /** Reserve only future actions; submitted input drains without being aborted. */
  acquireManualSession() {
    if (this.manualSession) return Promise.reject(new BrowserAutomationError("browser_manual_control"));
    const token = { id: randomUUID2(), generation: this.controlGeneration, documentEpoch: this.documentEpoch };
    const session = { token, owner: this.state.owner, manual: !!this.options.getManualControl?.(), gated: this.gated, leaseRunId: this.leaseRunId, runEnded: false };
    this.manualSession = session;
    const pending = this.tail;
    return this.serializeControl(async () => {
      try {
        await this.drain(pending);
        if (this.disposed || this.manualSession !== session || token.generation !== this.controlGeneration || token.documentEpoch !== this.documentEpoch) throw new BrowserAutomationError("browser_operation_invalidated");
        if (this.unsafeCleanup) throw new BrowserAutomationError("cleanup_unconfirmed");
        session.owner = this.state.owner;
        session.manual = !!this.options.getManualControl?.();
        session.gated = this.gated;
        session.leaseRunId = this.leaseRunId;
        await this.syncNative(false, false);
        if (token.generation !== this.controlGeneration || token.documentEpoch !== this.documentEpoch) throw new BrowserAutomationError("browser_operation_invalidated");
        token.generation = ++this.controlGeneration;
        this.advanceEpoch();
        this.observationRequired = true;
        this.gated = true;
        this.options.setManualControl?.(true);
        this.state.owner = "user";
        this.state.activity = "idle";
        this.state.label = "\u7F51\u9875\u6279\u6CE8";
        this.publish();
        return { ...token };
      } catch (error) {
        if (this.manualSession === session) this.manualSession = void 0;
        if (!this.disposed && !this.state.nativeConfirmed) {
          this.gated = true;
          this.state.owner = "paused";
          this.state.activity = "error";
          this.state.error = "release_unconfirmed";
          this.publish();
        }
        throw error;
      }
    });
  }
  releaseManualSession(token) {
    return this.serializeControl(async () => {
      const session = this.manualSession;
      if (!session || session.token.id !== token.id) return { restored: false, state: this.snapshot() };
      const valid = !this.disposed && token.generation === this.controlGeneration && token.documentEpoch === this.documentEpoch && !session.runEnded && !this.unsafeCleanup && this.state.nativeConfirmed;
      if (!valid) {
        this.manualSession = void 0;
        if (!this.disposed && token.generation === this.controlGeneration) {
          this.gated = true;
          this.options.setManualControl?.(true);
          this.state.owner = "user";
          this.state.activity = "idle";
          this.state.label = void 0;
          if (session.runEnded) this.leaseRunId = void 0;
          this.advanceEpoch();
          this.observationRequired = true;
          this.publish();
        }
        return { restored: false, state: this.snapshot() };
      }
      try {
        const protect = session.owner === "ai" && !session.manual && !!session.leaseRunId;
        await this.syncNative(protect && this.config.show_virtual_cursor, protect);
        if (token.generation !== this.controlGeneration || token.documentEpoch !== this.documentEpoch) {
          await this.syncNative(false, false);
          this.manualSession = void 0;
          if (token.generation === this.controlGeneration) {
            this.gated = true;
            this.options.setManualControl?.(true);
            this.state.owner = "user";
            this.state.activity = "idle";
            this.state.label = void 0;
            this.publish();
          }
          return { restored: false, state: this.snapshot() };
        }
        this.manualSession = void 0;
        this.controlGeneration++;
        this.advanceEpoch();
        this.observationRequired = true;
        this.gated = session.gated;
        this.options.setManualControl?.(session.manual);
        this.leaseRunId = session.leaseRunId;
        this.state.owner = session.owner;
        this.state.activity = protect ? "waiting" : "idle";
        this.state.label = void 0;
        this.state.error = void 0;
        this.publish();
        return { restored: true, state: this.snapshot() };
      } catch (error) {
        this.manualSession = void 0;
        this.gated = true;
        this.state.owner = "paused";
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
        this.publish();
        throw error;
      }
    });
  }
  async drainForTransfer() {
    this.invalidate("browser_geometry_changed");
    this.state.activity = "handoff";
    this.state.label = "\u6B63\u5728\u7B49\u5F85\u9875\u9762\u64CD\u4F5C\u7ED3\u675F";
    this.publish();
    const controlGeneration = this.controlGeneration;
    await this.drain(this.tail);
    if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
    try {
      await this.syncNative(false, false);
    } catch {
      this.state.owner = "paused";
      this.state.activity = "error";
      this.state.error = "release_unconfirmed";
      this.publish();
      throw new BrowserAutomationError("release_unconfirmed");
    }
    if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
    if (this.unsafeCleanup) {
      this.state.owner = "paused";
      this.state.activity = "error";
      this.state.error = "cleanup_unconfirmed";
      this.publish();
      throw new BrowserAutomationError("cleanup_unconfirmed");
    }
    return this.state.epoch;
  }
  async finishTransfer() {
    if (this.disposed) return;
    const generation = this.controlGeneration;
    this.documentEpoch++;
    this.observationRequired = true;
    if (this.leaseRunId && this.state.owner === "ai" && !this.options.getManualControl?.() && !this.unsafeCleanup) {
      try {
        await this.syncNative(this.config.show_virtual_cursor, true);
      } catch {
        this.state.owner = "paused";
        this.state.activity = "error";
        this.state.error = "protection_unconfirmed";
        this.publish();
        throw new BrowserAutomationError("protection_unconfirmed");
      }
      if (generation !== this.controlGeneration) return;
    }
    if (this.state.owner === "ai" && !this.unsafeCleanup) this.gated = false;
    this.state.activity = this.leaseRunId && !this.options.getManualControl?.() ? "waiting" : "idle";
    this.state.label = void 0;
    invalidatePointerMotion(this.wc);
    this.publish();
  }
  async withTransfer(action) {
    this.invalidate("browser_geometry_changed");
    this.state.activity = "handoff";
    this.state.label = "\u6B63\u5728\u7B49\u5F85\u9875\u9762\u64CD\u4F5C\u7ED3\u675F";
    this.publish();
    const controlGeneration = this.controlGeneration;
    const pending = this.tail;
    return this.serializeControl(async () => {
      await this.drain(pending);
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
      try {
        await this.syncNative(false, false);
      } catch {
        this.state.owner = "paused";
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
        this.publish();
        throw new BrowserAutomationError("release_unconfirmed");
      }
      if (controlGeneration !== this.controlGeneration) throw new BrowserAutomationError("browser_operation_invalidated");
      if (this.unsafeCleanup) {
        this.state.owner = "paused";
        this.state.activity = "error";
        this.state.error = "cleanup_unconfirmed";
        this.publish();
        throw new BrowserAutomationError("cleanup_unconfirmed");
      }
      try {
        return await action();
      } finally {
        if (controlGeneration === this.controlGeneration) await this.finishTransfer();
      }
    });
  }
  applySettings(next, nextRevision) {
    if (nextRevision <= (this.state.revision ?? -1)) return Promise.resolve(this.snapshot());
    const previous = this.config;
    this.config = normalizeBrowserAutomation(next);
    this.state.revision = nextRevision;
    const modeChanged = previous.show_virtual_cursor !== next.show_virtual_cursor || previous.cursor_style !== next.cursor_style || previous.cursor_scale !== next.cursor_scale;
    const nativeChanged = modeChanged || previous.cursor_fps !== next.cursor_fps;
    if (!nativeChanged) {
      this.publish();
      return Promise.resolve(this.snapshot());
    }
    if (!modeChanged) {
      try {
        const api = this.wc;
        if (!api.setVirtualCursorFrameRate) throw new BrowserAutomationError("automation_api_unavailable");
        api.setVirtualCursorFrameRate.call(this.wc, next.cursor_fps);
        const actual = this.readNative(api);
        if (actual.virtualCursor.frameRate !== next.cursor_fps) throw new BrowserAutomationError("automation_configuration_unconfirmed");
      } catch (error) {
        this.state.nativeConfirmed = false;
        this.state.error = "cursor_configuration_failed";
        this.publish();
        return Promise.reject(error);
      }
      this.publish();
      return Promise.resolve(this.snapshot());
    }
    const controlGeneration = this.controlGeneration;
    const pending = this.tail;
    const applied = this.serializeControl(async () => {
      await this.drain(pending);
      if (this.disposed || nextRevision !== this.state.revision) return this.snapshot();
      try {
        const ownsInput = this.state.owner === "ai" && !this.options.getManualControl?.() && (!!this.leaseRunId || this.state.activity !== "idle");
        await this.syncNative(ownsInput && this.config.show_virtual_cursor, !!this.leaseRunId && ownsInput);
        if (nextRevision !== this.state.revision || this.controlGeneration !== controlGeneration) return this.snapshot();
        if (this.state.owner === "ai" && !this.unsafeCleanup) this.gated = false;
        this.state.activity = this.unsafeCleanup ? "error" : this.state.owner === "ai" ? "waiting" : "idle";
        this.state.error = this.unsafeCleanup ? "cleanup_unconfirmed" : void 0;
      } catch {
        if (nextRevision !== this.state.revision || this.controlGeneration !== controlGeneration) return this.snapshot();
        this.gated = true;
        this.state.activity = "error";
        this.state.error = "release_unconfirmed";
      }
      this.publish();
      return this.snapshot();
    });
    this.admission = applied.then(() => {
    }, () => {
    });
    return applied;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate("browser_page_destroyed");
    live.delete(this);
    for (const { event, fn } of this.listeners) this.wc.removeListener(event, fn);
    this.listeners = [];
    this.state.owner = "paused";
    this.state.activity = "error";
    this.state.error = "browser_page_destroyed";
    this.leaseRunId = void 0;
    this.state.cursorVisible = false;
    this.state.cursorEnabled = false;
    this.state.inputProtected = false;
    this.state.isolateInput = false;
    this.state.keepRendering = false;
    this.state.rendering = { viewAvailable: false, keepAlive: false, requestedBackgroundThrottling: true, effectiveBackgroundThrottling: true };
    this.state.nativePending = false;
    this.state.nativeConfirmed = true;
    this.publish();
  }
};

// electron/modules/browser-automation-test-api.ts
function automationTestApi() {
  const defaults = () => ({
    isolateInput: false,
    blockRealPointer: false,
    blockRealKeyboard: false,
    keepRendering: false,
    virtualCursor: { enabled: false, frameRate: 0, hotspot: { x: 0, y: 0 }, customImage: false }
  });
  let state = defaults();
  return {
    async setAutomationOptions(options) {
      state = { ...state, ...options, virtualCursor: {
        ...state.virtualCursor,
        ...options.virtualCursor,
        ...options.virtualCursor?.image === void 0 ? {} : { customImage: options.virtualCursor.image !== null }
      } };
    },
    getAutomationState() {
      return { ...structuredClone(state), rendering: {
        viewAvailable: true,
        keepAlive: state.keepRendering,
        requestedBackgroundThrottling: true,
        effectiveBackgroundThrottling: !state.keepRendering
      }, inputActive: false };
    },
    async resetAutomationOptions() {
      state = defaults();
    },
    setVirtualCursorFrameRate(frameRate) {
      state.virtualCursor.frameRate = frameRate;
    }
  };
}

// electron/modules/agent-runtime-policy.test.ts
var Runtime;
var tempRoot;
var scope = globalThis;
before(async () => {
  tempRoot = await fs2.mkdtemp(path2.join(os.tmpdir(), "navora-runtime-policy-"));
  const esbuild = await import(pathToFileURL(path2.join(process.cwd(), "node_modules/esbuild/lib/main.js")).href);
  const outfile = path2.join(tempRoot, "runtime.mjs");
  await esbuild.build({ entryPoints: [path2.join(process.cwd(), "electron/modules/agent-runtime.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node20", external: ["electron"], logLevel: "silent", plugins: [{
    name: "native-tool-fixture",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/browser-tools$/ }, () => ({ path: "tools", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function executeAgentTool(...args) { return globalThis.__navoraRuntimePolicyTool(...args) }", loader: "js" }));
    }
  }] });
  Runtime = (await import(pathToFileURL(outfile).href)).AgentRuntime;
});
after(async () => {
  delete scope.__navoraRuntimePolicyTool;
  if (!tempRoot) return;
  const relative = path2.relative(path2.resolve(os.tmpdir()), path2.resolve(tempRoot));
  assert.match(relative, /^navora-runtime-policy-[^\\/]+$/u);
  await fs2.rm(tempRoot, { recursive: true, force: true });
});
function call(name, args = {}) {
  return { id: `call-${name}-${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
var reply = (content, tool_calls) => ({ choices: [{ message: { role: "assistant", content, ...tool_calls ? { tool_calls } : {} }, finish_reason: tool_calls ? "tool_calls" : "stop" }] });
async function fixture(t, userText, respond, tool, maxRounds = 24, answerContinuation, runtimeOverrides) {
  const requests = [], executed = [], asks = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const response = respond(request, requests.length - 1);
    res.writeHead(response.httpStatus || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  });
  const cfg = createDefaultConfig(), provider = cfg.ai.providers[0];
  provider.base_url = `http://127.0.0.1:${server.address().port}/v1`;
  provider.model = "fixture";
  provider.models = ["fixture"];
  provider.timeout_ms = 5e3;
  cfg.ai.max_tool_rounds = maxRounds;
  cfg.app.ai_generate_chat_title = false;
  const chat = { id: "chat", title: "fixture", createdAt: 1, updatedAt: 1, executionMode: "agent", messages: [{ id: "user", role: "user", content: userText, createdAt: 1 }] };
  const chats = {
    get: (id) => id === chat.id ? chat : void 0,
    setPendingAsk: (_id, value) => {
      chat.pendingAsk = value || void 0;
    },
    listChildren: () => [],
    resolvePluginScopeChatId: () => chat.id,
    beginSubchatRun: () => {
    },
    flushChat: () => {
    },
    setProvisionalTitleFromFirstUser: () => null,
    appendMessage: (_id, message) => {
      const row = { ...message, id: `m${chat.messages.length}`, createdAt: Date.now() };
      chat.messages.push(row);
      return row;
    },
    updateMessage: (_id, id, patch) => {
      const row = chat.messages.find((item) => item.id === id);
      if (row) Object.assign(row, { ...patch, ...patch.meta ? { meta: { ...row.meta, ...patch.meta } } : {} });
      return row;
    }
  };
  const registry = { getTree: () => [], getWindowRecord: () => null, beginQuietNavigateLogs: () => {
  }, endQuietNavigateLogs: () => {
  } };
  const plugins = { ownerOfToolForChat: () => void 0, buildPromptAppendix: () => "", enabledToolsForChat: () => [] };
  const runtime = new Runtime({ getConfig: () => cfg, updateConfig: () => cfg, chats, registry, plugins, skills: { buildPromptAppendix: () => "" }, secrets: { get: () => "" }, emit: () => {
  }, askUser: async (request) => {
    asks.push(request);
    return { id: "ask", source: "option", answer: answerContinuation?.() ?? "\u505C\u6B62" };
  }, askSkillReview: async () => ({}), ...runtimeOverrides });
  scope.__navoraRuntimePolicyTool = async (name, args, ctx) => {
    executed.push({ name, args });
    return tool ? tool(name, args, ctx) : { ok: true, value: { step: executed.length } };
  };
  return { runtime, chat, cfg, requests, executed, asks, registry, run: () => runtime.run({ chatId: "chat", userText }), end: () => [...chat.messages].reverse().find((message) => message.meta?.kind === "agent_run_end") };
}
test("actual runtime completes a ten-step action despite old six/eight-call stopping thresholds", async (t) => {
  const names = ["browser_open", "browser_get", "browser_get", "browser_type", "browser_get", "browser_get", "browser_mouse", "browser_click", "browser_back", "browser_get"];
  const f = await fixture(t, "\u968F\u673A\u9009\u62E9\u7F51\u7AD9\uFF0C\u81EA\u52A8\u5316\u952E\u9F20\u8FDE\u8D2F\u6D4B\u8BD5\u64CD\u4F5C", (request, index) => {
    const forced = request.messages.some((message) => message.role === "system" && /禁止继续 navigate|强制停止浏览/u.test(String(message.content)));
    if (forced) return reply("\u5DE5\u5177\u8C03\u7528\u5DF2\u8FBE\u5230\u4E0A\u9650\uFF0C\u9700\u8981\u7528\u6237\u8BF4\u7EE7\u7EED\u3002");
    return index < names.length ? reply(null, [call(names[index], { windowId: "page", what: "agent_find", step: index })]) : reply("\u5DF2\u5B8C\u6210\u8F93\u5165\u3001\u63D0\u4EA4\u3001\u6838\u9A8C\u3001\u6EDA\u52A8\u3001\u70B9\u51FB\u4E0E\u8FD4\u56DE\u3002");
  });
  await f.run();
  assert.equal(f.executed.length, 10);
  assert.equal(f.requests.length, 11);
  assert.equal(f.asks.length, 0);
  assert.equal(f.end()?.meta?.stopReason, "model_final");
  assert.equal([...f.chat.messages].reverse().find((message) => message.role === "assistant")?.content, "\u5DF2\u5B8C\u6210\u8F93\u5165\u3001\u63D0\u4EA4\u3001\u6838\u9A8C\u3001\u6EDA\u52A8\u3001\u70B9\u51FB\u4E0E\u8FD4\u56DE\u3002");
});
test("actual auto/chat follow-up carries durable previous execution with independent current zero and no tools", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u4EFB\u52A1", (request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "private-input" })]) : reply("\u5DF2\u56DE\u8BFB\u5B57\u6BB5\u503C\u3002"), async () => ({ ok: true, input: { effect: "confirmed" } }));
  await f.run();
  const prior = f.end().meta.executionEvidence;
  assert.equal(prior.counts.inputsDispatched, 1);
  for (const mode of ["auto", "chat"]) {
    f.chat.executionMode = mode;
    f.chat.messages.push({ id: `followup-${mode}`, role: "user", content: "\u521A\u624D\u4E3A\u4EC0\u4E48\u5931\u8D25\uFF1F", createdAt: Date.now() });
    await f.runtime.run({ chatId: "chat", userText: "\u521A\u624D\u4E3A\u4EC0\u4E48\u5931\u8D25\uFF1F" });
    const request = f.requests.at(-1), currentRow = request.messages.find((message) => String(message.content).startsWith("[\u5F53\u524D\u8FD0\u884C\u4E8B\u5B9E]")), historyRow = request.messages.find((message) => String(message.content).startsWith("[\u5386\u53F2\u8FD0\u884C\u4E8B\u5B9E]"));
    const current = JSON.parse(String(currentRow.content).split("\n").slice(1).join("\n")), history = JSON.parse(String(historyRow.content).split("\n").slice(1).join("\n"));
    assert.equal(current.counts.inputsDispatched, 0);
    assert.notEqual(current.runId, prior.runId);
    assert.equal(history.runs.find((run) => run.runId === prior.runId).counts.inputsDispatched, 1);
    assert.equal(request.tools?.length || 0, 0);
    assert.equal(f.executed.length, 1);
    assert.doesNotMatch(JSON.stringify(history), /private-input/);
  }
});
test("actual full Agent follow-up retains partial successes and invalidated/stale errors without inventing a cause", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u5E76\u6D4B\u8BD5", (request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "private" }), call("browser_click", { windowId: "page", ref: "old" }), call("browser_get", { windowId: "page", what: "agent_find" })]) : reply("\u90E8\u5206\u6B65\u9AA4\u5DF2\u6D3E\u53D1\uFF0C\u9875\u9762\u5DF2\u5931\u6548\uFF0C\u539F\u56E0\u672A\u786E\u8BA4\u3002"), async (name) => name === "browser_type" ? { ok: true, input: { effect: "confirmed" } } : name === "browser_click" ? { ok: false, error: "browser_operation_invalidated" } : { ok: false, error: "ref_not_found" });
  await f.run();
  f.chat.messages.push({ id: "explain", "role": "user", content: "\u89E3\u91CA\u521A\u624D\u7684\u5931\u8D25", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u89E3\u91CA\u521A\u624D\u7684\u5931\u8D25" });
  const facts = String(f.requests.at(-1).messages.find((message) => String(message.content).startsWith("[\u5386\u53F2\u8FD0\u884C\u4E8B\u5B9E]")).content);
  assert.match(facts, /browser_operation_invalidated/);
  assert.match(facts, /ref_not_found/);
  assert.match(facts, /inputsDispatched\":1/);
  assert.doesNotMatch(facts, /control_changed|user_takeover|private/);
});
test("actual safe-digest provider retry carries current and historical host facts", async (t) => {
  let rejecting = false;
  const f = await fixture(t, "\u81EA\u52A8\u5316\u8F93\u5165\u5E76\u6838\u9A8C", (request, index) => !rejecting && index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "secret" })]) : rejecting && request.tools?.length ? reply("The request was rejected because it was considered high risk") : reply("\u5DF2\u6838\u5BF9\u5BBF\u4E3B\u4E8B\u5B9E\u3002"), async () => ({ ok: true, input: { effect: "confirmed" } }));
  await f.run();
  rejecting = true;
  f.chat.messages.push({ id: "retry-user", role: "user", content: "\u6838\u5BF9\u4E4B\u524D\u6267\u884C\u4E8B\u5B9E", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u6838\u5BF9\u4E4B\u524D\u6267\u884C\u4E8B\u5B9E" });
  const retry = f.requests.at(-1);
  assert.ok(retry.messages.some((message) => String(message.content).startsWith("[\u5F53\u524D\u8FD0\u884C\u4E8B\u5B9E]")));
  assert.ok(retry.messages.some((message) => String(message.content).startsWith("[\u5386\u53F2\u8FD0\u884C\u4E8B\u5B9E]")));
  assert.equal(retry.tools?.length || 0, 0);
});
test("actual runtime persists trusted fragments, scoped inserted instructions and ended summary", async (t) => {
  let f;
  f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199", (_request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "secret" })]) : index === 1 ? reply(null, [call("browser_press", { windowId: "page", key: "Tab" })]) : reply("\u5DF2\u5B8C\u6210\u56DE\u8BFB\u3002"), async (name) => {
    if (name === "browser_type") {
      assert.equal(f.runtime.insertUserInput("chat", { content: "\u7EE7\u7EED\u6838\u5BF9\u7126\u70B9" }), true);
      return { ok: true, input: { effect: "confirmed" } };
    }
    return { ok: true, keyboardEffect: { state: "confirmed", event: "tab", evidenceSource: "host_readback", sameDocument: true, sameTarget: false } };
  });
  await f.run();
  const inserted = f.chat.messages.find((message) => message.meta?.inserted), press = f.chat.messages.find((message) => message.meta?.toolName === "browser_press");
  assert.equal(press.meta?.turnId, inserted.id);
  const summary = f.end().meta.executionEvidence;
  assert.equal(summary.state, "ended");
  assert.equal(summary.evidence.find((row) => row.toolName === "browser_press").turnId, inserted.id);
  assert.equal(summary.evidence.find((row) => row.toolName === "browser_press").keyboardEffect?.state, "confirmed");
  assert.doesNotMatch(JSON.stringify(summary), /secret/);
});
test("actual runtime retains page handoff facts in end and quick-answer history without captcha text", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u8BFB\u53D6\u8D44\u6599", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "page", what: "agent_snapshot" })]) : reply("\u5F53\u524D\u9875\u9762\u9700\u8981\u4F60\u5B8C\u6210\u9A8C\u8BC1\uFF0C\u5DF2\u4FDD\u7559\u73B0\u573A\u3002"), async () => ({ ok: true, value: { elements: [] }, pageBlocker: { version: 1, state: "confirmed", chatId: "chat", windowId: "page", observationId: "probe-1", kind: "human_verification", coverage: "partial", scope: "visible_viewport", requiresUser: true, blocksInteraction: "yes", followup: "user_handoff", reasonCodes: ["VISIBLE_CHALLENGE"], evidence: [{ kind: "visible_challenge_control", documentId: 3 }], question: "private-captcha-payload" } }));
  await f.run();
  const summary = f.end().meta.executionEvidence;
  assert.equal(summary.pageBlocker?.state, "confirmed");
  assert.deepEqual(summary.pageBlocker?.reasonCodes, ["VISIBLE_CHALLENGE"]);
  assert.equal(f.end().meta.stopReason, "waiting_for_user");
  assert.equal(f.chat.messages.filter((message) => message.meta?.kind === "page_blocker_detected").length, 1);
  f.chat.executionMode = "chat";
  f.chat.messages.push({ id: "why-blocked", role: "user", content: "\u4E3A\u4EC0\u4E48\u505C\u4E0B\u4E86\uFF1F", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u4E3A\u4EC0\u4E48\u505C\u4E0B\u4E86\uFF1F" });
  const history = String(f.requests.at(-1).messages.find((message) => String(message.content).startsWith("[\u5386\u53F2\u8FD0\u884C\u4E8B\u5B9E]")).content);
  assert.match(history, /human_verification/);
  assert.match(history, /VISIBLE_CHALLENGE/);
  assert.doesNotMatch(history, /private-captcha-payload/);
});
test("actual runtime resumes a blocked checkpoint once only after an explicit user request, without replaying old input", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u8D44\u6599", (_request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "one-time-value" }), call("browser_get", { windowId: "page", what: "agent_snapshot" })]) : reply("\u9875\u9762\u9700\u8981\u4F60\u9A8C\u8BC1\uFF0C\u5DF2\u4FDD\u5B58\u8FDB\u5EA6\u3002"), async (name) => name === "browser_type" ? { ok: true, input: { effect: "confirmed" } } : { ok: true, pageBlocker: { version: 1, state: "confirmed", windowId: "page", observationId: "blocked", requiresUser: true } });
  await f.run();
  const original = f.end(), originalId = original.meta.runId;
  f.registry.getWindowRecord = (() => ({ win: { isDestroyed: () => false } }));
  assert.equal(f.requests.length, 2, "restoring control alone starts no request");
  f.chat.messages.push({ id: "resume-user", role: "user", content: "\u6211\u5DF2\u5B8C\u6210\u9A8C\u8BC1\uFF0C\u7EE7\u7EED", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u6211\u5DF2\u5B8C\u6210\u9A8C\u8BC1\uFF0C\u7EE7\u7EED" });
  const resumed = f.end().meta.executionEvidence;
  assert.equal(resumed.resumesRunId, originalId);
  assert.equal(resumed.resumesTurnId, "user");
  assert.ok(resumed.resumesCheckpointId);
  assert.ok(f.requests.at(-1).messages.some((message) => String(message.content).includes("[\u7528\u6237\u660E\u786E\u7EE7\u7EED\u53D7\u963B\u4EFB\u52A1]") && String(message.content).includes("\u4E0D\u5F97\u91CD\u653E")));
  assert.equal(f.executed.filter((item) => item.name === "browser_type").length, 1);
  f.chat.messages.push({ id: "resume-again", role: "user", content: "\u7EE7\u7EED", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u7EE7\u7EED" });
  assert.equal(f.end().meta.executionEvidence.resumesCheckpointId, void 0, "same checkpoint cannot be claimed twice");
});
test("expected run stop validates before cancelling the current run", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => entered = resolve), blocked = new Promise((resolve) => release = resolve);
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "page", what: "text" })]) : reply("\u5DF2\u6838\u5BF9\u3002"), async () => {
    entered();
    await blocked;
    return { ok: true };
  });
  const running = f.run();
  await started;
  const current = f.runtime.currentRunId("chat");
  assert.equal(f.runtime.stop("chat", false, "obsolete-run"), false);
  assert.equal(f.runtime.isRunning("chat"), true);
  assert.equal(f.runtime.currentRunId("chat"), current);
  assert.equal(f.runtime.stop("chat", false, current), true);
  release();
  await running;
  assert.equal(f.end().meta.stopReason, "user_cancelled");
});
test("confirmed page checkpoint blocks unscoped downloads and fetch in the same tool batch while unrelated explicit pages stay available", async (t) => {
  const calls = [call("browser_get", { windowId: "blocked", what: "agent_snapshot" }), call("file_download", { url: "https://fixture.invalid/file" }), call("browser_session_fetch", { url: "https://fixture.invalid/api" }), call("browser_session_fetch", { windowId: "ignored-by-fetch", url: "https://fixture.invalid/api" }), call("file_download_compose", { windowId: "ignored-by-compose", parts: [] }), call("file_download", { windowId: "unrelated", url: "https://fixture.invalid/other" })];
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6574\u7406\u8D44\u6599", (_request, index) => index === 0 ? reply(null, calls) : reply("\u9A8C\u8BC1\u9875\u9762\u5DF2\u6682\u505C\uFF0C\u5176\u4ED6\u9875\u9762\u6B65\u9AA4\u5DF2\u6838\u5B9E\u3002"), async (name, args) => name === "browser_get" ? { ok: true, pageBlocker: { version: 1, state: "confirmed", windowId: "blocked", requiresUser: true, observationId: "blocked-observation" } } : { ok: true });
  await f.run();
  assert.deepEqual(f.executed.map((row) => [row.name, row.args.windowId]), [["browser_get", "blocked"], ["file_download", "unrelated"]]);
  const rejected = f.chat.messages.filter((message) => message.meta?.result?.error === "page_blocker_scope_required");
  assert.equal(rejected.length, 4);
  assert.equal(f.end().meta.stopReason, "waiting_for_user");
});
test("host sidecar admission preserves a waiting page and ignores model-provided scope identifiers", async (t) => {
  const f = await fixture(t, "\u8BFB\u53D6\u9875\u9762\u5E76\u8C03\u7528\u63A5\u53E3", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "blocked", what: "agent_snapshot" }), call("custom_http", { windowId: "unrelated", sessionId: "model-scope" })]) : reply("\u9875\u9762\u7B49\u5F85\u5904\u7406\uFF0C\u63A5\u53E3\u5C1A\u672A\u6D3E\u53D1\u3002"), async (name, _args, ctx) => {
    if (name === "browser_get") return { ok: true, pageBlocker: { version: 1, state: "confirmed", windowId: "blocked", requiresUser: true, observationId: "blocked" } };
    return ctx.pluginRequestAdmission?.() || { ok: true, dispatched: true };
  });
  await f.run();
  const result = f.chat.messages.find((message) => message.meta?.toolName === "custom_http").meta.result;
  assert.equal(result.error, "page_blocker_scope_required");
  assert.deepEqual(result.blockedWindowIds, ["blocked"]);
  assert.equal(f.end().meta.stopReason, "waiting_for_user");
});
test("an independent later task can use the sidecar while stale task callbacks stay cancelled", async (t) => {
  let priorAdmission, priorCurrent;
  const f = await fixture(t, "\u8BFB\u53D6\u4E00\u4E2A\u9700\u8981\u9A8C\u8BC1\u7684\u9875\u9762", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "blocked", what: "agent_snapshot" })]) : index === 2 ? reply(null, [call("custom_http", { url: "https://fixture.invalid/independent" })]) : reply("\u5DF2\u8BB0\u5F55\u672C\u6B21\u7ED3\u679C\u3002"), async (name, _args, ctx) => {
    if (name === "browser_get") {
      priorAdmission = ctx.pluginRequestAdmission;
      priorCurrent = ctx.isToolRunCurrent;
      return { ok: true, pageBlocker: { version: 1, state: "confirmed", windowId: "blocked", requiresUser: true, observationId: "blocked" } };
    }
    assert.equal(priorCurrent?.(), false);
    assert.equal(priorAdmission?.()?.error, "request_cancelled");
    assert.equal(ctx.pluginRequestAdmission?.(), null);
    assert.equal(ctx.isToolRunCurrent?.(), true);
    return { ok: true };
  });
  await f.run();
  f.chat.messages.push({ id: "independent-user", role: "user", content: "\u5355\u72EC\u67E5\u8BE2\u53E6\u4E00\u4E2A\u63A5\u53E3\uFF0C\u4E0D\u7EE7\u7EED\u4E4B\u524D\u7F51\u9875\u4EFB\u52A1\u3002", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u5355\u72EC\u67E5\u8BE2\u53E6\u4E00\u4E2A\u63A5\u53E3\uFF0C\u4E0D\u7EE7\u7EED\u4E4B\u524D\u7F51\u9875\u4EFB\u52A1\u3002" });
  assert.equal(f.executed.filter((row) => row.name === "custom_http").length, 1);
  assert.equal(priorAdmission?.()?.error, "request_cancelled");
});
test("host sidecar receipts retain run and tool identity separately from an untrusted plugin result", async (t) => {
  const invocation = call("custom_http", { runId: "forged-run", toolCallId: "forged-tool" });
  const f = await fixture(t, "\u67E5\u8BE2\u72EC\u7ACB\u63A5\u53E3", (_request, index) => index === 0 ? reply(null, [invocation]) : reply("\u4EC5\u786E\u8BA4\u63A5\u53E3\u4F20\u8F93\u5B8C\u6210\u3002"), async (_name, _args, ctx) => {
    ctx.pluginRuntimeReceipts.push({ version: 1, requestId: "host-request", attemptId: "host-attempt", pluginId: "fastls", chatId: "chat", runId: ctx.browserRunId, toolCallId: ctx.toolCallId, method: "request", state: "completed", dispatched: true, startedAt: 1, finishedAt: 2, httpStatus: 200, bytes: 12 });
    return { ok: true, businessResultVerified: true, requestId: "plugin-forged-request" };
  });
  await f.run();
  const message = f.chat.messages.find((message2) => message2.meta?.toolCallId === invocation.id), receipts = message.meta.pluginRuntimeReceipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].requestId, "host-request");
  assert.equal(receipts[0].toolCallId, invocation.id);
  assert.equal(receipts[0].runId, f.end().meta.runId);
  assert.notEqual(receipts[0].runId, "forged-run");
  assert.equal(message.meta.executionFragment.businessResultVerified, false);
});
test("a resumed run requires fresh page observation before unscoped request fallback and never replays old actions", async (t) => {
  let resumed = false;
  const f = await fixture(t, "\u81EA\u52A8\u5316\u8BFB\u53D6\u8D44\u6599", (_request, index) => !resumed ? index === 0 ? reply(null, [call("browser_get", { windowId: "page", what: "agent_snapshot" })]) : reply("\u9700\u8981\u672C\u4EBA\u9A8C\u8BC1\u3002") : index === 2 ? reply(null, [call("file_download", { url: "https://fixture.invalid/file" }), call("browser_get", { windowId: "page", what: "agent_snapshot" }), call("file_download", { url: "https://fixture.invalid/file" })]) : reply("\u5DF2\u91CD\u65B0\u89C2\u5BDF\uFF0C\u7EE7\u7EED\u5269\u4F59\u6B65\u9AA4\u3002"), async () => ({ ok: true, pageBlocker: { version: 1, state: resumed ? "not_observed" : "confirmed", windowId: "page", requiresUser: !resumed, observationId: resumed ? "fresh" : "blocked" } }));
  await f.run();
  resumed = true;
  f.registry.getWindowRecord = (() => ({ win: { isDestroyed: () => false } }));
  f.chat.messages.push({ id: "explicit-continue", role: "user", content: "\u7EE7\u7EED", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u7EE7\u7EED" });
  assert.deepEqual(f.executed.map((row) => row.name), ["browser_get", "browser_get", "file_download"]);
  assert.equal(f.chat.messages.filter((message) => message.meta?.result?.error === "page_blocker_scope_required").length, 1);
});
test("closed waiting page cannot be revived by a generic continue request", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u8BFB\u53D6\u8D44\u6599", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "closed-page", what: "agent_snapshot" })]) : reply("\u9700\u8981\u672C\u4EBA\u9A8C\u8BC1\u3002"), async () => ({ ok: true, pageBlocker: { version: 1, state: "confirmed", windowId: "closed-page", requiresUser: true } }));
  await f.run();
  const count = f.requests.length;
  f.chat.messages.push({ id: "continue-closed", role: "user", content: "\u7EE7\u7EED", createdAt: Date.now() });
  await f.runtime.run({ chatId: "chat", userText: "\u7EE7\u7EED" });
  assert.equal(f.requests.length, count);
  assert.equal(f.executed.length, 1);
  assert.match(f.chat.messages.at(-1).content, /browser_resume_page_closed|页面已关闭/);
});
test("actual runtime recovers an unsupported limit claim through observation without replaying input", async (t) => {
  const premature = "\u672C\u6B21\u5DE5\u5177\u8C03\u7528\u5DF2\u8FBE\u5230\u4E0A\u9650\uFF0C\u65E0\u6CD5\u7EE7\u7EED\uFF0C\u7528\u6237\u8BF4\u7EE7\u7EED\u540E\u518D\u6267\u884C\u3002".repeat(12);
  const f = await fixture(
    t,
    "\u81EA\u52A8\u5316\u8F93\u5165\u5E76\u9A8C\u8BC1",
    (request, index) => index === 0 ? reply(null, [call("browser_type", { ref: "n1e1", text: "sensitive-fixture" })]) : index === 1 ? reply(premature) : index === 2 ? reply(null, [call("browser_get", { what: "agent_find", agentQuery: { role: "textbox" } })]) : reply("\u8F93\u5165\u672A\u6210\u529F\uFF0C\u5DF2\u786E\u8BA4\u5F53\u524D\u503C\uFF0C\u6CA1\u6709\u91CD\u590D\u63D0\u4EA4\u3002"),
    async (name) => name === "browser_type" ? { ok: false, error: "target_type_failed", dispatchedCount: 6 } : { ok: true, value: { elements: [{ value: "" }] } }
  );
  await f.run();
  assert.equal(f.executed.filter((entry) => entry.name === "browser_type").length, 1);
  assert.equal(f.executed.filter((entry) => entry.name === "browser_get").length, 1);
  assert.ok(f.requests[2].messages.some((message) => message.role === "system" && /只能先重新观察/u.test(String(message.content))));
  assert.equal(f.end()?.meta?.stopReason, "tool_failure");
  const diagnostics = f.chat.messages.filter((message) => ["agent_policy", "agent_run_end", "incomplete_reply_retry"].includes(String(message.meta?.kind))).map((message) => message.meta);
  assert.doesNotMatch(JSON.stringify(diagnostics), /sensitive-fixture|本次工具调用/);
});
test("actual runtime enforces F02 unknown-effect observation before further page input", async (t) => {
  const target = { webContentsId: 1, processId: 2, routingId: 3, documentId: 4, backendNodeId: 5 };
  const calls = [call("browser_type", { windowId: "page", ref: "n1e1", text: "fixture" }), call("browser_press", { windowId: "page", key: "Enter" }), call("browser_get", { windowId: "page", what: "url" }), call("browser_type", { windowId: "page", ref: "n1e1", text: "fixture" }), call("browser_get", { windowId: "page", what: "agent_find", agentQuery: { role: "textbox" } }), call("browser_press", { windowId: "page", key: "Enter" })];
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u5E76\u786E\u8BA4", (request, index) => index < calls.length ? reply(null, [calls[index]]) : reply("\u5DF2\u91CD\u65B0\u6838\u5BF9\u8F93\u5165\u72B6\u6001\u5E76\u7EE7\u7EED\u4E0B\u4E00\u6B65\u3002"), async (name, args) => {
    if (name === "browser_type") return { ok: false, error: "target_type_failed", input: { effect: "unknown", dispatchedSteps: 7, dispatchedCodeUnits: 3, submitDispatched: false, target } };
    if (name === "browser_get" && args.what === "agent_find") return { ok: true, native: true, value: { complete: false, truncated: true, truncationReasons: ["MAX_NODES"], frames: [{ processId: 2, routingId: 3, documentId: 4, status: "covered" }], elements: [{ ref: "n2e1", target, value: "fixture", readOnly: false, focused: true, visible: true }] } };
    return { ok: true, value: "fixture" };
  });
  await f.run();
  assert.deepEqual(f.executed.map((entry) => entry.name), ["browser_type", "browser_get", "browser_get", "browser_press"]);
  const rejected = f.chat.messages.filter((message) => message.role === "tool" && message.meta?.result?.error === "browser_observation_required");
  assert.equal(rejected.length, 2);
  assert.equal(f.end()?.meta?.stopReason, "model_final");
});
test("actual runtime bounds recovery of invented limits and reports that the task remains incomplete", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", () => reply("\u672C\u8F6E\u5DE5\u5177\u8C03\u7528\u5DF2\u8FBE\u5230\u4E0A\u9650\uFF0C\u9700\u8981\u7528\u6237\u518D\u8BF4\u7EE7\u7EED\u3002".repeat(15)));
  await f.run();
  assert.equal(f.requests.length, 4);
  assert.equal(f.executed.length, 0);
  assert.equal(f.end()?.meta?.stopReason, "recovery_exhausted");
  assert.match([...f.chat.messages].reverse().find((message) => message.role === "assistant").content, /尚未触发本轮推理预算或工具次数硬限制/u);
});
test("actual runtime finishes a simple lookup as soon as the provider has enough evidence", async (t) => {
  const f = await fixture(t, "\u67E5\u4E00\u4E0B\u6700\u65B0\u7248\u672C", (request, index) => index < 2 ? reply(null, [call("browser_get", { what: "text", selector: `#evidence-${index}` })]) : reply("\u5DF2\u6838\u5BF9\u7248\u672C\u53CA\u53D1\u5E03\u65E5\u671F\uFF0C\u7ED3\u679C\u5982\u4E0B\u3002"));
  await f.run();
  assert.equal(f.requests.length, 3);
  assert.equal(f.executed.length, 2);
  assert.equal(f.asks.length, 0);
});
test("actual runtime respects denied input and manual takeover without automatic recovery", async (t) => {
  for (const error of ["permission_denied", "browser_manual_control", "browser_native_cleanup_unconfirmed"]) {
    const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (request, index) => index === 0 ? reply(null, [call("browser_type", { text: "fixture" })]) : reply("\u5DE5\u5177\u8C03\u7528\u5DF2\u8FBE\u5230\u4E0A\u9650\uFF0C\u7528\u6237\u8BF4\u7EE7\u7EED\u3002"), async () => ({ ok: false, error }));
    await f.run();
    assert.equal(f.requests.length, 2, error);
    assert.equal(f.executed.length, 1, error);
    assert.equal(f.end()?.meta?.stopReason, "tool_blocked", error);
  }
});
test("actual runtime stops repeated failing calls and refuses calls returned after tools are withdrawn", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u8868\u5355", () => reply(null, [call("browser_type", { ref: "n1e1", text: "fixture" })]), async () => ({ ok: false, error: "target_type_failed" }));
  await f.run();
  assert.equal(f.executed.length, 3);
  assert.equal(f.requests.length, 4);
  assert.equal(f.requests[3].tools?.length || 0, 0);
  assert.equal(f.end()?.meta?.stopReason, "host_policy_stop");
});
test("actual runtime keeps its real round-budget continuation gate", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (request, index) => reply(null, [call("browser_get", { what: "text", selector: `#step-${index}` })]), void 0, 4);
  await f.run();
  assert.equal(f.executed.length, 3);
  assert.equal(f.asks.length, 1);
  assert.equal(f.end()?.meta?.stopReason, "round_budget_exhausted");
  assert.ok(f.chat.messages.some((message) => message.meta?.kind === "round_limit"));
  assert.equal(f.requests.at(-1)?.tools?.length || 0, 0, "last real budget round is reserved for summary");
  assert.match([...f.chat.messages].reverse().find((message) => message.role === "assistant").content, /未确认全部完成/);
  const budget = f.end()?.meta?.roundBudget;
  assert.equal(budget.used, 4);
  assert.equal(budget.toolRounds, 3);
  assert.equal(budget.toolCalls, 3);
  assert.equal(budget.summaryRound, true);
  assert.equal(budget.limitReached, true);
  assert.equal(budget.continuationRequests, 1);
});
test("reserved summary round records its actual budget end instead of model_final", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (_request, index) => index < 3 ? reply(null, [call("browser_get", { what: "text", selector: `#${index}` })]) : reply("\u5DF2\u8FBE\u5230\u672C\u8F6E\u63A8\u7406\u9884\u7B97\uFF0C\u5DF2\u89C2\u5BDF\u9875\u9762\uFF1B\u5176\u4F59\u64CD\u4F5C\u5C1A\u672A\u6838\u5B9E\u3002"), void 0, 4);
  await f.run();
  const final = [...f.chat.messages].reverse().find((message) => message.meta?.phase === "final");
  const budget = final.meta?.roundBudget;
  assert.equal(final.meta?.stopReason, "round_budget_summary");
  assert.equal(f.end()?.meta?.stopReason, "round_budget_summary");
  assert.equal(budget.used, 4);
  assert.equal(budget.initialLimit, 4);
  assert.equal(budget.limit, 4);
  assert.equal(budget.providerAttempts, 4);
  assert.equal(budget.summaryRoundReached, true);
  assert.equal(f.asks.length, 0);
  assert.deepEqual(final.meta?.roundBudget, f.end()?.meta?.roundBudget);
  assert.deepEqual(final.meta?.settlement, { version: 1, status: "confirmed", rejectedCleanup: 0, nativeReleasesUnconfirmed: 0, retainedPages: 0 });
});
test("early round-budget claim is corrected without bypassing takeover and retains original final text", async (t) => {
  const premature = "\u672C\u8F6E\u63A8\u7406\u9884\u7B97\u5DF2\u7ECF\u8017\u5C3D\uFF0C\u65E0\u6CD5\u7EE7\u7EED\uFF0C\u7B49\u5F85\u7528\u6237\u7EE7\u7EED\u3002".repeat(12);
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u8868\u5355", (_request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", text: "synthetic-private-value" })]) : reply(premature), async () => ({ ok: false, error: "browser_manual_control" }));
  await f.run();
  assert.equal(f.executed.length, 1);
  assert.equal(f.requests.length, 2, "manual takeover forbids automatic recovery");
  const final = [...f.chat.messages].reverse().find((message) => message.meta?.phase === "final");
  assert.equal(final.meta?.modelFinalContent, premature);
  assert.equal(final.meta?.stopReason, "tool_blocked");
  assert.match(final.content, /人工接管/);
  const budget = final.meta?.roundBudget;
  assert.equal(budget.limitReached, false);
  assert.equal(budget.summaryRound, false);
  assert.doesNotMatch(JSON.stringify(final.meta?.completionEvidence), /synthetic-private-value/);
});
test("early budget exhaustion claim without a tool-count claim uses bounded recovery", async (t) => {
  const premature = "\u672C\u8F6E\u63A8\u7406\u9884\u7B97\u5DF2\u7ECF\u8017\u5C3D\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u3002".repeat(12);
  const f = await fixture(t, "\u81EA\u52A8\u5316\u586B\u5199\u8868\u5355", () => reply(premature));
  await f.run();
  assert.equal(f.requests.length, 4);
  assert.equal(f.executed.length, 0);
  const final = [...f.chat.messages].reverse().find((message) => message.meta?.phase === "final");
  assert.equal(final.meta?.modelFinalContent, premature);
  assert.equal(final.meta?.stopReason, "recovery_exhausted");
  assert.match(final.content, /尚未触发本轮推理预算/);
  assert.equal((final.meta?.roundBudget).limitReached, false);
});
test("one model tool round can dispatch many tools without spending one budget round per call", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u89C2\u5BDF\u5E76\u6D4B\u8BD5", (_request, index) => index === 0 ? reply(null, Array.from({ length: 10 }, (_, step) => call("browser_get", { what: "text", selector: `#${step}` }))) : reply("\u5341\u5904\u9875\u9762\u4FE1\u606F\u5747\u5DF2\u8BFB\u53D6\uFF0C\u4EE5\u4E0A\u662F\u672C\u6B21\u89C2\u5BDF\u7684\u7ED3\u679C\u3002"));
  await f.run();
  const budget = f.end()?.meta?.roundBudget;
  assert.equal(budget.used, 2);
  assert.equal(budget.toolRounds, 1);
  assert.equal(budget.toolCalls, 10);
  assert.equal(budget.providerAttempts, 2);
  assert.equal(budget.limitReached, false);
  const hostFacts = f.requests[1].messages.find((message) => String(message.content).startsWith("[\u5BBF\u4E3B\u6267\u884C\u4E8B\u5B9E]"));
  assert.match(String(hostFacts?.content), /"toolCalls":10/);
  assert.match(String(hostFacts?.content), /"used":2/);
});
test("a granted continuation persists the extended budget and clears current summary-round state", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (_request, index) => index < 4 ? reply(null, [call("browser_get", { what: "text", selector: `#${index}` })]) : reply("\u5DF2\u786E\u8BA4\u5F53\u524D\u89C2\u5BDF\u7ED3\u679C\uFF0C\u4EE5\u4E0A\u662F\u672C\u6B21\u6D4B\u8BD5\u7684\u7ED3\u679C\u3002"), void 0, 4, () => "\u518D\u7EE7\u7EED 12 \u8F6E");
  await f.run();
  assert.equal(f.asks.length, 1);
  const budget = f.end()?.meta?.roundBudget;
  assert.equal(budget.initialLimit, 4);
  assert.equal(budget.used, 5);
  assert.ok(budget.limit > 4);
  assert.equal(budget.extensions, 1);
  assert.equal(budget.continuationRequests, 1);
  assert.equal(budget.summaryRoundReached, true);
  assert.equal(budget.summaryRound, false);
  assert.equal(budget.limitReached, false);
  assert.equal(f.end()?.meta?.stopReason, "model_final");
});
test("target value readback cannot certify earlier Tab focus or Ctrl+A selection", async (t) => {
  const modelText = "\u5DF2\u5B8C\u6210\u5E76\u7ECF\u56DE\u8BFB\u6838\u5B9E\uFF1A\n\n| \u52A8\u4F5C | \u72B6\u6001 | \u8BC1\u636E |\n| Tab | \u2705\u5B8C\u6210 | \u540E\u7EED\u8F93\u5165\u503C\u6B63\u786E |\n| Ctrl+A | \u2705\u5B8C\u6210\u5168\u9009 | \u540E\u7EED\u76EE\u6807\u8F93\u5165\u503C\u6B63\u786E |\n| \u8F93\u5165 | \u5DF2\u56DE\u8BFB | \u5B57\u6BB5\u503C\u5339\u914D |";
  const calls = [call("browser_press", { windowId: "page", key: "Tab" }), call("browser_press", { windowId: "page", key: "Ctrl+A" }), call("browser_type", { windowId: "page", ref: "n1e1", text: "synthetic-private-value" })];
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5\u952E\u76D8\u5E76\u586B\u5199", (_request, index) => index < calls.length ? reply(null, [calls[index]]) : reply(modelText), async (name) => name === "browser_type" ? { ok: true, input: { effect: "confirmed", submitDispatched: false } } : { ok: true });
  await f.run();
  const final = [...f.chat.messages].reverse().find((message) => message.meta?.phase === "final");
  assert.equal(f.requests.length, 4);
  assert.equal(f.executed.length, 3);
  assert.equal(final.meta?.modelFinalContent, modelText);
  assert.match(final.content, /焦点切换未独立核实/);
  assert.match(final.content, /选区变化未独立核实/);
  const evidence = final.meta?.completionEvidence;
  assert.equal(evidence.fieldValuesConfirmed, 1);
  assert.equal(evidence.submitEventsDispatched, 0);
  assert.equal(evidence.keyboard.dispatched.tab, 1);
  assert.equal(evidence.keyboard.dispatched.selectAll, 1);
  assert.equal(evidence.keyboard.effectsIndependentlyConfirmed, false);
  assert.doesNotMatch(JSON.stringify(evidence), /synthetic-private-value/);
});
test("resolved finish cannot certify native release when the controller readback remains unsafe", async (t) => {
  let finishes = 0, runId;
  const f = await fixture(t, "\u81EA\u52A8\u5316\u89C2\u5BDF", (_request, index) => {
    if (index === 0) return reply(null, [call("browser_get", { what: "text" })]);
    Object.assign(f.registry, { getTree: () => [{ windows: [{ windowId: "page" }] }], getWindowRecord: () => ({ win: { isDestroyed: () => false, automation: { finishRun: async () => {
      finishes++;
    }, snapshot: () => ({ leaseRunId: runId, nativeConfirmed: false, nativePending: false, inputProtected: true, isolateInput: true, keepRendering: true }) } } }) });
    return reply("\u5DF2\u89C2\u5BDF\u5F53\u524D\u9875\u9762\u3002");
  }, async (_name, _args, ctx) => {
    runId = ctx.browserRunId;
    return { ok: true };
  });
  await f.run();
  const final = [...f.chat.messages].reverse().find((message) => message.meta?.phase === "final");
  assert.ok(final, JSON.stringify(f.chat.messages.filter((message) => message.role === "log")));
  assert.equal(finishes, 1);
  assert.match(final.content, /页面输入清理尚未确认/);
  assert.deepEqual(final.meta?.settlement, { version: 1, status: "unconfirmed", rejectedCleanup: 0, nativeReleasesUnconfirmed: 1, retainedPages: 1 });
  assert.deepEqual(final.meta?.settlement, f.end()?.meta?.settlement);
});
test("actual runtime accepts a fresh unrelated action after independently observed Enter lifecycle effect without replaying it", async (t) => {
  const target = { webContentsId: 1, processId: 2, routingId: 3, documentId: 4, backendNodeId: 5 };
  const f = await fixture(t, "\u81EA\u52A8\u5316\u4FEE\u6539\u540E\u70B9\u51FB\u7B5B\u9009", (_request, index) => index === 0 ? reply(null, [call("browser_type", { windowId: "page", ref: "n1e1", text: "synthetic" })]) : index === 1 ? reply(null, [call("browser_click", { windowId: "page", ref: "n2e2" })]) : reply("\u5DF2\u89C2\u5BDF\u5230\u63D0\u4EA4\u540E\u7684\u6587\u5B57\u53D8\u5316\u5E76\u70B9\u51FB\u7B5B\u9009\uFF0C\u670D\u52A1\u7AEF\u4FDD\u5B58\u4ECD\u9700\u53E6\u884C\u6838\u5BF9\u3002"), async (name) => name === "browser_type" ? { ok: false, error: "STALE_TARGET", input: { target, effect: "confirmed", dispatchedSteps: 9, submitDispatched: true, submitAttempted: true, submission: { status: "partial", cleanup: "confirmed" }, pageResult: { status: "observed", evidence: "new_visible_noneditable_text", targetState: "removed", coverage: "complete" } } } : { ok: true });
  await f.run();
  assert.deepEqual(f.executed.map((item) => item.name), ["browser_type", "browser_click"]);
  assert.equal(f.end()?.meta?.stopReason, "model_final");
});
test("host budget fallback follows failed native cleanup and explicitly preserves its uncertainty", async (t) => {
  let cleanupDrained = false;
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", (_request, index) => {
    if (index === 3) {
      Object.assign(f.registry, { getTree: () => [{ windows: [{ windowId: "retained" }] }], getWindowRecord: () => ({ win: { isDestroyed: () => false, automation: { finishRun: async () => {
        cleanupDrained = true;
        throw Error("release_unconfirmed");
      } } } }) });
    }
    return reply(null, [call("browser_get", { windowId: "page", what: "text" })]);
  }, void 0, 4);
  await f.run();
  assert.equal(cleanupDrained, true);
  const final = [...f.chat.messages].reverse().find((message) => message.role === "assistant" && message.meta?.phase === "final");
  assert.match(final.content, /输入清理尚未确认/);
  assert.match(final.content, /已保留 1 个浏览器页面/);
});
test("actual runtime records genuine provider rate limiting separately from policy reminders", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", () => ({ httpStatus: 429, error: { message: "fixture rate limit" } }));
  await f.run();
  assert.equal(f.executed.length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.end()?.meta?.stopReason, "provider_rate_limited");
});
test("actual runtime stops after user cancellation without calling the provider again", async (t) => {
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5", () => reply(null, [call("browser_get", { what: "text" })]), async () => {
    f.runtime.stop("chat");
    return { ok: true, value: "fixture" };
  });
  await f.run();
  assert.equal(f.requests.length, 1);
  assert.equal(f.executed.length, 1);
  assert.equal(f.end()?.meta?.stopReason, "user_cancelled");
});
test("actual Agent stop releases every page owned by its run while preserving another run and manual pages", async (t) => {
  const pages = Array.from({ length: 4 }, () => {
    const api = automationTestApi();
    let resets = 0;
    const wc = Object.assign(new EventEmitter(), {
      ...api,
      isDestroyed: () => false,
      resetAutomationOptions: async () => {
        resets++;
        await api.resetAutomationOptions();
      }
    });
    const controller = getBrowserAutomationController(wc);
    t.after(() => controller.dispose());
    return { controller, get resets() {
      return resets;
    } };
  });
  let untouchedEpochs = [], untouchedResets = [];
  const f = await fixture(t, "\u81EA\u52A8\u5316\u6D4B\u8BD5\u505C\u6B62\u7684\u9875\u9762\u5F52\u5C5E", () => reply(null, [call("browser_get", { what: "text" })]), async (_name, _args, context) => {
    assert.ok(context.browserRunId);
    await pages[0].controller.claimRun(context.browserRunId);
    await pages[1].controller.claimRun(context.browserRunId);
    await pages[2].controller.claimRun("different-agent-run");
    await pages[3].controller.takeControl();
    untouchedEpochs = pages.slice(2).map((page) => page.controller.captureEpoch());
    untouchedResets = pages.slice(2).map((page) => page.resets);
    Object.assign(f.registry, {
      getTree: () => [{ windows: pages.map((_page, index) => ({ windowId: String(index) })) }],
      getWindowRecord: (id) => ({ win: { isDestroyed: () => false, automation: pages[Number(id)].controller } })
    });
    assert.equal(f.runtime.stop("chat"), true);
    return { ok: true, value: "cancelled fixture" };
  });
  await f.run();
  for (const page of pages.slice(0, 2)) {
    const state = page.controller.snapshot();
    assert.equal(state.owner, "paused");
    assert.equal(state.leaseRunId, void 0);
    assert.equal(state.inputProtected, false);
    assert.equal(state.isolateInput, false);
    assert.equal(state.keepRendering, false);
    assert.equal(page.resets, 1, "stop and finally share one reset");
  }
  assert.deepEqual(pages.slice(2).map((page) => page.controller.captureEpoch()), untouchedEpochs);
  assert.deepEqual(pages.slice(2).map((page) => page.resets), untouchedResets);
  assert.equal(pages[2].controller.snapshot().leaseRunId, "different-agent-run");
  assert.equal(pages[2].controller.snapshot().inputProtected, true);
  assert.equal(pages[3].controller.snapshot().owner, "user");
  assert.equal(f.end()?.meta?.stopReason, "user_cancelled");
});
test("application closing rejects actual root/child starts and retry admission before any provider or chat writes, and can reopen after failure", async (t) => {
  const f = await fixture(t, "\u5173\u95ED\u671F\u95F4\u7684\u65B0\u4EFB\u52A1", () => reply("\u6062\u590D\u540E\u5B8C\u6210\u3002"));
  const original = structuredClone(f.chat.messages);
  f.runtime.setClosing(true);
  assert.throws(() => f.runtime.assertCanRun("chat"), /app_closing/);
  await assert.rejects(f.run(), /app_closing/);
  await assert.rejects(f.runtime.run({ chatId: "child", userText: "\u5B50\u4EFB\u52A1" }), /app_closing/);
  await assert.rejects(f.runtime.run({ chatId: "chat", userText: "\u91CD\u8BD5" }), /app_closing/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.chat.messages, original);
  f.runtime.setClosing(false);
  await f.run();
  assert.equal(f.requests.length, 1);
  assert.equal(f.runtime.hasRunLease("chat"), false);
});
test("closing refuses inserted messages while the cancelled run retains its cleanup lease", async (t) => {
  let entered, release;
  const started = new Promise((resolve) => entered = resolve), held = new Promise((resolve) => release = resolve);
  const f = await fixture(t, "\u6267\u884C\u65E7\u4EFB\u52A1", (_request, index) => index === 0 ? reply(null, [call("browser_get", { windowId: "page", what: "text" })]) : reply("\u65B0\u4E00\u8F6E\u5B8C\u6210\u3002"), async () => {
    entered();
    await held;
    return { ok: true };
  });
  const running = f.run();
  await started;
  f.runtime.setClosing(true);
  const messages = f.chat.messages.length;
  assert.throws(() => f.runtime.insertUserInput("chat", { content: "\u4E0D\u5E94\u5728\u9000\u51FA\u671F\u95F4\u63D2\u5165" }), /app_closing/);
  assert.equal(f.chat.messages.length, messages);
  f.runtime.stopAll();
  assert.equal(f.runtime.isRunning("chat"), false);
  assert.equal(f.runtime.hasRunLease("chat"), true);
  await assert.rejects(f.runtime.run({ chatId: "chat", userText: "\u65E7\u4EFB\u52A1\u672A\u56DE\u6536\u524D\u7684\u91CD\u8BD5" }), /app_closing/);
  release();
  await running;
  assert.equal(f.requests.length, 1);
  assert.equal(f.runtime.hasRunLease("chat"), false);
  f.runtime.setClosing(false);
  await f.run();
  assert.equal(f.requests.length, 2);
});
test("closing preserves pending ask and submitted questionnaire continuations until explicit recovery can resume them", async (t) => {
  const root = await fs2.mkdtemp(path2.join(tempRoot, "closing-continuation-")), questionnaires = new QuestionnaireStore(root);
  const f = await fixture(t, "\u7EE7\u7EED\u4E4B\u524D\u7684\u4EFB\u52A1", () => reply("\u5DF2\u6839\u636E\u7B54\u6848\u5B8C\u6210\u3002"), void 0, 24, void 0, { questionnaires });
  const ask = { id: "pending-ask", chatId: "chat", kind: "choice", question: "\u7EE7\u7EED\u5417\uFF1F", options: ["\u7EE7\u7EED"], allowCustom: true, timeoutMs: 0 };
  f.chat.pendingAsk = ask;
  const record2 = questionnaires.create({ title: "\u9000\u51FA\u524D\u95EE\u5377", questions: [{ id: "name", title: "\u540D\u79F0", type: "text" }] }, { chatId: "chat", runId: "previous-run", toolCallId: "previous-tool" });
  assert.equal(questionnaires.submit(record2.id, { revision: 0, submissionId: "submitted-before-close" }).ok, true);
  const before2 = questionnaires.get(record2.id), messages = structuredClone(f.chat.messages);
  f.runtime.setClosing(true);
  await assert.rejects(f.runtime.continueAfterPersistedAsk("chat", ask, { id: ask.id, source: "option", answer: "\u7EE7\u7EED" }), /app_closing/);
  await assert.rejects(f.runtime.continueAfterPersistedQuestionnaire(before2), /app_closing/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.chat.pendingAsk, ask);
  assert.deepEqual(questionnaires.get(record2.id), before2);
  assert.deepEqual(f.chat.messages, messages);
  f.runtime.setClosing(false);
  await f.runtime.continueAfterPersistedAsk("chat", ask, { id: ask.id, source: "option", answer: "\u7EE7\u7EED" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.chat.pendingAsk, void 0);
  await f.runtime.continueAfterPersistedQuestionnaire(questionnaires.get(record2.id));
  assert.equal(f.requests.length, 2);
  assert.equal(questionnaires.get(record2.id)?.continuation?.state, "done");
});
