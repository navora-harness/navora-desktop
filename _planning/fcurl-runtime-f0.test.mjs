// electron/modules/fcurl-runtime.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs3 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import http from "node:http";
import { once, EventEmitter } from "node:events";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";

// electron/modules/fcurl-runtime.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

// electron/modules/plugin-package.ts
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// shared/plugin-platform.ts
function safeRuntimePath(raw) {
  return typeof raw === "string" && raw.length > 0 && !/[\\:\x00-\x1f]/.test(raw) && !raw.startsWith("/") && raw.split("/").every((p) => p !== "." && p !== ".." && !!p);
}
function assertPlatformPackage(raw) {
  if (raw.packageFormatVersion == null || raw.packageFormatVersion === 1) {
    if (raw.target || raw.runtime || raw.artifactId) throw new Error("package_format_required");
    return;
  }
  if (raw.packageFormatVersion !== 2) throw new Error("unsupported_package_format");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(raw.artifactId || "")) throw new Error("invalid_artifact_id");
  const t = raw.target;
  if (!t || !["portable", "platform"].includes(t.kind)) throw new Error("invalid_target");
  if (t.kind === "platform") {
    if (!["win32", "darwin", "linux"].includes(t.os) || !["x64", "arm64"].includes(t.arch)) throw new Error("invalid_target");
    if (t.linkage && !["static", "dynamic"].includes(t.linkage)) throw new Error("invalid_target");
    if (t.libc && !["glibc", "musl"].includes(t.libc)) throw new Error("invalid_target");
    if ((t.libc || t.minLibcVersion || t.minKernelVersion) && t.os !== "linux") throw new Error("invalid_target");
    if (t.linkage === "static" && (t.libc || t.minLibcVersion)) throw new Error("invalid_target");
    if (t.os === "linux" && t.linkage !== "static" && !t.libc) throw new Error("libc_required");
    for (const v of [t.minOsVersion, t.minKernelVersion, t.minLibcVersion]) {
      if (v !== void 0 && !/^\d+(\.\d+){0,3}$/.test(v)) throw new Error("invalid_target_version");
    }
  }
  const r = raw.runtime;
  if (!r || !["electron-main", "executable-sidecar"].includes(r.kind)) throw new Error("invalid_runtime");
  if (r.kind === "executable-sidecar") {
    if (t.kind !== "platform" || !safeRuntimePath(r.executable) || r.invocation !== "oneshot" || r.adapter !== "fcurl-cli-v0.2" || r.protocolVersion !== "1" || !/^\d+\.\d+\.\d+$/.test(r.binaryVersion)) throw new Error("invalid_runtime");
  }
  if (raw.minHostVersion !== void 0 && !/^\d+\.\d+\.\d+$/.test(raw.minHostVersion)) throw new Error("invalid_host_version");
}

// shared/plugin-package-limits.ts
var PLUGIN_PACKAGE_MAX_EXPANDED_BYTES = 500 * 1024 * 1024;
var PLUGIN_PACKAGE_MAX_ENTRIES = 1e4;

// electron/modules/plugin-package.ts
function writeRuntimeInventory(dir2) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir2, "plugin.json"), "utf8"));
  if (manifest.packageFormatVersion !== 2) return;
  assertPlatformPackage(manifest);
  const files = [];
  const executable = manifest.runtime?.kind === "executable-sidecar" ? manifest.runtime.executable : null;
  const walk = (base) => {
    for (const e of fs.readdirSync(path.join(dir2, base), { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (!safeRuntimePath(rel) || e.isSymbolicLink()) throw new Error("invalid_runtime_path");
      if (e.isDirectory()) walk(rel);
      else if (rel !== "runtime-files.json") {
        const data = fs.readFileSync(path.join(dir2, rel));
        files.push({ path: rel, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), ...rel === executable ? { executable: true } : {} });
      }
    }
  };
  walk("");
  files.sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(dir2, "runtime-files.json"), JSON.stringify({ version: 1, files }, null, 2) + "\n");
}
function assertRuntimeFiles(dir2, manifest, restoreMode = false) {
  assertPlatformPackage(manifest);
  if (manifest.packageFormatVersion !== 2) return;
  const listPath = path.join(dir2, "runtime-files.json");
  if (!fs.existsSync(listPath)) throw new Error("runtime_manifest_missing");
  if (fs.statSync(listPath).size > 2 * 1024 * 1024) throw new Error("runtime_manifest_too_large");
  const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
  if (list.version !== 1 || !Array.isArray(list.files) || list.files.length > PLUGIN_PACKAGE_MAX_ENTRIES) throw new Error("invalid_runtime_manifest");
  const seen = /* @__PURE__ */ new Set();
  for (const f of list.files) {
    if (!safeRuntimePath(f.path) || f.path === "runtime-files.json" || seen.has(f.path.toLowerCase()) || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error("invalid_runtime_manifest");
    seen.add(f.path.toLowerCase());
    const full = path.join(dir2, f.path);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      throw new Error(`runtime_file_missing:${f.path}`);
    }
    let current = dir2;
    for (const part of f.path.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("runtime_symlink");
    }
    if (!stat.isFile() || stat.size !== f.size) throw new Error(`runtime_file_size:${f.path}`);
    const hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (hash !== f.sha256) throw new Error(`runtime_hash_mismatch:${f.path}`);
    if (restoreMode && f.executable && process.platform !== "win32") fs.chmodSync(full, 493);
  }
  const walk = (base) => {
    for (const e of fs.readdirSync(path.join(dir2, base), { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error("runtime_symlink");
      if (e.isDirectory()) walk(rel);
      else if (rel !== "runtime-files.json" && !seen.has(rel.toLowerCase())) throw new Error(`runtime_file_unlisted:${rel}`);
    }
  };
  walk("");
  const r = manifest.runtime;
  if (r?.kind === "executable-sidecar") {
    const f = list.files.find((f2) => f2.path === r.executable);
    if (!f?.executable) throw new Error("runtime_executable_missing");
    const b = fs.readFileSync(path.join(dir2, r.executable));
    const t = manifest.target;
    if (t?.kind !== "platform") throw new Error("invalid_target");
    if (t.os === "win32") {
      if (b.length < 64 || b.toString("ascii", 0, 2) !== "MZ") throw new Error("invalid_binary");
      const pe = b.readUInt32LE(60);
      if (pe + 6 > b.length || b.readUInt32LE(pe) !== 17744 || b.readUInt16LE(pe + 4) !== (t.arch === "x64" ? 34404 : 43620)) throw new Error("binary_arch_mismatch");
    } else if (t.os === "linux") {
      if (b.length < 64 || b.readUInt32BE(0) !== 2135247942 || b[4] !== 2 || b[5] !== 1 || b.readUInt16LE(18) !== (t.arch === "x64" ? 62 : 183)) throw new Error("binary_arch_mismatch");
      if (t.linkage === "static") {
        const offset = Number(b.readBigUInt64LE(32)), size = b.readUInt16LE(54), count = b.readUInt16LE(56);
        if (size < 56 || !Number.isSafeInteger(offset) || offset + size * count > b.length) throw new Error("invalid_binary");
        for (let i = 0; i < count; i++) if ([2, 3].includes(b.readUInt32LE(offset + i * size))) throw new Error("binary_not_static");
      }
    } else if (b.length < 8 || b.readUInt32LE(0) !== 4277009103 || b.readUInt32LE(4) !== (t.arch === "x64" ? 16777223 : 16777228)) throw new Error("binary_arch_mismatch");
  }
}

// shared/network-url-policy.ts
function networkUrlAllowed(raw, rules = []) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\x00-\x20\x7f]/.test(raw)) return false;
  const list = rules.map((r) => r.trim()).filter(Boolean);
  if (!list.length) return true;
  return list.some((rule) => {
    if (/^https?:\/\//i.test(rule)) {
      try {
        const r = new URL(rule);
        if (r.origin !== url.origin || r.username || r.password || r.search || r.hash) return false;
        if (/%(?:2f|5c)/i.test(url.pathname)) return false;
        const prefix = r.pathname.replace(/\/+$/, "");
        return !prefix || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
      } catch {
        return false;
      }
    }
    const wildcard = rule.startsWith("*.");
    try {
      const r = new URL(`http://${wildcard ? rule.slice(2) : rule}`);
      if (r.pathname !== "/" || r.username || r.password || r.search || r.hash) return false;
      const explicitPort = /:(\d+)$/.exec(rule)?.[1];
      if (explicitPort && Number(url.port || (url.protocol === "https:" ? 443 : 80)) !== Number(explicitPort)) return false;
      return url.hostname === r.hostname || wildcard && url.hostname.endsWith(`.${r.hostname}`);
    } catch {
      return false;
    }
  });
}

// electron/modules/fcurl-runtime.ts
var INPUT_LIMIT = 1024 * 1024;
var OUTPUT_LIMIT = 8 * 1024 * 1024;
var DISPLAY_LIMIT = 64 * 1024;
var known = /* @__PURE__ */ new Set(["url", "method", "headers", "query", "bodyText", "bodyBase64", "json", "form", "profile", "ja3", "ja4r", "proxy", "timeoutMs", "responseMode"]);
var token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
var failure = (error, extra = {}) => ({ ok: false, error, ...extra });
var codeErrors = { 1: "unsupported_scheme", 2: "invalid_request", 3: "invalid_url", 5: "proxy_dns_failed", 6: "dns_failed", 7: "connection_failed", 23: "output_failed", 26: "input_failed", 28: "request_timeout", 35: "tls_error", 47: "redirect_limit", 56: "receive_failed", 60: "certificate_failed", 77: "ca_failed", 130: "request_cancelled" };
function parseFcurlHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).map((x) => x.trim()).filter(Boolean);
  let result;
  for (const block of blocks) {
    const [line, ...lines] = block.split(/\r?\n/);
    const match = /^HTTP\/(\d(?:\.\d)?) (\d{3})(?: |$)/.exec(line || "");
    if (!match) throw new Error("response_parse_failed");
    const status = Number(match[2]);
    if (status < 100 || status > 599) throw new Error("response_parse_failed");
    const headers = lines.map((line2) => {
      const colon = line2.indexOf(":");
      if (colon <= 0 || !token.test(line2.slice(0, colon))) throw new Error("response_parse_failed");
      return { name: line2.slice(0, colon), value: line2.slice(colon + 1).trim() };
    });
    if (status >= 200) result = { status, httpVersion: match[1], headers };
  }
  if (!result) throw new Error("response_parse_failed");
  return result;
}
var FcurlRuntimeManager = class {
  constructor(root, options = {}) {
    this.root = root;
    this.limits = {
      maxConcurrent: options.maxConcurrent ?? 16,
      maxPerChat: options.maxPerChat ?? 4,
      maxQueued: options.maxQueued ?? 32,
      maxQueuedPerChat: options.maxQueuedPerChat ?? 8
    };
    if (Object.values(this.limits).some((n) => !Number.isInteger(n) || n < 1)) throw new Error("invalid_runtime_limits");
    this.trustSource = process.env.SSL_CERT_FILE || process.env.SSL_CERT_DIR ? "environment_custom" : "system";
    for (const name of ["SSL_CERT_FILE", "SSL_CERT_DIR"]) {
      const value = process.env[name];
      if (!value) continue;
      this.certificateEnv[name] = value;
      for (const entry of name === "SSL_CERT_DIR" ? value.split(path2.delimiter) : [value]) {
        try {
          if (!path2.isAbsolute(entry) || entry.includes("\0")) throw new Error("invalid_certificate_environment");
          const stat = fs2.statSync(entry);
          if (name === "SSL_CERT_FILE" ? !stat.isFile() : !stat.isDirectory()) throw new Error("invalid_certificate_environment");
        } catch {
          this.certificateEnvironmentValid = false;
        }
      }
    }
    fs2.mkdirSync(root, { recursive: true, mode: 448 });
    for (const name of fs2.readdirSync(root)) {
      if (!/^call-[a-zA-Z0-9]+$/.test(name)) continue;
      const dir2 = path2.join(root, name);
      try {
        const owner = JSON.parse(fs2.readFileSync(path2.join(dir2, "owner.json"), "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) continue;
        try {
          process.kill(owner.pid, 0);
          continue;
        } catch (e) {
          if (e.code !== "ESRCH") continue;
        }
        if (owner.processClosed !== true) {
          if (!Number.isInteger(owner.childPid) || Number(owner.childPid) <= 0) continue;
          try {
            process.kill(owner.childPid, 0);
            continue;
          } catch (e) {
            if (e.code !== "ESRCH") continue;
          }
        }
        fs2.rmSync(dir2, { recursive: true, force: true });
      } catch {
      }
    }
  }
  // Reservations exist before verification, staging and spawn, so asynchronous
  // preparation cannot bypass the same limits enforced for live processes.
  calls = /* @__PURE__ */ new Map();
  queue = [];
  closed = false;
  disposing;
  cleanupFailures = /* @__PURE__ */ new Map();
  limits;
  certificateEnv = {};
  trustSource;
  certificateEnvironmentValid = true;
  matches(call, scope) {
    return (!scope.pluginId || scope.pluginId === call.scope.pluginId) && (!scope.chatId || scope.chatId === call.scope.chatId);
  }
  isActive(pluginId) {
    return [...this.calls.values()].some((x) => x.scope.pluginId === pluginId);
  }
  cancel(scope = {}) {
    for (const call of this.calls.values()) if (this.matches(call, scope)) this.stopCall(call, "request_cancelled");
  }
  async drain(scope = {}) {
    await Promise.all([...this.calls.values()].filter((call) => this.matches(call, scope)).map((call) => call.done));
    for (const [dir2, owner] of [...this.cleanupFailures]) {
      if (scope.pluginId && scope.pluginId !== owner.pluginId || scope.chatId && scope.chatId !== owner.chatId) continue;
      try {
        await fs2.promises.rm(dir2, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
        this.cleanupFailures.delete(dir2);
      } catch {
        throw new Error("runtime_cleanup_failed");
      }
    }
  }
  cancelAndWait(scope = {}) {
    this.cancel(scope);
    return this.drain(scope);
  }
  dispose() {
    if (this.disposing) return this.disposing;
    this.closed = true;
    const draining = this.cancelAndWait().catch((error) => {
      this.disposing = void 0;
      throw error;
    });
    return this.disposing = draining;
  }
  stopCall(call, reason) {
    call.reason ||= reason;
    if (call.state === "queued") {
      this.queue = this.queue.filter((x) => x !== call);
      call.admit(false);
    } else call.stop?.(call.reason);
  }
  pump() {
    if (this.closed) return;
    const running = [...this.calls.values()].filter((x) => x.state === "running");
    let available = this.limits.maxConcurrent - running.length;
    const perChat = /* @__PURE__ */ new Map();
    for (const call of running) perChat.set(call.scope.chatId, (perChat.get(call.scope.chatId) || 0) + 1);
    for (const call of [...this.queue]) {
      if (available <= 0) break;
      if (call.reason) continue;
      if (performance.now() >= call.deadline) {
        this.stopCall(call, "request_timeout");
        continue;
      }
      const count = perChat.get(call.scope.chatId) || 0;
      if (count >= this.limits.maxPerChat) continue;
      this.queue = this.queue.filter((x) => x !== call);
      call.state = "running";
      perChat.set(call.scope.chatId, count + 1);
      available--;
      call.admit(true);
    }
  }
  async call(scope, method, input) {
    if (method !== "status" && method !== "profiles" && method !== "request") return { ...failure("runtime_method_not_allowed"), trustSource: this.trustSource };
    const requestId = randomUUID(), startedAt = Date.now(), startedTick = performance.now();
    let invocation;
    const withReceipt = (result2) => {
      const dispatched = invocation?.processStarted ?? false;
      const error = typeof result2.error === "string" ? result2.error : void 0;
      const receipt = {
        version: 1,
        requestId,
        ...invocation?.attemptId ? { attemptId: invocation.attemptId } : {},
        pluginId: scope.pluginId,
        chatId: scope.chatId,
        ...scope.runId ? { runId: scope.runId } : {},
        ...scope.toolCallId ? { toolCallId: scope.toolCallId } : {},
        method,
        state: result2.ok === true ? "completed" : error === "request_cancelled" ? "cancelled" : dispatched ? "failed" : "rejected",
        dispatched,
        startedAt,
        finishedAt: Date.now(),
        ...typeof result2.status === "number" ? { httpStatus: result2.status } : {},
        ...typeof result2.bodyBytes === "number" ? { bytes: result2.bodyBytes } : {},
        ...error ? { error } : {}
      };
      scope.onReceipt?.({ ...receipt });
      return { ...result2, elapsedMs: performance.now() - startedTick, trustSource: this.trustSource, receipt };
    };
    if (this.closed) return withReceipt(failure("runtime_closed"));
    if (scope.signal.aborted) return withReceipt(failure("request_cancelled"));
    if (scope.isCurrent && !scope.isCurrent()) return withReceipt(failure("request_stale"));
    const cap = method === "request" ? "network.request" : "compute.local";
    if (!scope.capabilities.includes(cap)) return withReceipt(failure(`plugin_capability_not_declared:${cap}`));
    const runtime = scope.manifest.runtime;
    if (runtime?.kind !== "executable-sidecar" || runtime.adapter !== "fcurl-cli-v0.2") return withReceipt(failure("runtime_unavailable"));
    if (!this.certificateEnvironmentValid) return withReceipt(failure("certificate_environment_invalid"));
    let prepared;
    try {
      if (method === "request") prepared = this.prepareRequest(scope, input);
    } catch (e) {
      return withReceipt(this.safeFailure(e));
    }
    const admission = method === "request" ? scope.admission?.() : null;
    if (admission) return withReceipt(admission);
    const filter = typeof input.filter === "string" ? input.filter.toLowerCase() : "";
    const offset = Number.isInteger(input.offset) && Number(input.offset) >= 0 ? Number(input.offset) : 0;
    const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(200, Number(input.limit))) : 50;
    const running = [...this.calls.values()].filter((x) => x.state === "running");
    const willQueue = running.length >= this.limits.maxConcurrent || running.filter((x) => x.scope.chatId === scope.chatId).length >= this.limits.maxPerChat;
    if (willQueue && (this.queue.length >= this.limits.maxQueued || this.queue.filter((x) => x.scope.chatId === scope.chatId).length >= this.limits.maxQueuedPerChat)) return withReceipt(failure("resource_limit"));
    let admit, finish;
    const admitted = new Promise((resolve) => {
      admit = resolve;
    });
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    invocation = {
      id: requestId,
      scope,
      deadline: performance.now() + (prepared?.timeout ?? 1e4),
      state: "queued",
      admit,
      done,
      finish,
      processStarted: false,
      processClosed: false
    };
    const call = invocation;
    this.calls.set(call.id, call);
    this.queue.push(call);
    const abort = () => this.stopCall(call, "request_cancelled");
    scope.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => this.stopCall(call, "request_timeout"), Math.max(1, call.deadline - performance.now()));
    if (scope.signal.aborted) abort();
    this.pump();
    let dir2, result;
    try {
      if (!await admitted || call.reason) result = failure(call.reason || "request_cancelled");
      else {
        const afterQueue = this.checkAdmission(call, method);
        if (afterQueue) result = afterQueue;
        else {
          assertRuntimeFiles(scope.dir, scope.manifest);
          if (call.reason || performance.now() >= call.deadline) result = failure(call.reason || "request_timeout");
          else {
            dir2 = fs2.mkdtempSync(path2.join(this.root, "call-"));
            fs2.writeFileSync(path2.join(dir2, "owner.json"), JSON.stringify({ pid: process.pid, requestId, processClosed: true }), { mode: 384, flag: "wx" });
            const executable = path2.join(scope.dir, runtime.executable);
            if (prepared) result = await this.request(call, executable, prepared, dir2);
            else {
              const args = method === "status" ? ["--version"] : ["--list-profiles"];
              const r = await this.run(call, executable, args, Buffer.alloc(0), dir2, 256 * 1024);
              if (r.reason || r.code !== 0) result = failure(r.reason || "runtime_start_failed", { exitCode: r.code });
              else if (method === "status") {
                const version = r.body.toString("utf8").trim();
                result = !version.startsWith(`fcurl ${runtime.binaryVersion} `) ? failure("runtime_version_mismatch") : {
                  ok: true,
                  version,
                  artifactId: scope.manifest.artifactId,
                  capabilities: ["profiles", "request", "manual_redirect"],
                  trustSource: this.trustSource,
                  trustConfiguration: this.trustSource === "system" ? "system_default" : "host_environment",
                  processCleanup: "direct_child_close",
                  parentDeathCleanup: false
                };
              } else {
                const profiles = r.body.toString("utf8").trim().split(/\r?\n/).filter((x) => x && x.toLowerCase().includes(filter));
                result = { ok: true, total: profiles.length, profiles: profiles.slice(offset, offset + limit), offset };
              }
            }
          }
        }
      }
    } catch (e) {
      result = this.safeFailure(e);
    } finally {
      scope.signal.removeEventListener("abort", abort);
      if (dir2) {
        try {
          await fs2.promises.rm(dir2, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
        } catch {
          this.cleanupFailures.set(dir2, { pluginId: scope.pluginId, chatId: scope.chatId });
          result = failure("runtime_cleanup_failed");
        }
      }
      clearTimeout(timer);
      this.queue = this.queue.filter((x) => x !== call);
      this.calls.delete(call.id);
      call.finish();
      this.pump();
    }
    if (!call.reason && performance.now() >= call.deadline) call.reason = "request_timeout";
    if (call.reason && result.error !== "runtime_cleanup_failed") result = failure(call.reason);
    if (!call.reason && !["request_cancelled", "runtime_cleanup_failed"].includes(String(result.error)) && scope.isCurrent && !scope.isCurrent()) result = failure("request_stale");
    return withReceipt(result);
  }
  checkAdmission(call, method) {
    if (call.scope.signal.aborted || call.reason) return failure(call.reason || "request_cancelled");
    if (call.scope.isCurrent && !call.scope.isCurrent()) return failure("request_stale");
    return method === "request" ? call.scope.admission?.() || null : null;
  }
  safeFailure(error) {
    const msg = error instanceof Error ? error.message : "";
    return failure(/^[a-z_]+$/.test(msg) ? msg : "runtime_validation_failed");
  }
  prepareRequest(scope, input) {
    if (Object.keys(input).some((k) => !known.has(k))) throw new Error("unknown_request_field");
    if (typeof input.url !== "string") throw new Error("invalid_url");
    const url = new URL(input.url);
    if (input.query !== void 0) {
      if (!Array.isArray(input.query)) throw new Error("invalid_query");
      for (const p of input.query) {
        if (!p || typeof p.name !== "string" || typeof p.value !== "string") throw new Error("invalid_query");
        url.searchParams.append(p.name, p.value);
      }
    }
    url.hash = "";
    if (!networkUrlAllowed(input.url, scope.allowlist()) || !networkUrlAllowed(url.href, scope.allowlist())) throw new Error("url_not_allowed");
    const modes = ["bodyText", "bodyBase64", "json", "form"].filter((k) => Object.hasOwn(input, k));
    if (modes.length > 1) throw new Error("conflicting_request_body");
    let body = Buffer.alloc(0), contentType;
    if (modes[0] === "json") {
      body = Buffer.from(JSON.stringify(input.json));
      contentType = "application/json";
    } else if (modes[0] === "form") {
      if (!Array.isArray(input.form)) throw new Error("invalid_form");
      const data = new URLSearchParams();
      for (const item of input.form) {
        if (!item || typeof item.name !== "string" || typeof item.value !== "string") throw new Error("invalid_form");
        data.append(item.name, item.value);
      }
      body = Buffer.from(data.toString());
      contentType = "application/x-www-form-urlencoded";
    } else if (modes[0]) {
      const raw = input[modes[0]];
      if (typeof raw !== "string") throw new Error("invalid_request_body");
      if (modes[0] === "bodyBase64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error("invalid_base64");
      body = Buffer.from(raw, modes[0] === "bodyBase64" ? "base64" : "utf8");
    }
    if (body.length > INPUT_LIMIT) throw new Error("request_too_large");
    const method = input.method ?? (modes.length ? "POST" : "GET");
    if (typeof method !== "string" || !token.test(method) || method.length > 32) throw new Error("invalid_method");
    if (method.toUpperCase() === "HEAD" && modes.length) throw new Error("head_body_not_allowed");
    const timeout = input.timeoutMs ?? 3e4;
    if (!Number.isInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 12e4) throw new Error("invalid_timeout");
    const responseMode = input.responseMode ?? "text";
    if (!["text", "json", "base64"].includes(String(responseMode))) throw new Error("invalid_response_mode");
    const headerLines = [], names = /* @__PURE__ */ new Set();
    if (input.headers !== void 0 && !Array.isArray(input.headers)) throw new Error("invalid_headers");
    for (const h of input.headers || []) {
      if (!h || typeof h.name !== "string" || !token.test(h.name) || h.value !== void 0 && typeof h.value !== "string" || /[\x00-\x08\x0a-\x1f\x7f]/.test(h.value || "")) throw new Error("invalid_headers");
      const name = h.name.toLowerCase();
      if (["content-length", "transfer-encoding", "trailer", "proxy-authorization", "host"].includes(name)) throw new Error("reserved_header");
      names.add(name);
      headerLines.push(h.remove ? `${h.name}:` : h.value ? `${h.name}: ${h.value}` : `${h.name};`);
    }
    if (contentType && !names.has("content-type")) headerLines.push(`Content-Type: ${contentType}`);
    if (modes[0] === "json" && !names.has("accept")) headerLines.push("Accept: application/json");
    if (!names.has("accept-encoding")) headerLines.push("Accept-Encoding: identity");
    if (Buffer.byteLength(headerLines.join("\n")) > 32 * 1024) throw new Error("headers_too_large");
    const extraArgs = [];
    const fingerprints = ["profile", "ja3", "ja4r"].filter((k) => input[k] !== void 0);
    if (fingerprints.length > 1) throw new Error("conflicting_fingerprint");
    for (const k of fingerprints) {
      if (typeof input[k] !== "string" || !input[k] || String(input[k]).length > 64 * 1024 || /[\x00-\x1f]/.test(String(input[k]))) throw new Error("invalid_fingerprint");
      if (k === "ja4r" && String(input[k]).startsWith("q")) throw new Error("unsupported_http3");
      extraArgs.push(`--${k}`, String(input[k]));
    }
    if (input.proxy !== void 0) {
      if (typeof input.proxy !== "string") throw new Error("invalid_proxy");
      const proxy = new URL(input.proxy);
      if (!["http:", "https:", "socks5:", "socks5h:"].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname && proxy.pathname !== "/") throw new Error("invalid_proxy");
      extraArgs.push("--proxy", proxy.href);
    }
    if (modes.length) extraArgs.push("--data-binary", "@-");
    return { url, method: method.toUpperCase(), body, headerLines, timeout: Number(timeout), responseMode: String(responseMode), extraArgs };
  }
  async request(call, executable, prepared, dir2) {
    const { url, method, body, headerLines, responseMode, extraArgs } = prepared;
    const admission = this.checkAdmission(call, "request");
    if (admission) return admission;
    const remaining = call.deadline - performance.now();
    if (call.reason || remaining <= 0) return failure(call.reason || "request_timeout");
    if (!networkUrlAllowed(url.href, call.scope.allowlist())) return failure("url_not_allowed");
    const headerFile = path2.join(dir2, "headers-in.txt"), dump = path2.join(dir2, "headers-out.txt");
    fs2.writeFileSync(headerFile, `${headerLines.join("\n")}
`, { mode: 384, flag: "wx" });
    const args = [
      "-sS",
      "--request",
      method,
      "--header",
      `@${headerFile}`,
      "--dump-header",
      dump,
      "--max-time",
      String(remaining / 1e3),
      "--connect-timeout",
      String(Math.min(10, remaining / 1e3)),
      ...extraArgs,
      "--",
      url.href
    ];
    const dispatchAdmission = this.checkAdmission(call, "request");
    if (dispatchAdmission) return dispatchAdmission;
    const scope = call.scope;
    const r = await this.run(call, executable, args, body, dir2, OUTPUT_LIMIT, dump);
    if (r.reason || r.code !== 0) return failure(r.reason || codeErrors[r.code || -1] || "cli_failed", { exitCode: r.code });
    if (!networkUrlAllowed(url.href, scope.allowlist())) return failure("url_not_allowed");
    const raw = fs2.readFileSync(dump);
    if (raw.length > 64 * 1024) return failure("response_headers_too_large");
    const parsed = parseFcurlHeaders(raw.toString("latin1"));
    const encoded = parsed.headers.some((h) => h.name.toLowerCase() === "content-encoding" && h.value.toLowerCase() !== "identity");
    const bodyEncoding = encoded || responseMode === "base64" ? "base64" : "utf8";
    const display = bodyEncoding === "base64" ? r.body.subarray(0, DISPLAY_LIMIT * 3 / 4) : r.body;
    const truncated = r.bytes > display.length;
    let output = bodyEncoding === "base64" ? display.toString("base64") : new TextDecoder().decode(display, { stream: truncated });
    if (responseMode === "json" && !encoded && !truncated) {
      try {
        output = JSON.parse(String(output));
      } catch {
        return failure("invalid_response_json", { status: parsed.status });
      }
    }
    return {
      ok: true,
      httpOk: parsed.status >= 200 && parsed.status < 300,
      ...parsed,
      headers: parsed.headers.map((h) => /^(set-cookie|authorization|proxy-authorization)$/i.test(h.name) ? { ...h, value: "[redacted]" } : h),
      finalUrl: url.href,
      body: output,
      bodyEncoding,
      bodyBytes: r.bytes,
      truncated,
      exitCode: r.code
    };
  }
  run(call, executable, args, input, cwd, max, dump) {
    if (call.reason || performance.now() >= call.deadline) return Promise.resolve({ code: null, signal: null, reason: call.reason || "request_timeout", bytes: 0, body: Buffer.alloc(0) });
    let initialPolicy;
    try {
      initialPolicy = JSON.stringify(call.scope.allowlist());
    } catch {
      return Promise.resolve({ code: null, signal: null, reason: "url_policy_changed", bytes: 0, body: Buffer.alloc(0) });
    }
    return new Promise((resolve, reject) => {
      const env = {};
      for (const k of ["SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"]) if (process.env[k]) env[k] = process.env[k];
      Object.assign(env, this.certificateEnv);
      let child;
      try {
        fs2.writeFileSync(path2.join(cwd, "owner.json"), JSON.stringify({ pid: process.pid, requestId: call.id, processClosed: false }), { mode: 384 });
      } catch {
        reject(new Error("runtime_ownership_failed"));
        return;
      }
      try {
        child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        reject(new Error("runtime_start_failed"));
        return;
      }
      let bytes = 0, kept = 0, errors = 0, reason, closed = false;
      const chunks = [];
      let hardKill;
      const stop = (why) => {
        if (closed) return;
        reason ||= why;
        child.kill();
        hardKill ||= setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 2e3);
      };
      call.stop = stop;
      const watcher = setInterval(() => {
        if (!dump) return;
        try {
          if (JSON.stringify(call.scope.allowlist()) !== initialPolicy) {
            stop("url_policy_changed");
            return;
          }
        } catch {
          stop("url_policy_changed");
          return;
        }
        try {
          if (fs2.statSync(dump).size > 64 * 1024) stop("response_headers_too_large");
        } catch {
        }
      }, 25);
      child.on("spawn", () => {
        call.processStarted = true;
        call.attemptId = randomUUID();
        try {
          fs2.writeFileSync(path2.join(cwd, "owner.json"), JSON.stringify({ pid: process.pid, requestId: call.id, childPid: child.pid, processClosed: false }), { mode: 384 });
        } catch {
          stop("runtime_ownership_failed");
        }
        if (call.reason) stop(call.reason);
      });
      child.stdout?.on("data", (b) => {
        bytes += b.length;
        if (bytes > max) stop("response_too_large");
        const limit = dump ? DISPLAY_LIMIT : max;
        if (kept < limit) {
          const chunk = b.subarray(0, limit - kept);
          chunks.push(chunk);
          kept += chunk.length;
        }
      });
      child.stderr?.on("data", (b) => {
        errors += b.length;
        if (errors > 32 * 1024) stop("diagnostic_limit");
      });
      child.stdin?.on("error", () => {
      });
      child.on("error", () => {
        reason ||= "runtime_start_failed";
      });
      child.on("close", (code, signal) => {
        closed = true;
        call.processClosed = true;
        call.stop = void 0;
        try {
          fs2.writeFileSync(path2.join(cwd, "owner.json"), JSON.stringify({ pid: process.pid, requestId: call.id, childPid: child.pid, processClosed: true }), { mode: 384 });
        } catch {
          reason ||= "runtime_ownership_failed";
        }
        clearInterval(watcher);
        if (hardKill) clearTimeout(hardKill);
        resolve({ code, signal, reason: call.reason || reason, bytes, body: Buffer.concat(chunks) });
      });
      if (call.reason) stop(call.reason);
      try {
        child.stdin?.end(input);
      } catch {
        stop("input_failed");
      }
    });
  }
};

// electron/modules/fcurl-runtime.test.ts
test("fcurl response parser selects final status and preserves repeated headers", () => {
  const p = parseFcurlHeaders("HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200 OK\r\nX-Test: one\r\nX-Test: two\r\n\r\n");
  assert.equal(p.status, 200);
  assert.equal(p.headers.length, 2);
  assert.throws(() => parseFcurlHeaders("no status"), /response_parse_failed/);
});
var dir = path3.resolve("../navora-plugins/fastls/dist/fastls", `${process.platform}-${process.arch}`);
test("installed fcurl supports bounded requests, permission isolation, redirects, cancellation and private inputs", { skip: !fs3.existsSync(path3.join(dir, "plugin.json")) }, async () => {
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-test-"));
  const manager = new FcurlRuntimeManager(temp);
  const manifest = JSON.parse(fs3.readFileSync(path3.join(dir, "plugin.json"), "utf8"));
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    if (req.url === "/slow") {
      setTimeout(() => {
        if (!res.destroyed) res.end("late");
      }, 1e3);
      return;
    }
    if (req.url === "/big") {
      res.end(Buffer.alloc(9 * 1024 * 1024));
      return;
    }
    if (req.url === "/display") {
      res.end(Buffer.alloc(100 * 1024, 97));
      return;
    }
    if (req.url === "/encoded") {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(gzipSync("encoded fixture"));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/ok" });
      res.end("redirect");
      return;
    }
    const chunks = [];
    for await (const b of req) chunks.push(Buffer.from(b));
    res.writeHead(req.url === "/404" ? 404 : 200, { "Content-Type": "application/json", "X-Repeat": ["one", "two"] });
    res.end(JSON.stringify({ method: req.method, input: Buffer.concat(chunks).toString(), authorization: req.headers.authorization }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scope = {
    pluginId: "fastls",
    chatId: "chat-a",
    dir,
    manifest,
    signal: new AbortController().signal,
    capabilities: ["network.request", "compute.local"],
    allowlist: () => [origin]
  };
  const call = async (args) => await manager.call(scope, "request", args);
  try {
    assert.equal((await manager.call(scope, "status", {})).ok, true);
    assert.ok((await manager.call(scope, "profiles", { limit: 3 })).profiles.length === 3);
    const r = await call({ url: `${origin}/ok`, responseMode: "json", headers: [{ name: "Authorization", value: "Bearer fixture" }] });
    assert.equal(r.ok, true);
    assert.equal(r.body.authorization, "Bearer fixture");
    assert.equal(r.headers.filter((h) => h.name.toLowerCase() === "x-repeat").length, 2);
    const posted = await call({ url: `${origin}/ok`, json: { chinese: "\u6B63\u6587" }, responseMode: "json" });
    assert.equal(posted.body.method, "POST");
    assert.deepEqual(JSON.parse(posted.body.input), { chinese: "\u6B63\u6587" });
    const missing = await call({ url: `${origin}/404` });
    assert.equal(missing.ok, true);
    assert.equal(missing.httpOk, false);
    const redirect = await call({ url: `${origin}/redirect` });
    assert.equal(redirect.status, 302);
    const encoded = await call({ url: `${origin}/encoded` });
    assert.equal(encoded.bodyEncoding, "base64");
    assert.equal(gunzipSync(Buffer.from(encoded.body, "base64")).toString(), "encoded fixture");
    const display = await call({ url: `${origin}/display`, responseMode: "base64" });
    assert.equal(display.truncated, true);
    assert.ok(display.body.length <= 64 * 1024);
    const proxy = http.createServer();
    const sockets = /* @__PURE__ */ new Set();
    proxy.on("connect", (_req, socket, head) => {
      const upstream = net.connect(server.address().port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      sockets.add(upstream);
      sockets.add(socket);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    try {
      const proxied = await call({ url: `${origin}/ok`, proxy: `http://127.0.0.1:${proxy.address().port}`, responseMode: "json" });
      assert.equal(proxied.ok, true);
      assert.equal(proxied.body.method, "GET");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(() => resolve()));
    }
    const before = requests;
    assert.equal((await manager.call({ ...scope, capabilities: [] }, "request", { url: `${origin}/ok` })).ok, false);
    assert.equal((await manager.call({ ...scope, allowlist: () => ["https://example.com"] }, "request", { url: `${origin}/ok` })).error, "url_not_allowed");
    assert.equal(requests, before);
    assert.equal((await call({ url: `${origin}/slow`, timeoutMs: 75 })).error, "request_timeout");
    const controller = new AbortController();
    const cancelled = manager.call({ ...scope, signal: controller.signal }, "request", { url: `${origin}/slow` });
    setTimeout(() => controller.abort(), 50);
    assert.equal((await cancelled).error, "request_cancelled");
    let rules = [origin];
    const policyChange = manager.call({ ...scope, allowlist: () => rules }, "request", { url: `${origin}/slow` });
    setTimeout(() => {
      rules = ["https://example.com"];
    }, 40);
    assert.equal((await policyChange).error, "url_policy_changed");
    assert.equal((await call({ url: `${origin}/big` })).error, "response_too_large");
    assert.equal(manager.isActive("fastls"), false);
    assert.deepEqual(fs3.readdirSync(temp), []);
  } finally {
    await manager.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
    fs3.rmSync(temp, { recursive: true, force: true });
  }
});
var syntheticManifest = {
  id: "fastls",
  name: "fixture",
  version: "0.1.0",
  description: "",
  runtime: { kind: "executable-sidecar", adapter: "fcurl-cli-v0.2", executable: "bin/fcurl.exe", binaryVersion: "0.2.0" }
};
var syntheticScope = (temp) => ({
  pluginId: "fastls",
  chatId: "chat-a",
  dir: temp,
  manifest: syntheticManifest,
  signal: new AbortController().signal,
  capabilities: ["network.request", "compute.local"],
  allowlist: () => []
});
test("reservations cover preparation, queued invalid input consumes no slot, and dispose closes admission synchronously", async () => {
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-reservations-"));
  const manager = new FcurlRuntimeManager(temp, { maxConcurrent: 1, maxPerChat: 1, maxQueued: 1, maxQueuedPerChat: 1 });
  const scope = syntheticScope(temp), receipts = [];
  const withReceipt = { ...scope, onReceipt: (r) => {
    assert.deepEqual(fs3.readdirSync(temp), []);
    receipts.push(r);
  } };
  try {
    const preparing = manager.call(withReceipt, "request", { url: "http://127.0.0.1/first" });
    assert.equal(manager.isActive("fastls"), true);
    const queued = manager.call(withReceipt, "request", { url: "http://127.0.0.1/queued" });
    const invalid = manager.call(scope, "request", { url: "http://127.0.0.1/", method: "HEAD", bodyText: "no" });
    const stopping = manager.dispose();
    assert.equal((await invalid).error, "head_body_not_allowed");
    assert.strictEqual(manager.dispose(), stopping);
    const closed = await manager.call(scope, "status", {});
    assert.equal(closed.error, "runtime_closed");
    assert.equal(closed.receipt.dispatched, false);
    assert.equal((await preparing).error, "request_cancelled");
    assert.equal((await queued).error, "request_cancelled");
    await stopping;
    assert.equal(manager.isActive("fastls"), false);
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every((r) => !r.dispatched && !r.attemptId && r.state === "cancelled"));
    assert.notEqual(receipts[0].requestId, receipts[1].requestId);
  } finally {
    await manager.dispose();
    fs3.rmSync(temp, { recursive: true, force: true });
  }
});
test("invalid host certificate environment is diagnosed without changing TLS trust or exposing paths", async () => {
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-trust-"));
  const previous = process.env.SSL_CERT_FILE;
  process.env.SSL_CERT_FILE = path3.join(temp, "private-missing-root.pem");
  const manager = new FcurlRuntimeManager(temp);
  if (previous === void 0) delete process.env.SSL_CERT_FILE;
  else process.env.SSL_CERT_FILE = previous;
  try {
    const result = await manager.call(syntheticScope(temp), "status", {});
    assert.equal(result.error, "certificate_environment_invalid");
    assert.equal(result.trustSource, "environment_custom");
    assert.equal(result.receipt.dispatched, false);
    assert.ok(!JSON.stringify(result).includes("private-missing-root"));
    assert.deepEqual(fs3.readdirSync(temp), []);
  } finally {
    await manager.dispose();
    fs3.rmSync(temp, { recursive: true, force: true });
  }
});
async function runtimeFixture(t, options = {}) {
  if (!fs3.existsSync(path3.join(dir, "plugin.json"))) {
    t.skip("local platform fcurl artifact unavailable");
    return;
  }
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-lifecycle-"));
  const events = new EventEmitter(), seen = [], held = /* @__PURE__ */ new Map();
  const server = http.createServer((req, res) => {
    const route = req.url || "/";
    seen.push(route);
    if (route.startsWith("/hold")) held.set(route, res);
    else if (route.startsWith("/delay")) setTimeout(() => {
      if (!res.destroyed) res.end("delayed");
    }, 500);
    else res.end("complete");
    events.emit(route);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(fs3.readFileSync(path3.join(dir, "plugin.json"), "utf8"));
  const manager = new FcurlRuntimeManager(temp, options);
  const scope = { ...syntheticScope(temp), dir, manifest, allowlist: () => [origin] };
  const requested = async (route) => {
    if (seen.includes(route)) return;
    await Promise.race([once(events, route), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture request missing: ${route}`)), 5e3);
      timer.unref();
    })]);
  };
  t.after(async () => {
    await manager.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
    fs3.rmSync(temp, { recursive: true, force: true });
  });
  return { temp, manager, origin, scope, seen, held, requested };
}
test("bounded scheduler enforces per-chat and global limits, lets other chats progress, and scoped cancellation awaits cleanup", async (t) => {
  const f = await runtimeFixture(t, { maxConcurrent: 2, maxPerChat: 1, maxQueued: 2, maxQueuedPerChat: 1 });
  if (!f) return;
  const { manager, scope, origin, requested, held, temp } = f;
  const first = manager.call(scope, "request", { url: `${origin}/hold-a` });
  await requested("/hold-a");
  const queued = manager.call(scope, "request", { url: `${origin}/queued-a` });
  const overflow = await manager.call(scope, "request", { url: `${origin}/overflow-a` });
  assert.equal(overflow.error, "resource_limit");
  assert.equal(overflow.receipt.dispatched, false);
  assert.equal(fs3.readdirSync(temp).length, 1);
  const second = manager.call({ ...scope, chatId: "chat-b" }, "request", { url: `${origin}/hold-b` });
  await requested("/hold-b");
  const queuedOther = manager.call({ ...scope, chatId: "chat-c" }, "request", { url: `${origin}/queued-c` });
  const globalOverflow = await manager.call({ ...scope, chatId: "chat-d" }, "request", { url: `${origin}/overflow-d` });
  assert.equal(globalOverflow.error, "resource_limit");
  await manager.cancelAndWait({ chatId: "chat-a" });
  assert.equal((await first).error, "request_cancelled");
  assert.equal((await queued).receipt.dispatched, false);
  assert.equal((await queuedOther).ok, true);
  assert.equal(manager.isActive("fastls"), true);
  assert.equal(fs3.readdirSync(temp).length, 1);
  held.get("/hold-b").end("second");
  assert.equal((await second).ok, true);
  await manager.drain();
  assert.equal(manager.isActive("fastls"), false);
  assert.deepEqual(fs3.readdirSync(temp), []);
  assert.ok(!f.seen.includes("/queued-a") && !f.seen.includes("/overflow-a") && !f.seen.includes("/overflow-d"));
});
test("queue timeout and aborted queued calls never create a process, while closing cancels the live process before resolving", async (t) => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 });
  if (!f) return;
  const { manager, scope, origin, requested, seen, temp } = f;
  const running = manager.call(scope, "request", { url: `${origin}/hold-running` });
  await requested("/hold-running");
  const timed = await manager.call(scope, "request", { url: `${origin}/must-not-dispatch`, timeoutMs: 80 });
  assert.equal(timed.error, "request_timeout");
  assert.equal(timed.receipt.dispatched, false);
  assert.equal(timed.receipt.attemptId, void 0);
  const controller = new AbortController();
  const queued = manager.call({ ...scope, signal: controller.signal }, "request", { url: `${origin}/aborted-queue` });
  controller.abort();
  assert.equal((await queued).error, "request_cancelled");
  const closing = manager.dispose();
  assert.equal((await manager.call(scope, "profiles", {})).error, "runtime_closed");
  await closing;
  const cancelled = await running;
  assert.equal(cancelled.error, "request_cancelled");
  assert.equal(cancelled.receipt.dispatched, true);
  assert.equal(typeof cancelled.receipt.attemptId, "string");
  assert.deepEqual(seen, ["/hold-running"]);
  assert.deepEqual(fs3.readdirSync(temp), []);
});
test("one logical budget includes queue waiting and only the remaining budget is dispatched", async (t) => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 });
  if (!f) return;
  const { manager, scope, origin, requested, held } = f;
  const first = manager.call(scope, "request", { url: `${origin}/hold-budget` });
  await requested("/hold-budget");
  const started = Date.now();
  const second = manager.call(scope, "request", { url: `${origin}/delay-budget`, timeoutMs: 350 });
  await new Promise((resolve) => setTimeout(resolve, 180));
  held.get("/hold-budget").end("free");
  await first;
  await requested("/delay-budget");
  const result = await second;
  assert.equal(result.error, "request_timeout");
  assert.equal(result.receipt.dispatched, true);
  assert.ok(Date.now() - started < 600, "queue wait must consume the same budget rather than restart it");
});
test("host admission and current-run identity are rechecked after queueing; receipts cannot contain URL or credentials", async (t) => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 });
  if (!f) return;
  const { manager, scope, origin, requested, held, seen } = f;
  const blocker = { ok: false, error: "page_blocker_scope_required", nextAction: "handoff" };
  const immediate = await manager.call({ ...scope, admission: () => blocker }, "request", { url: `${origin}/blocked?token=secret` });
  assert.equal(immediate.error, "page_blocker_scope_required");
  assert.equal(immediate.receipt.dispatched, false);
  const first = manager.call(scope, "request", { url: `${origin}/hold-admission` });
  await requested("/hold-admission");
  let blocked = false, current = true;
  const receipts = [];
  const queued = manager.call(
    { ...scope, runId: "run-fixture", toolCallId: "tool-fixture", admission: () => blocked ? blocker : null, onReceipt: (r) => receipts.push(r) },
    "request",
    { url: `${origin}/blocked-later?token=secret`, headers: [{ name: "Authorization", value: "Bearer private" }] }
  );
  const stale = manager.call({ ...scope, isCurrent: () => current }, "request", { url: `${origin}/stale-later` });
  blocked = true;
  current = false;
  held.get("/hold-admission").end("released");
  await first;
  const rejected = await queued;
  assert.equal(rejected.error, "page_blocker_scope_required");
  assert.equal(rejected.receipt.dispatched, false);
  assert.equal((await stale).error, "request_stale");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].runId, "run-fixture");
  assert.equal(receipts[0].toolCallId, "tool-fixture");
  assert.ok(!JSON.stringify(receipts).includes("token") && !JSON.stringify(receipts).includes("Bearer") && !JSON.stringify(receipts).includes(origin));
  assert.deepEqual(seen, ["/hold-admission"]);
  assert.equal((await manager.call({ ...scope, admission: () => blocker }, "status", {})).ok, true);
});
test("each runtime call gets distinct host identities and stale/old abort callbacks cannot affect a later invocation", async (t) => {
  const f = await runtimeFixture(t);
  if (!f) return;
  const { manager, scope, origin, requested, held, temp } = f;
  const receipts = [], controller = new AbortController();
  const owned = { ...scope, runId: "run-one", toolCallId: "tool-many", onReceipt: (r) => {
    assert.deepEqual(fs3.readdirSync(temp), []);
    receipts.push(r);
  } };
  const first = manager.call({ ...owned, signal: controller.signal }, "request", { url: `${origin}/hold-old` });
  await requested("/hold-old");
  controller.abort();
  assert.equal((await first).error, "request_cancelled");
  const second = await manager.call(owned, "request", { url: `${origin}/ok` });
  assert.equal(second.ok, true);
  assert.notEqual(receipts[0].requestId, receipts[1].requestId);
  assert.notEqual(receipts[0].attemptId, receipts[1].attemptId);
  assert.equal(receipts[1].state, "completed");
  assert.equal(receipts[1].httpStatus, 200);
  let current = true;
  const late = manager.call({ ...scope, isCurrent: () => current }, "request", { url: `${origin}/hold-stale` });
  await requested("/hold-stale");
  current = false;
  held.get("/hold-stale").end("old-run-output");
  const stale = await late;
  assert.equal(stale.error, "request_stale");
  assert.equal(stale.receipt.dispatched, true);
  assert.equal(stale.body, void 0);
});
test("unlaunchable verified Windows artifact releases its reservation and staging before another request", { skip: process.platform !== "win32" || !fs3.existsSync(path3.join(dir, "plugin.json")) }, async () => {
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-start-failure-"));
  const packageDir = path3.join(temp, "fixture-package"), runtimeDir = path3.join(temp, "runtime");
  const manifest = JSON.parse(fs3.readFileSync(path3.join(dir, "plugin.json"), "utf8"));
  const executable = path3.join(packageDir, manifest.runtime.kind === "executable-sidecar" ? manifest.runtime.executable : "");
  fs3.mkdirSync(path3.dirname(executable), { recursive: true });
  fs3.writeFileSync(path3.join(packageDir, "plugin.json"), JSON.stringify(manifest));
  const invalidImage = Buffer.alloc(512);
  invalidImage.write("MZ");
  invalidImage.writeUInt32LE(128, 60);
  invalidImage.writeUInt32LE(17744, 128);
  invalidImage.writeUInt16LE(34404, 132);
  fs3.writeFileSync(executable, invalidImage);
  writeRuntimeInventory(packageDir);
  const manager = new FcurlRuntimeManager(runtimeDir, { maxConcurrent: 1, maxPerChat: 1 });
  const scope = { ...syntheticScope(temp), dir: packageDir, manifest };
  try {
    const failed = await manager.call(scope, "status", {});
    assert.equal(failed.error, "runtime_start_failed");
    assert.equal(failed.receipt.dispatched, false);
    assert.equal(failed.receipt.attemptId, void 0);
    assert.equal(manager.isActive("fastls"), false);
    assert.deepEqual(fs3.readdirSync(runtimeDir), []);
    const good = await manager.call({ ...scope, dir }, "status", {});
    assert.equal(good.ok, true);
    assert.equal(good.receipt.dispatched, true);
    await manager.drain();
    assert.deepEqual(fs3.readdirSync(runtimeDir), []);
  } finally {
    await manager.dispose();
    fs3.rmSync(temp, { recursive: true, force: true });
  }
});
test("a failed cleanup keeps admission closed and a later dispose retries after the lock is released", async (t) => {
  const f = await runtimeFixture(t);
  if (!f) return;
  const { manager, scope, temp } = f;
  let locked = true;
  const original = fs3.promises.rm;
  t.mock.method(fs3.promises, "rm", async (target, options) => {
    if (locked && String(target).startsWith(path3.join(temp, "call-"))) throw Object.assign(new Error("fixture sharing violation"), { code: "EPERM" });
    return original(target, options);
  });
  const result = await manager.call(scope, "status", {});
  assert.equal(result.error, "runtime_cleanup_failed");
  assert.equal(result.receipt.dispatched, true);
  assert.equal(fs3.readdirSync(temp).length, 1);
  await manager.drain({ pluginId: "another-plugin" });
  await manager.drain({ chatId: "another-chat" });
  const firstClosing = manager.dispose();
  await assert.rejects(firstClosing, /runtime_cleanup_failed/);
  assert.equal((await manager.call(scope, "status", {})).error, "runtime_closed");
  locked = false;
  const retry = manager.dispose();
  assert.notStrictEqual(retry, firstClosing);
  await retry;
  assert.deepEqual(fs3.readdirSync(temp), []);
});
test("queue budgets and reported elapsed time use a monotonic clock across wall-clock adjustments", async (t) => {
  const f = await runtimeFixture(t, { maxConcurrent: 1, maxPerChat: 1 });
  if (!f) return;
  const { manager, scope, origin, requested } = f;
  const running = manager.call(scope, "request", { url: `${origin}/hold-clock` });
  await requested("/hold-clock");
  let wall = Date.now();
  t.mock.method(Date, "now", () => wall);
  const queued = manager.call(scope, "request", { url: `${origin}/never-clock`, timeoutMs: 100 });
  wall -= 24 * 60 * 60 * 1e3;
  const result = await queued;
  assert.equal(result.error, "request_timeout");
  assert.equal(result.receipt.dispatched, false);
  assert.ok(result.elapsedMs >= 70 && result.elapsedMs < 1e3);
  assert.ok(result.receipt.finishedAt < result.receipt.startedAt);
  await manager.cancelAndWait();
  assert.equal((await running).error, "request_cancelled");
});
test("startup cleanup retains a possible live orphan and unknown legacy ownership after the parent has exited", async () => {
  const temp = fs3.mkdtempSync(path3.join(os.tmpdir(), "navora-fcurl-restart-owner-"));
  const child = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  assert.equal(child.status, 0);
  assert.ok(child.pid > 0);
  const owner = (name, metadata) => {
    const callDir = path3.join(temp, `call-${name}`);
    fs3.mkdirSync(callDir);
    fs3.writeFileSync(path3.join(callDir, "owner.json"), JSON.stringify({ pid: child.pid, ...metadata }));
  };
  owner("Orphan", { childPid: process.pid, processClosed: false });
  owner("Unknown", { processClosed: false });
  owner("Legacy", {});
  owner("Closed", { processClosed: true });
  owner("DeadChild", { childPid: child.pid, processClosed: false });
  const manager = new FcurlRuntimeManager(temp);
  try {
    assert.deepEqual(fs3.readdirSync(temp).sort(), ["call-Legacy", "call-Orphan", "call-Unknown"]);
  } finally {
    await manager.dispose();
    fs3.rmSync(temp, { recursive: true, force: true });
  }
});
test("an aborted Agent scope keeps cancellation rather than being overwritten by stale-run classification", async (t) => {
  const f = await runtimeFixture(t);
  if (!f) return;
  const controller = new AbortController();
  const scope = { ...f.scope, signal: controller.signal, isCurrent: () => !controller.signal.aborted };
  const running = f.manager.call(scope, "request", { url: `${f.origin}/hold-cancel-current` });
  await f.requested("/hold-cancel-current");
  controller.abort();
  const result = await running;
  assert.equal(result.error, "request_cancelled");
  assert.equal(result.receipt.state, "cancelled");
  assert.equal(result.receipt.dispatched, true);
  await f.manager.drain();
  assert.deepEqual(fs3.readdirSync(f.temp), []);
});
test("a staging cleanup failure remains visible when the host run becomes stale during cleanup", async (t) => {
  const f = await runtimeFixture(t);
  if (!f) return;
  let current = true, failOnce = true;
  const original = fs3.promises.rm;
  t.mock.method(fs3.promises, "rm", async (target, options) => {
    if (failOnce && String(target).startsWith(path3.join(f.temp, "call-"))) {
      failOnce = false;
      current = false;
      throw Object.assign(new Error("fixture cleanup failure"), { code: "EPERM" });
    }
    return original(target, options);
  });
  const result = await f.manager.call({ ...f.scope, isCurrent: () => current }, "status", {});
  assert.equal(result.error, "runtime_cleanup_failed");
  assert.equal(result.receipt.state, "failed");
  await f.manager.drain();
  assert.deepEqual(fs3.readdirSync(f.temp), []);
});
