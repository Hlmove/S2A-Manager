// ==UserScript==
// @name         CPA AuthFiles Universal Cleaner
// @namespace    openai_registor
// @version      2.2.0
// @description  一键优化：删除失效，启用健康，禁用无额度
// @author       local
// @match        *://*/management.html*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const BASE_ORIGIN = window.location.origin;
  const AUTH_FILES_URL = `${BASE_ORIGIN}/v0/management/auth-files`;
  const AUTH_FILES_STATUS_URL = `${BASE_ORIGIN}/v0/management/auth-files/status`;
  const API_CALL_URL = `${BASE_ORIGIN}/v0/management/api-call`;
  const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
  const DEFAULT_UA = "codex_cli_rs/universal (Windows)";
  const QUERY_CONCURRENCY = 4;
  const PAGE_SIZE = 20;

  const TOKEN_CACHE_KEY = "tm_auth_token";
  const CAPTURED_TOKEN_KEY = "tm_last_bearer_token_v1";
  const CLI_PROXY_AUTH_KEY = "cli-proxy-auth";
  const ENC_PREFIX = "enc::v1::";
  const ENC_SEED = "cli-proxy-api-webui::secure-storage";

  let runtimeToken = "";
  let manualPromptBlockedUntil = 0;
  let pendingFiles = [];
  let inventorySnapshot = {
    loaded: false,
    total: 0,
  };

  function isActiveStatus(status) {
    return String(status || "").trim().toLowerCase() === "active";
  }

  function buildInventorySnapshot(files) {
    return {
      loaded: true,
      total: files.length,
    };
  }

  function applyDeletedItems(items) {
    if (!inventorySnapshot.loaded || !Array.isArray(items) || !items.length) return;
    inventorySnapshot.total = Math.max(0, inventorySnapshot.total - items.length);
  }
  function getSystemStatusText(item) {
    return isActiveStatus(item?.status) ? "健康" : "失效";
  }

  function getBackendStatusLabel(item) {
    const rawStatus = String(item?.status || "").trim().toLowerCase();
    if (rawStatus === "active") return "正常";
    if (rawStatus === "disabled") return "已禁用";
    if (rawStatus === "error") return "出错";
    if (rawStatus === "pending") return "等待完成";
    if (rawStatus === "refreshing") return "刷新中";
    if (rawStatus === "unknown") return "状态未知";
    return item?.status || "未知状态";
  }

  function getBackendStatusTone(item) {
    const rawStatus = String(item?.status || "").trim().toLowerCase();
    if (rawStatus === "active") return "ok";
    if (rawStatus === "pending" || rawStatus === "refreshing" || rawStatus === "unknown") return "warn";
    if (rawStatus === "disabled" || rawStatus === "error") return "fail";
    return "idle";
  }

  function getBackendReasonText(item) {
    const rawStatus = String(item?.status || "").trim().toLowerCase();
    const rawMessage = String(item?.statusMessage || "").trim().toLowerCase();

    if (rawStatus === "active") return "后台认为它目前正常。";
    if (rawStatus === "disabled") {
      if (rawMessage === "disabled via management api") return "后台原因：这个号被手动禁用了。";
      if (rawMessage === "removed via management api") return "后台原因：这个号被管理后台移除过。";
      return "后台原因：这个号目前被标记为禁用。";
    }
    if (rawStatus === "pending") return "后台原因：这个号还在等待外部操作，比如登录确认或验证。";
    if (rawStatus === "refreshing") return "后台原因：这个号正在刷新中，暂时还没恢复到正常状态。";
    if (rawStatus === "unknown") return "后台原因：后台暂时判断不出它是不是正常。";

    if (rawMessage === "unauthorized") return "后台原因：登录失效，或者凭证已经失效。";
    if (rawMessage === "payment_required") return "后台原因：权限、套餐或付费状态有问题。";
    if (rawMessage === "not_found") return "后台原因：后台没找到它需要访问的资源。";
    if (rawMessage === "quota exhausted") return "后台原因：额度已经用完了。";
    if (rawMessage === "context canceled") return "后台原因：请求被中断了，通常是超时、切换或上游主动取消。";
    if (rawMessage === "transient upstream error") return "后台原因：上游服务临时出错。";
    if (rawMessage === "request failed") return "后台原因：请求失败，但后台没有给更细的分类。";

    if (rawStatus === "error") {
      if (rawMessage) return `后台原因：${item.statusMessage}`;
      return "后台原因：这个号请求时报错了。";
    }

    if (rawMessage) return `后台原因：${item.statusMessage}`;
    if (item?.disabled) return "后台原因：这个号被标记为禁用。";
    if (item?.unavailable) return "后台原因：这个号暂时不可用。";
    return "后台原因：不是 active，但后台没有返回更明确的说明。";
  }

  function getBackendReasonTone(item) {
    const rawStatus = String(item?.status || "").trim().toLowerCase();
    const rawMessage = String(item?.statusMessage || "").trim().toLowerCase();
    if (rawStatus === "active") return "ok";
    if (["pending", "refreshing", "unknown"].includes(rawStatus)) return "warn";
    if (["disabled", "error"].includes(rawStatus)) return "fail";
    if (["unauthorized", "payment_required", "not_found", "quota exhausted", "context canceled", "transient upstream error", "request failed"].includes(rawMessage)) return "fail";
    return "idle";
  }

  function isCodexChannel(item) {
    return normalizeChannelKey(item?.channel) === "codex";
  }

  function supportsActiveCheck(item) {
    return isCodexChannel(item);
  }

  function isQuotaState(item) {
    return item?.queryState === "quota";
  }

  function isHealthyState(item) {
    return item?.queryState === "ok";
  }

  function isFailedState(item) {
    return item?.queryState === "failed";
  }

  function getEnabledStateText(item) {
    return item?.disabled ? "已禁用" : "已启用";
  }

  function getEnabledStateTone(item) {
    return item?.disabled ? "fail" : "ok";
  }

  function getActualResultText(item) {
    if (!supportsActiveCheck(item)) return "仅展示";
    if (isHealthyState(item)) return "健康";
    if (isQuotaState(item)) return "无额度";
    if (isFailedState(item)) {
      if (String(item?.lastStatusCode || "") === "NO_AUTH") return "失效";
      return "失效";
    }
    return "待检查";
  }

  function getActualResultTone(item) {
    if (!supportsActiveCheck(item)) return "idle";
    if (isHealthyState(item)) return "ok";
    if (isQuotaState(item)) return "warn";
    if (isFailedState(item)) {
      if (String(item?.lastStatusCode || "") === "NO_AUTH") return "warn";
      return "fail";
    }
    return "idle";
  }

  function getDeleteAdviceText(item) {
    if (isHealthyState(item)) return "建议保留，它目前是健康且有额度的";
    if (isQuotaState(item)) return "建议禁用，它目前可用但没有额度";
    if (isFailedState(item)) return "可考虑删除，它目前已判定为失效";
    return "先检查再决定，现在不建议删除";
  }

  function getUsageText(item) {
    if (!supportsActiveCheck(item)) return "该渠道仅展示，不参与主动检测或自动删除";
    if (item?.queryState === "unqueried") return "等待 Codex 检测";
    if (isQuotaState(item)) return `额度已用尽 · 重置 ${item?.resetText || "-"}`;
    if (isFailedState(item)) return `检测失败 · 返回 ${item?.lastStatusCode == null ? "--" : String(item.lastStatusCode)}`;
    const used = item?.usedPercent === null ? "未知" : `${item.usedPercent}%`;
    return `Codex 已用 ${used} · 重置 ${item?.resetText || "-"}`;
  }

  function getBadgeText(item) {
    if (isHealthyState(item)) return "实测结果：健康";
    if (isQuotaState(item)) return "实测结果：无额度";
    if (isFailedState(item)) return "实测结果：失效";
    return "实测结果：待检查";
  }

  function getTechDetailText(item) {
    const authIndex = item?.authIndex || "-";
    const statusCode = item?.lastStatusCode == null ? "--" : String(item.lastStatusCode);
    return `authIndex=${authIndex} | 返回码=${statusCode}`;
  }

  function normalizeChannelKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function inferChannelFromName(name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return "unknown";
    if (raw.includes("qwen")) return "qwen";
    if (raw.includes("codex")) return "codex";
    if (raw.includes("kiro")) return "kiro";
    if (raw.includes("claude")) return "claude";
    if (raw.includes("gemini")) return "gemini";
    if (raw.includes("openai")) return "openai";
    return "unknown";
  }

  function extractChannel(item) {
    const directKeys = ["channel", "provider", "type", "model_provider", "modelProvider"];
    for (const key of directKeys) {
      const value = normalizeChannelKey(item?.[key]);
      if (value) return value;
    }
    const nested = [
      item?.id_token?.provider,
      item?.idToken?.provider,
      item?.id_token?.channel,
      item?.idToken?.channel,
    ];
    for (const value of nested) {
      const normalized = normalizeChannelKey(value);
      if (normalized) return normalized;
    }
    return inferChannelFromName(extractFileName(item));
  }

  function formatChannelLabel(channel) {
    const key = normalizeChannelKey(channel);
    if (!key || key === "all") return "全部渠道";
    if (key === "unknown") return "未分类";
    const pretty = {
      qwen: "Qwen",
      codex: "Codex",
      kiro: "Kiro",
      claude: "Claude",
      gemini: "Gemini",
      openai: "OpenAI",
    };
    return pretty[key] || key;
  }

  function formatPlanTypeLabel(planType) {
    const key = String(planType || "").trim().toLowerCase();
    if (!key) return "-";
    const pretty = {
      free: "Free",
      plus: "Plus",
      pro: "Pro",
      team: "Team",
      enterprise: "Enterprise",
      edu: "Edu",
    };
    return pretty[key] || planType;
  }

  function getChannelCounts(items) {
    const counts = new Map();
    for (const item of items) {
      const key = normalizeChannelKey(item?.channel) || "unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function persistToken(token) {
    const t = String(token || "").trim();
    if (!t) return "";
    runtimeToken = t;
    try { localStorage.setItem(TOKEN_CACHE_KEY, t); } catch (_) {}
    try { sessionStorage.setItem(TOKEN_CACHE_KEY, t); } catch (_) {}
    try { localStorage.setItem(CAPTURED_TOKEN_KEY, t); } catch (_) {}
    return t;
  }

  function decodeCliProxyAuth(raw) {
    if (!raw) return "";
    if (!raw.startsWith(ENC_PREFIX)) return raw;
    try {
      const keyText = `${ENC_SEED}|${window.location.host}|${navigator.userAgent}`;
      const key = new TextEncoder().encode(keyText);
      const bin = atob(raw.slice(ENC_PREFIX.length));
      const data = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 1) out[i] = data[i] ^ key[i % key.length];
      return new TextDecoder().decode(out);
    } catch (_) {
      return "";
    }
  }

  function tryReadTokensFromCliProxyAuth() {
    try {
      const raw = localStorage.getItem(CLI_PROXY_AUTH_KEY);
      const decoded = decodeCliProxyAuth(raw);
      if (!decoded) return [];
      const obj = JSON.parse(decoded);
      const cands = [
        obj?.state?.managementKey,
        obj?.state?.adminKey,
        obj?.state?.authToken,
        obj?.state?.token,
        obj?.state?.password,
        obj?.managementKey,
        obj?.adminKey,
        obj?.authToken,
        obj?.token,
      ];
      return cands
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => String(x).trim());
    } catch (_) {
      return [];
    }
  }

  function tryReadTokensFromStorage() {
    const keys = [
      TOKEN_CACHE_KEY,
      CAPTURED_TOKEN_KEY,
      "tm_token",
      "auth_token",
      "management_token",
      "management_key",
      "admin_key",
    ];
    const tokens = [];
    for (const k of keys) {
      try {
        const v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v && String(v).trim()) tokens.push(String(v).trim());
      } catch (_) {}
    }
    return tokens;
  }

  function installTokenSniffer() {
    if (window.__tmUniversalSnifferInstalled) return;
    window.__tmUniversalSnifferInstalled = true;

    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      try {
        let headers = null;
        if (init && init.headers) headers = new Headers(init.headers);
        else if (input && typeof input === "object" && "headers" in input) headers = new Headers(input.headers);
        if (headers) {
          const auth = headers.get("authorization") || headers.get("Authorization");
          if (auth && /^Bearer\s+/i.test(auth)) persistToken(auth.replace(/^Bearer\s+/i, ""));
        }
      } catch (_) {}
      return origFetch(input, init);
    };

    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (/^authorization$/i.test(String(name || "")) && /^Bearer\s+/i.test(String(value || ""))) {
          persistToken(String(value).replace(/^Bearer\s+/i, ""));
        }
      } catch (_) {}
      return origSetHeader.call(this, name, value);
    };
  }

  function collectTokenCandidates() {
    const all = [
      runtimeToken,
      ...tryReadTokensFromCliProxyAuth(),
      ...tryReadTokensFromStorage(),
    ].map((x) => String(x || "").trim()).filter(Boolean);
    const uniq = [];
    const seen = new Set();
    for (const t of all) {
      if (seen.has(t)) continue;
      seen.add(t);
      uniq.push(t);
    }
    return uniq;
  }

  function clearTokenCacheValue(token) {
    const t = String(token || "").trim();
    if (!t) return;
    if (runtimeToken === t) runtimeToken = "";
    const keys = [
      TOKEN_CACHE_KEY,
      CAPTURED_TOKEN_KEY,
      "tm_token",
      "auth_token",
      "management_token",
      "management_key",
      "admin_key",
    ];
    for (const k of keys) {
      try {
        if (localStorage.getItem(k) === t) localStorage.removeItem(k);
      } catch (_) {}
      try {
        if (sessionStorage.getItem(k) === t) sessionStorage.removeItem(k);
      } catch (_) {}
    }
  }

  function isUnauthorizedError(err) {
    const status = Number(err?.status);
    if (status === 401) return true;
    const msg = String(err?.message || "");
    return msg.includes("HTTP 401");
  }

  function buildHttpError(message, status, rawText) {
    const e = new Error(message);
    e.status = status;
    e.rawText = rawText || "";
    return e;
  }

  async function callWithAuthRetry(opName, fn) {
    try {
      return await fn("");
    } catch (err) {
      if (!isUnauthorizedError(err)) throw err;
    }

    const tried = new Set();
    let lastErr = null;
    const candidates = collectTokenCandidates();
    for (const token of candidates) {
      if (!token || tried.has(token)) continue;
      tried.add(token);
      try {
        const result = await fn(token);
        persistToken(token);
        return result;
      } catch (err) {
        lastErr = err;
        if (isUnauthorizedError(err)) {
          clearTokenCacheValue(token);
          continue;
        }
        throw err;
      }
    }

    const now = Date.now();
    if (now < manualPromptBlockedUntil) {
      if (lastErr) throw lastErr;
      throw new Error(`${opName}失败：没有可用密钥`);
    }
    const manual = window.prompt(
      `当前登录已失效。\n请输入“管理后台登录密钥”（就是你打开 management 页面时输入的那串密码）后重试：\n场景：${opName}`,
      runtimeToken || ""
    );
    if (manual && String(manual).trim()) {
      const token = persistToken(String(manual).trim());
      try {
        return await fn(token);
      } catch (err) {
        if (isUnauthorizedError(err)) clearTokenCacheValue(token);
        throw err;
      }
    }
    manualPromptBlockedUntil = Date.now() + 10000;

    if (lastErr) throw lastErr;
    throw new Error(`${opName}失败：没有可用密钥`);
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function extractFileName(item) {
    for (const key of ["name", "id", "filename", "file_name"]) {
      const v = item?.[key];
      if (v) return String(v);
    }
    return null;
  }

  function extractAuthIndex(item) {
    for (const key of ["authIndex", "auth_index", "authindex"]) {
      const v = item?.[key];
      if (v) return String(v);
    }
    return null;
  }

  function extractChatgptAccountId(item) {
    const nested = item?.id_token?.chatgpt_account_id || item?.idToken?.chatgpt_account_id;
    if (nested) return String(nested);
    for (const key of ["chatgpt_account_id", "chatgptAccountId", "account_id", "accountId"]) {
      const v = item?.[key];
      if (v) return String(v);
    }
    return null;
  }

  function getHeaders(token) {
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: `${BASE_ORIGIN}/management.html`,
    };
    if (token && String(token).trim()) {
      headers.authorization = `Bearer ${String(token).trim()}`;
    }
    return headers;
  }

  function normalizeFilesPayload(data) {
    const files = Array.isArray(data?.files)
      ? data.files.filter((x) => x && typeof x === "object")
      : Array.isArray(data)
      ? data.filter((x) => x && typeof x === "object")
      : [];

    return files.map((item) => ({
      name: extractFileName(item) || "(no-name)",
      authIndex: extractAuthIndex(item) || "",
      status: String(item?.status ?? ""),
      statusMessage: String(item?.status_message ?? item?.statusMessage ?? ""),
      disabled: Boolean(item?.disabled),
      unavailable: Boolean(item?.unavailable),
      channel: extractChannel(item),
      chatgptAccountId: extractChatgptAccountId(item) || "",
      planType: "",
      usedPercent: null,
      resetText: "-",
      lastStatusCode: null,
      queryState: "unqueried",
      hasQuota: null,
      deleteEligible: false,
    }));
  }

  async function fetchAllFiles(token) {
    const resp = await fetch(AUTH_FILES_URL, {
      method: "GET",
      headers: getHeaders(token),
      credentials: "include",
    });
    if (!resp.ok) {
      const raw = await resp.text();
      throw buildHttpError(`获取失败: HTTP ${resp.status}`, resp.status, raw);
    }
    const data = await resp.json();
    return normalizeFilesPayload(data);
  }

  async function fetchNonActive(token) {
    const all = await fetchAllFiles(token);
    return all.filter((x) => String(x.status || "").toLowerCase() !== "active");
  }

  async function deleteByName(token, name) {
    const url = `${AUTH_FILES_URL}?name=${encodeURIComponent(name)}`;
    const resp = await fetch(url, {
      method: "DELETE",
      headers: getHeaders(token),
      credentials: "include",
    });
    const text = await resp.text();
    if (resp.status === 401) throw buildHttpError(`删除失败: HTTP 401`, 401, text);
    const data = safeJson(text);
    const ok = resp.status === 200 && (!data || data.status === "ok");
    return { ok, status: resp.status, raw: text };
  }

  async function patchAuthFileDisabledAt(token, url, name, disabled) {
    const resp = await fetch(url, {
      method: "PATCH",
      headers: { ...getHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ name, disabled: Boolean(disabled) }),
      credentials: "include",
    });
    const text = await resp.text();
    if (resp.status === 401) throw buildHttpError(`更新启用状态失败: HTTP 401`, 401, text);
    if (!resp.ok) throw buildHttpError(`更新启用状态失败: HTTP ${resp.status}`, resp.status, text);
    const data = safeJson(text);
    if (data && data.status && data.status !== "ok") {
      throw buildHttpError(`更新启用状态失败: ${data.status}`, resp.status, text);
    }
    return { ok: true, status: resp.status, raw: text, data };
  }

  async function patchAuthFileDisabled(token, name, disabled) {
    try {
      return await patchAuthFileDisabledAt(token, AUTH_FILES_URL, name, disabled);
    } catch (err) {
      if (Number(err?.status) !== 404) throw err;
    }
    return patchAuthFileDisabledAt(token, AUTH_FILES_STATUS_URL, name, disabled);
  }

  async function queryUsageByAuthIndex(token, fileItem) {
    if (!fileItem?.authIndex) {
      return { ok: false, statusCode: "NO_AUTH", bodyObj: null, bodyText: "missing authIndex" };
    }

    const header = {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_UA,
    };
    if (fileItem.chatgptAccountId) header["Chatgpt-Account-Id"] = fileItem.chatgptAccountId;

    const body = {
      authIndex: fileItem.authIndex,
      method: "GET",
      url: USAGE_URL,
      header,
    };

    const resp = await fetch(API_CALL_URL, {
      method: "POST",
      headers: { ...getHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    const text = await resp.text();
    if (resp.status === 401) {
      throw buildHttpError(`余额查询失败: HTTP 401`, 401, text);
    }
    const data = safeJson(text);
    const statusCode = data?.status_code ?? data?.statusCode ?? null;

    let bodyObj = null;
    let bodyText = "";
    if (typeof data?.body === "string") {
      bodyText = data.body;
      const parsed = safeJson(data.body);
      if (parsed && typeof parsed === "object") bodyObj = parsed;
    } else if (data?.body && typeof data.body === "object") {
      bodyObj = data.body;
      bodyText = JSON.stringify(data.body, null, 2);
    } else {
      bodyText = text;
    }

    const result = {
      ok: resp.ok && Number(statusCode) === 200,
      statusCode,
      bodyObj,
      bodyText,
    };
    return result;
  }

  function normalizeUsedPercent(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : null;
  }

  function formatUsageResetText(windowInfo) {
    if (windowInfo?.reset_at !== undefined && windowInfo?.reset_at !== null) {
      const ts = Number(windowInfo.reset_at);
      if (Number.isFinite(ts)) return new Date(ts * 1000).toLocaleString();
    }
    if (windowInfo?.reset_after_seconds !== undefined && windowInfo?.reset_after_seconds !== null) {
      const sec = Number(windowInfo.reset_after_seconds);
      if (Number.isFinite(sec)) return `${sec}s`;
    }
    return "-";
  }

  function parseUsageSnapshot(bodyObj) {
    const planType = String(bodyObj?.plan_type || "").trim();
    const rateLimit = bodyObj?.rate_limit;
    const windows = [
      { label: "5h", data: rateLimit?.primary_window },
      { label: "7d", data: rateLimit?.secondary_window },
    ].filter((entry) => entry.data && typeof entry.data === "object");

    let displayWindow = windows[0] || null;
    let maxUsedPercent = null;
    for (const entry of windows) {
      const usedPercent = normalizeUsedPercent(entry?.data?.used_percent);
      if (usedPercent === null) continue;
      if (maxUsedPercent === null || usedPercent > maxUsedPercent) {
        maxUsedPercent = usedPercent;
        displayWindow = entry;
      }
    }

    const limitReached = Boolean(rateLimit?.limit_reached) || rateLimit?.allowed === false || windows.some((entry) => {
      const usedPercent = normalizeUsedPercent(entry?.data?.used_percent);
      return usedPercent !== null && usedPercent >= 100;
    });
    const hasQuota = limitReached ? false : true;

    return {
      planType,
      usedPercent: maxUsedPercent,
      resetText: formatUsageResetText(displayWindow?.data),
      hasQuota,
      limitReached,
      displayWindowLabel: displayWindow?.label || "",
    };
  }

  function isQuotaResult(statusCode, bodyObj, bodyText) {
    const code = Number(statusCode);
    const text = `${JSON.stringify(bodyObj || {})} ${String(bodyText || "")}`.toLowerCase();
    if (bodyObj?.rate_limit?.limit_reached === true) return true;
    if (bodyObj?.rate_limit?.allowed === false) return true;
    if (text.includes("quota exhausted")) return true;
    if (text.includes("limit reached")) return true;
    if (text.includes("payment_required")) return true;
    return code === 402;
  }

  function markQueryResult(item, result, usageSnapshot) {
    item.lastStatusCode = result?.statusCode;
    item.usedPercent = usageSnapshot?.usedPercent ?? null;
    item.resetText = usageSnapshot?.resetText || "-";
    item.hasQuota = usageSnapshot?.hasQuota ?? null;
    item.planType = usageSnapshot?.planType || item.planType || "";
    if (Number(result?.statusCode) === 200) {
      item.queryState = usageSnapshot?.hasQuota === false ? "quota" : "ok";
      item.deleteEligible = false;
      return;
    }
    if (isQuotaResult(result?.statusCode, result?.bodyObj, result?.bodyText)) {
      item.queryState = "quota";
      item.deleteEligible = false;
      item.hasQuota = false;
      return;
    }
    item.queryState = "failed";
    item.deleteEligible = true;
    item.hasQuota = null;
  }

  function markQueryFailed(item, statusCode) {
    item.lastStatusCode = statusCode ?? "ERR";
    item.usedPercent = null;
    item.resetText = "-";
    item.hasQuota = null;
    item.queryState = "failed";
    item.deleteEligible = true;
  }

  function collectStats(items) {
    const stats = { total: items.length, unqueried: 0, healthy: 0, quota: 0, failed: 0, deletable: 0 };
    for (const item of items) {
      if (!supportsActiveCheck(item)) continue;
      if (isHealthyState(item)) stats.healthy += 1;
      else if (isQuotaState(item)) stats.quota += 1;
      else if (isFailedState(item)) stats.failed += 1;
      else stats.unqueried += 1;
      if (item.deleteEligible) stats.deletable += 1;
    }
    return stats;
  }

  async function runWithConcurrency(items, limit, worker) {
    if (!items.length) return;
    let cursor = 0;
    const n = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: n }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) break;
        await worker(items[idx], idx);
      }
    });
    await Promise.all(runners);
  }

  function createSidebar() {
    if (document.getElementById("__tm_universal_panel")) return;

    const DESKTOP_PANEL_WIDTH = 920;
    const panel = document.createElement("div");
    panel.id = "__tm_universal_panel";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.position = "fixed";
    panel.style.zIndex = "99999";
    panel.style.backdropFilter = "blur(18px) saturate(120%)";
    panel.style.borderRadius = "20px";
    panel.style.padding = "12px";
    panel.style.overflow = "hidden";
    panel.style.willChange = "transform";
    panel.style.transition = "transform 0.26s ease, opacity 0.22s ease";
    panel.style.fontFamily = "'MiSans','PingFang SC','HarmonyOS Sans SC','Microsoft YaHei UI','Noto Sans SC',sans-serif";
    panel.style.gap = "8px";
    panel.style.transformOrigin = "right top";
    panel.style.pointerEvents = "none";
    panel.style.visibility = "hidden";
    panel.style.opacity = "0";

    function createSegmentWrap() {
      const wrap = document.createElement("div");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "4px";
      wrap.style.padding = "4px";
      wrap.style.borderRadius = "14px";
      wrap.style.boxSizing = "border-box";
      wrap.style.minWidth = "0";
      return wrap;
    }

    function createActionBtn(text, role) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.role = role;
      btn.dataset.text = text;
      btn.textContent = text;
      btn.style.padding = "10px 14px";
      btn.style.borderRadius = "12px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "12px";
      btn.style.fontWeight = "700";
      btn.style.letterSpacing = "0.02em";
      btn.style.transition = "transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease";
      btn.addEventListener("mouseenter", () => {
        if (!btn.disabled) btn.style.transform = "translateY(-1px)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translateY(0)";
      });
      return btn;
    }

    function createSegmentBtn(text) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.style.flex = "0 0 auto";
      btn.style.whiteSpace = "nowrap";
      btn.style.padding = "7px 12px";
      btn.style.borderRadius = "10px";
      btn.style.fontSize = "11px";
      btn.style.fontWeight = "700";
      btn.style.lineHeight = "1";
      btn.style.cursor = "pointer";
      btn.style.transition = "background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease";
      btn.addEventListener("mouseenter", () => {
        if (!btn.disabled) btn.style.transform = "translateY(-1px)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translateY(0)";
      });
      return btn;
    }

    function createStat(label) {
      const box = document.createElement("div");
      box.style.display = "inline-flex";
      box.style.alignItems = "baseline";
      box.style.gap = "6px";
      box.style.padding = "7px 10px";
      box.style.borderRadius = "999px";
      box.style.whiteSpace = "nowrap";

      const name = document.createElement("span");
      name.textContent = label;
      name.style.fontSize = "11px";
      name.style.fontWeight = "600";

      const value = document.createElement("span");
      value.textContent = "0";
      value.style.fontSize = "14px";
      value.style.fontWeight = "800";

      box.appendChild(name);
      box.appendChild(value);
      return { box, name, value };
    }

    const topBar = document.createElement("div");
    topBar.style.display = "flex";
    topBar.style.flexDirection = "column";
    topBar.style.gap = "8px";
    panel.appendChild(topBar);

    const actionRow = document.createElement("div");
    actionRow.style.display = "flex";
    actionRow.style.alignItems = "center";
    actionRow.style.justifyContent = "space-between";
    actionRow.style.gap = "8px";
    actionRow.style.flexWrap = "wrap";
    topBar.appendChild(actionRow);

    const actionGroup = document.createElement("div");
    actionGroup.style.display = "flex";
    actionGroup.style.alignItems = "center";
    actionGroup.style.gap = "8px";
    actionGroup.style.flexWrap = "wrap";
    actionRow.appendChild(actionGroup);

    const btnBatchQuery = createActionBtn("全量检查", "query");
    const btnQuickCheck = createActionBtn("快速检查", "query");
    const btnBatchDelete = createActionBtn("一键优化", "delete");
    btnBatchQuery.title = "读取全部 Codex 凭证并执行完整检查";
    btnQuickCheck.title = "只读取后台已标成异常的凭证并执行检查";
    btnBatchDelete.title = "基于当前检查结果执行删除失效、启用健康、禁用无额度";
    actionGroup.appendChild(btnBatchQuery);
    actionGroup.appendChild(btnQuickCheck);
    actionGroup.appendChild(btnBatchDelete);

    const actionHint = document.createElement("div");
    actionHint.textContent = "说明：全量检查会检查全部，快速检查只看后台异常，一键优化会删除失效、启用健康、禁用无额度";
    actionHint.style.fontSize = "11px";
    actionHint.style.fontWeight = "600";
    actionHint.style.lineHeight = "1.5";
    actionHint.style.marginLeft = "2px";
    actionGroup.appendChild(actionHint);

    const statsRow = document.createElement("div");
    statsRow.style.display = "flex";
    statsRow.style.alignItems = "center";
    statsRow.style.justifyContent = "flex-end";
    statsRow.style.gap = "6px";
    statsRow.style.flexWrap = "wrap";
    actionRow.appendChild(statsRow);

    const metricTotal = createStat("总数");
    const metricUsage = createStat("总用量");
    const metricHealthy = createStat("健康");
    const metricNoQuota = createStat("无额度");
    const metricFailed = createStat("失效");
    statsRow.appendChild(metricTotal.box);
    statsRow.appendChild(metricUsage.box);
    statsRow.appendChild(metricHealthy.box);
    statsRow.appendChild(metricNoQuota.box);
    statsRow.appendChild(metricFailed.box);

    const progressText = document.createElement("div");
    progressText.style.fontSize = "11px";
    progressText.style.fontWeight = "600";
    progressText.style.whiteSpace = "nowrap";
    progressText.style.display = "none";
    statsRow.appendChild(progressText);

    const toolRow = document.createElement("div");
    toolRow.style.display = "flex";
    toolRow.style.alignItems = "center";
    toolRow.style.justifyContent = "space-between";
    toolRow.style.gap = "8px";
    toolRow.style.flexWrap = "wrap";
    topBar.appendChild(toolRow);

    const leftTabs = document.createElement("div");
    leftTabs.style.display = "flex";
    leftTabs.style.alignItems = "center";
    leftTabs.style.gap = "8px";
    leftTabs.style.flexWrap = "wrap";
    leftTabs.style.minWidth = "0";
    leftTabs.style.flex = "1";
    toolRow.appendChild(leftTabs);

    const channelTabs = createSegmentWrap();
    channelTabs.style.overflowX = "auto";
    channelTabs.style.overflowY = "hidden";
    channelTabs.style.maxWidth = "100%";
    channelTabs.style.scrollbarWidth = "thin";
    leftTabs.appendChild(channelTabs);

    channelTabs.addEventListener("wheel", (event) => {
      if (!event || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      channelTabs.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });

    const healthTabs = createSegmentWrap();
    leftTabs.appendChild(healthTabs);

    const pagerWrap = createSegmentWrap();
    toolRow.appendChild(pagerWrap);

    const prevBtn = createSegmentBtn("上一页");
    const pageText = document.createElement("div");
    pageText.textContent = "1 / 1";
    pageText.style.fontSize = "11px";
    pageText.style.fontWeight = "700";
    pageText.style.padding = "0 8px";
    pageText.style.whiteSpace = "nowrap";
    const nextBtn = createSegmentBtn("下一页");
    pagerWrap.appendChild(prevBtn);
    pagerWrap.appendChild(pageText);
    pagerWrap.appendChild(nextBtn);

    const list = document.createElement("div");
    list.style.flex = "1";
    list.style.minHeight = "0";
    list.style.overflow = "auto";
    list.style.padding = "6px";
    list.style.borderRadius = "16px";
    list.style.backdropFilter = "blur(8px)";
    panel.appendChild(list);

    const toggleBtn = document.createElement("button");
    toggleBtn.style.position = "fixed";
    toggleBtn.style.zIndex = "100000";
    toggleBtn.style.borderRadius = "999px";
    toggleBtn.style.padding = "9px 13px";
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.fontSize = "12px";
    toggleBtn.style.fontWeight = "700";
    toggleBtn.style.backdropFilter = "blur(10px)";
    toggleBtn.style.transition = "right 0.26s ease, bottom 0.26s ease, transform 0.2s ease";
    toggleBtn.addEventListener("mouseenter", () => {
      toggleBtn.style.transform = "translateY(-1px)";
    });
    toggleBtn.addEventListener("mouseleave", () => {
      toggleBtn.style.transform = "translateY(0)";
    });

    let isOpen = false;
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    let isMobile = mediaQuery.matches;
    const colorQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const THEME_STORAGE_KEY = "cli-proxy-theme";
    let lastThemeStoreRaw = "";
    const THEME_TOKENS = {
      dark: {
        panelText: "#f4f0e9",
        panelBg: "linear-gradient(152deg, rgba(64, 62, 58, 0.76), rgba(32, 33, 38, 0.82))",
        panelBorder: "1px solid rgba(228, 217, 204, 0.22)",
        panelShadow: "0 16px 42px rgba(10, 10, 14, 0.35)",
        softBg: "rgba(37, 39, 44, 0.62)",
        softBorder: "1px solid rgba(223,214,204,0.18)",
        metricBg: "rgba(65, 67, 74, 0.62)",
        metricBorder: "1px solid rgba(231,222,211,0.12)",
        metricLabelText: "#d9d0c5",
        metricValueText: "#fff8ef",
        statusText: "#f2ece3",
        summaryText: "#d6d0c9",
        tipText: "#dcc5a9",
        listBg: "rgba(23, 24, 28, 0.42)",
        listBorder: "1px solid rgba(223,214,204,0.18)",
        toggleBg: "linear-gradient(145deg, rgba(86, 88, 99, 0.9), rgba(60, 62, 72, 0.92))",
        toggleText: "#f4efe8",
        toggleBorder: "1px solid rgba(224,214,203,0.24)",
        toggleShadow: "0 10px 24px rgba(11, 13, 18, 0.34)",
        emptyText: "#d2c9be",
        cardBg: "linear-gradient(154deg, rgba(73, 71, 67, 0.36), rgba(44, 45, 50, 0.44))",
        cardBorder: "1px solid rgba(228,218,206,0.2)",
        titleText: "#f7f2ea",
        metaText: "#d6cec3",
        usageText: "#e8dfd4",
        badgeOkBg: "rgba(78, 123, 112, 0.56)",
        badgeOkText: "#d7f0e5",
        badgeWarnBg: "rgba(146, 118, 67, 0.6)",
        badgeWarnText: "#fff0c9",
        badgeFailBg: "rgba(145, 88, 84, 0.62)",
        badgeFailText: "#ffe2de",
        badgeIdleBg: "rgba(117, 114, 112, 0.58)",
        badgeIdleText: "#f0e8de",
        rowQueryBg: "linear-gradient(135deg, rgba(83, 129, 120, 0.9), rgba(70, 107, 118, 0.9))",
        rowDeleteBg: "linear-gradient(135deg, rgba(152, 87, 92, 0.9), rgba(124, 72, 82, 0.9))",
        rowBtnBorder: "1px solid rgba(231,222,211,0.16)",
        rowBtnText: "#fffdf9",
        topBtnBorder: "1px solid rgba(225,216,205,0.2)",
        topBtnText: "#fff9f1",
        topBtnBg: {
          query: "linear-gradient(135deg, rgba(83, 105, 139, 0.92), rgba(71, 90, 120, 0.94))",
          delete: "linear-gradient(135deg, rgba(148, 86, 92, 0.94), rgba(124, 72, 84, 0.94))",
        },
      },
      light: {
        panelText: "#2d2a26",
        panelBg: "linear-gradient(156deg, rgba(255, 252, 246, 0.9), rgba(244, 241, 236, 0.92))",
        panelBorder: "1px solid rgba(165, 156, 144, 0.42)",
        panelShadow: "0 14px 30px rgba(126, 119, 108, 0.18)",
        softBg: "rgba(255, 251, 245, 0.86)",
        softBorder: "1px solid rgba(171, 163, 152, 0.28)",
        metricBg: "rgba(255, 255, 252, 0.92)",
        metricBorder: "1px solid rgba(177, 168, 157, 0.28)",
        metricLabelText: "#666058",
        metricValueText: "#25221e",
        statusText: "#312d28",
        summaryText: "#4f5f79",
        tipText: "#8a5d3a",
        listBg: "rgba(255, 254, 250, 0.74)",
        listBorder: "1px solid rgba(171, 163, 152, 0.35)",
        toggleBg: "linear-gradient(145deg, rgba(251, 250, 247, 0.96), rgba(239, 236, 230, 0.94))",
        toggleText: "#5d6273",
        toggleBorder: "1px solid rgba(164, 156, 145, 0.48)",
        toggleShadow: "0 8px 18px rgba(136, 129, 118, 0.2)",
        emptyText: "#5f5a53",
        cardBg: "linear-gradient(155deg, rgba(255, 255, 252, 0.88), rgba(247, 244, 238, 0.84))",
        cardBorder: "1px solid rgba(177, 168, 157, 0.3)",
        titleText: "#25221e",
        metaText: "#5c564f",
        usageText: "#3d3832",
        badgeOkBg: "rgba(212, 237, 227, 0.92)",
        badgeOkText: "#24564c",
        badgeWarnBg: "rgba(250, 233, 187, 0.96)",
        badgeWarnText: "#7a5a16",
        badgeFailBg: "rgba(247, 216, 210, 0.92)",
        badgeFailText: "#7b3537",
        badgeIdleBg: "rgba(233, 227, 218, 0.96)",
        badgeIdleText: "#554f48",
        rowQueryBg: "linear-gradient(135deg, rgba(95, 150, 140, 0.9), rgba(76, 124, 131, 0.92))",
        rowDeleteBg: "linear-gradient(135deg, rgba(196, 112, 119, 0.9), rgba(170, 90, 102, 0.9))",
        rowBtnBorder: "1px solid rgba(126, 117, 107, 0.24)",
        rowBtnText: "#fffdfa",
        topBtnBorder: "1px solid rgba(127, 119, 109, 0.24)",
        topBtnText: "#fffdf9",
        topBtnBg: {
          query: "linear-gradient(135deg, rgba(102, 134, 176, 0.92), rgba(84, 113, 155, 0.92))",
          delete: "linear-gradient(135deg, rgba(198, 111, 121, 0.92), rgba(171, 91, 103, 0.92))",
        },
      },
    };

    function readThemeFromProjectStore() {
      try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return null;
        lastThemeStoreRaw = raw;
        const parsed = JSON.parse(raw);
        const resolved = parsed?.state?.resolvedTheme || parsed?.resolvedTheme;
        if (resolved === "dark" || resolved === "light") return resolved;
        const theme = parsed?.state?.theme || parsed?.theme;
        if (theme === "dark" || theme === "light") return theme;
      } catch (_) {}
      return null;
    }

    function readThemeFromDom() {
      try {
        const dt = (document.documentElement.getAttribute("data-theme") || "").toLowerCase();
        if (dt === "dark") return "dark";
        if (dt === "light") return "light";
      } catch (_) {}
      return null;
    }

    function resolveTheme() {
      const domTheme = readThemeFromDom();
      if (domTheme) return domTheme;
      const storeTheme = readThemeFromProjectStore();
      if (storeTheme) return storeTheme;
      return colorQuery.matches ? "dark" : "light";
    }

    let activeTheme = resolveTheme();
    let panelBusy = false;
    let currentChannelFilter = "all";
    let currentPage = 1;
    let currentHealthFilter = "all";

    function token() {
      return THEME_TOKENS[activeTheme] || THEME_TOKENS.dark;
    }

    function setProgress(text) {
      progressText.textContent = text || "";
      progressText.style.display = text ? "block" : "none";
    }

    function styleSegmentButton(btn, active, tone) {
      const t = token();
      const toneName = tone || "neutral";
      const activeBg = toneName === "delete" ? t.topBtnBg.delete : toneName === "ok" ? t.rowQueryBg : t.topBtnBg.query;
      const activeBorder = toneName === "delete" ? t.rowBtnBorder : t.topBtnBorder;
      btn.style.border = active ? activeBorder : "1px solid transparent";
      btn.style.background = active ? activeBg : "transparent";
      btn.style.color = active ? t.rowBtnText : t.panelText;
      btn.style.boxShadow = active ? "0 8px 18px rgba(0,0,0,0.12)" : "none";
      btn.style.opacity = btn.disabled ? "0.45" : active ? "1" : "0.92";
    }

    function applyTheme(themeName) {
      if (!THEME_TOKENS[themeName]) return;
      activeTheme = themeName;
      const t = token();

      panel.style.color = t.panelText;
      panel.style.background = t.panelBg;
      panel.style.border = t.panelBorder;
      panel.style.boxShadow = t.panelShadow;

      [metricTotal, metricUsage, metricHealthy, metricNoQuota, metricFailed].forEach((metric) => {
        metric.box.style.background = t.metricBg;
        metric.box.style.border = t.metricBorder;
        metric.box.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04)";
        metric.name.style.color = t.metricLabelText;
        metric.value.style.color = t.metricValueText;
      });
      progressText.style.color = t.summaryText;
      actionHint.style.color = t.summaryText;

      [channelTabs, healthTabs, pagerWrap].forEach((wrap) => {
        wrap.style.background = t.softBg;
        wrap.style.border = t.softBorder;
        wrap.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04)";
      });
      pageText.style.color = t.summaryText;

      list.style.background = t.listBg;
      list.style.border = t.listBorder;

      toggleBtn.style.background = t.toggleBg;
      toggleBtn.style.color = t.toggleText;
      toggleBtn.style.border = t.toggleBorder;
      toggleBtn.style.boxShadow = t.toggleShadow;

      [btnBatchQuery, btnQuickCheck, btnBatchDelete].forEach((btn) => {
        const role = btn.dataset.role || "query";
        btn.style.border = t.topBtnBorder;
        btn.style.color = t.topBtnText;
        btn.style.background = t.topBtnBg[role] || t.topBtnBg.query;
        btn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.14)";
      });
    }
    function syncTheme() {
      applyTheme(resolveTheme());
      scheduleRender();
    }

    function setBusy(busy, role) {
      panelBusy = Boolean(busy);
      [btnBatchQuery, btnQuickCheck, btnBatchDelete].forEach((btn) => {
        const isBusyBtn = panelBusy && (btn.dataset.role === (role || "query"));
        btn.disabled = panelBusy;
        btn.style.opacity = panelBusy ? "0.74" : "1";
        btn.style.cursor = panelBusy ? "not-allowed" : "pointer";
        btn.textContent = isBusyBtn ? `${btn.dataset.text}...` : btn.dataset.text;
      });
    }

    function getFilteredItems(items) {
      const key = normalizeChannelKey(currentChannelFilter);
      let result = !key || key === "all" ? items.slice() : items.filter((item) => normalizeChannelKey(item?.channel) === key);
      if (currentHealthFilter === "failed") result = result.filter((item) => isFailedState(item));
      if (currentHealthFilter === "healthy") result = result.filter((item) => isHealthyState(item));
      if (currentHealthFilter === "quota") result = result.filter((item) => isQuotaState(item));
      return result;
    }

    function getTotalPages(items) {
      return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    }

    function getPageItems(items) {
      const totalPages = getTotalPages(items);
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      const start = (currentPage - 1) * PAGE_SIZE;
      return items.slice(start, start + PAGE_SIZE);
    }

    function updateSummary() {
      const s = collectStats(pendingFiles);
      const totalValue = inventorySnapshot.loaded ? inventorySnapshot.total : pendingFiles.length;
      metricTotal.value.textContent = String(totalValue || 0);

      const usageTargets = pendingFiles.filter(
        (item) => supportsActiveCheck(item) && typeof item?.usedPercent === "number"
      );
      const usageTotalUnits = usageTargets.length * 100;
      const usageUsedUnits = usageTargets.reduce((acc, item) => acc + (Number(item.usedPercent) || 0), 0);
      const usagePercent = usageTotalUnits ? Math.round((usageUsedUnits / usageTotalUnits) * 100) : null;
      metricUsage.value.textContent = usagePercent === null ? "--" : `${usagePercent}%`;
      metricUsage.box.title = usagePercent === null ? "" : `已用 ${Math.round(usageUsedUnits)}/${usageTotalUnits}`;

      metricHealthy.value.textContent = String(s.healthy);
      metricNoQuota.value.textContent = String(s.quota);
      metricFailed.value.textContent = String(s.failed);
    }

    function renderChannelTabs() {
      currentChannelFilter = "all";
      channelTabs.innerHTML = "";
      channelTabs.style.display = "none";
    }

    function renderHealthTabs() {
      const options = [
        { value: "all", label: "全部", tone: "query" },
        { value: "healthy", label: "健康", tone: "ok" },
        { value: "quota", label: "无额度", tone: "query" },
        { value: "failed", label: "失效", tone: "delete" },
      ];
      healthTabs.innerHTML = "";
      options.forEach((option) => {
        const btn = createSegmentBtn(option.label);
        const isActive = option.value === currentHealthFilter;
        styleSegmentButton(btn, isActive, option.tone);
        btn.addEventListener("click", () => {
          if (currentHealthFilter === option.value) return;
          currentHealthFilter = option.value;
          currentPage = 1;
          scheduleRender();
        });
        healthTabs.appendChild(btn);
      });
    }

    function renderPager(totalPages) {
      pageText.textContent = `${currentPage} / ${totalPages}`;
      prevBtn.disabled = currentPage <= 1 || panelBusy;
      nextBtn.disabled = currentPage >= totalPages || panelBusy;
      styleSegmentButton(prevBtn, true, "query");
      styleSegmentButton(nextBtn, true, "query");
      prevBtn.style.opacity = prevBtn.disabled ? "0.45" : "1";
      nextBtn.style.opacity = nextBtn.disabled ? "0.45" : "1";
      prevBtn.style.cursor = prevBtn.disabled ? "not-allowed" : "pointer";
      nextBtn.style.cursor = nextBtn.disabled ? "not-allowed" : "pointer";
    }

    let renderQueued = false;
    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        renderList();
      });
    }

    function renderList() {
      const t = token();

      function applyToneBadge(el, tone) {
        if (tone === "ok") {
          el.style.background = t.badgeOkBg;
          el.style.color = t.badgeOkText;
          return;
        }
        if (tone === "warn") {
          el.style.background = t.badgeWarnBg;
          el.style.color = t.badgeWarnText;
          return;
        }
        if (tone === "fail") {
          el.style.background = t.badgeFailBg;
          el.style.color = t.badgeFailText;
          return;
        }
        el.style.background = t.badgeIdleBg;
        el.style.color = t.badgeIdleText;
      }

      updateSummary();
      renderChannelTabs(pendingFiles);
      renderHealthTabs();
      list.innerHTML = "";
      const filteredItems = getFilteredItems(pendingFiles);
      const totalPages = getTotalPages(filteredItems);
      const pageItems = getPageItems(filteredItems);
      renderPager(totalPages);

      if (!filteredItems.length) {
        list.style.display = "block";
        const empty = document.createElement("div");
        empty.textContent = inventorySnapshot.loaded ? "当前没有 Codex 凭证" : "还没有 Codex 数据";
        empty.style.fontSize = "12px";
        empty.style.lineHeight = "1.6";
        empty.style.color = t.emptyText;
        empty.style.padding = "14px";
        empty.style.textAlign = "center";
        list.appendChild(empty);
        return;
      }

      list.style.display = "grid";
      list.style.gridTemplateColumns = isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";
      list.style.gap = "8px";
      list.style.alignContent = "start";

      pageItems.forEach((item, idx) => {
        const card = document.createElement("div");
        card.style.border = t.cardBorder;
        card.style.borderRadius = "14px";
        card.style.padding = "9px 10px";
        card.style.background = t.cardBg;
        card.style.backdropFilter = "blur(6px)";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "6px";
        card.style.minWidth = "0";
        card.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.05)";
        card.style.transition = "transform 0.18s ease, box-shadow 0.18s ease";
        card.addEventListener("mouseenter", () => {
          card.style.transform = "translateY(-1px)";
          card.style.boxShadow = "0 10px 20px rgba(0,0,0,0.10)";
        });
        card.addEventListener("mouseleave", () => {
          card.style.transform = "translateY(0)";
          card.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.05)";
        });

        const headRow = document.createElement("div");
        headRow.style.display = "flex";
        headRow.style.alignItems = "flex-start";
        headRow.style.justifyContent = "space-between";
        headRow.style.gap = "8px";

        const nameWrap = document.createElement("div");
        nameWrap.style.minWidth = "0";
        nameWrap.style.flex = "1";

        const absoluteIndex = (currentPage - 1) * PAGE_SIZE + idx + 1;
        const name = document.createElement("div");
        name.textContent = `${absoluteIndex}. ${item.name}`;
        name.style.fontSize = "12px";
        name.style.fontWeight = "700";
        name.style.lineHeight = "1.45";
        name.style.wordBreak = "break-all";
        name.style.color = t.titleText;
        nameWrap.appendChild(name);

        const meta = document.createElement("div");
        meta.textContent = getTechDetailText(item);
        meta.style.fontSize = "10px";
        meta.style.color = t.metaText;
        meta.style.wordBreak = "break-all";
        meta.style.lineHeight = "1.5";
        nameWrap.appendChild(meta);

        headRow.appendChild(nameWrap);

        const badges = document.createElement("div");
        badges.style.display = "flex";
        badges.style.alignItems = "center";
        badges.style.gap = "6px";
        badges.style.flexWrap = "wrap";
        badges.style.justifyContent = "flex-end";

        const channelBadge = document.createElement("span");
        channelBadge.textContent = formatChannelLabel(item.channel);
        channelBadge.style.display = "inline-flex";
        channelBadge.style.alignItems = "center";
        channelBadge.style.padding = "3px 8px";
        channelBadge.style.borderRadius = "999px";
        channelBadge.style.fontSize = "10px";
        channelBadge.style.fontWeight = "700";
        channelBadge.style.background = t.badgeIdleBg;
        channelBadge.style.color = t.badgeIdleText;
        badges.appendChild(channelBadge);

        const planBadge = document.createElement("span");
        planBadge.textContent = formatPlanTypeLabel(item.planType);
        planBadge.style.display = "inline-flex";
        planBadge.style.alignItems = "center";
        planBadge.style.padding = "3px 8px";
        planBadge.style.borderRadius = "999px";
        planBadge.style.fontSize = "10px";
        planBadge.style.fontWeight = "700";
        planBadge.style.background = t.badgeIdleBg;
        planBadge.style.color = t.badgeIdleText;
        badges.appendChild(planBadge);

        const enabledBadge = document.createElement("span");
        enabledBadge.textContent = getEnabledStateText(item);
        enabledBadge.style.display = "inline-flex";
        enabledBadge.style.alignItems = "center";
        enabledBadge.style.padding = "3px 8px";
        enabledBadge.style.borderRadius = "999px";
        enabledBadge.style.fontSize = "10px";
        enabledBadge.style.fontWeight = "700";
        applyToneBadge(enabledBadge, getEnabledStateTone(item));
        badges.appendChild(enabledBadge);

        const actualBadge = document.createElement("span");
        actualBadge.textContent = getActualResultText(item);
        actualBadge.style.display = "inline-flex";
        actualBadge.style.alignItems = "center";
        actualBadge.style.padding = "3px 8px";
        actualBadge.style.borderRadius = "999px";
        actualBadge.style.fontSize = "10px";
        actualBadge.style.fontWeight = "800";
        applyToneBadge(actualBadge, getActualResultTone(item));
        badges.appendChild(actualBadge);

        headRow.appendChild(badges);
        card.appendChild(headRow);

        const usageRow = document.createElement("div");
        usageRow.textContent = item.queryState === "unqueried" ? "尚未检查" : getUsageText(item);
        usageRow.style.fontSize = "11px";
        usageRow.style.lineHeight = "1.5";
        usageRow.style.color = t.usageText;
        card.appendChild(usageRow);

        list.appendChild(card);
      });
    }
    function applyPanelState() {
      if (isMobile) {
        panel.style.left = "10px";
        panel.style.right = "10px";
        panel.style.top = "auto";
        panel.style.bottom = "64px";
        panel.style.width = "auto";
        panel.style.maxHeight = "74vh";
        panel.style.transform = isOpen ? "translateY(0) scale(1)" : "translateY(calc(100% + 32px)) scale(0.985)";
        list.style.minHeight = "min(48vh, 420px)";

        toggleBtn.style.left = "auto";
        toggleBtn.style.right = "16px";
        toggleBtn.style.top = "auto";
        toggleBtn.style.bottom = "16px";
        toggleBtn.textContent = isOpen ? "收起" : "展开";
      } else {
        panel.style.left = "auto";
        panel.style.right = "16px";
        panel.style.top = "70px";
        panel.style.bottom = "auto";
        panel.style.width = "min(920px, calc(100vw - 24px))";
        panel.style.maxHeight = "80vh";
        panel.style.transform = isOpen ? "translateX(0) scale(1)" : "translateX(calc(100% + 24px)) scale(0.985)";
        list.style.minHeight = "0";

        toggleBtn.style.left = "auto";
        toggleBtn.style.right = "16px";
        toggleBtn.style.top = "auto";
        toggleBtn.style.bottom = "16px";
        toggleBtn.textContent = isOpen ? "收起" : "展开";
      }

      panel.style.opacity = isOpen ? "1" : "0";
      panel.style.pointerEvents = isOpen ? "auto" : "none";
      panel.style.visibility = isOpen ? "visible" : "hidden";
    }

    function setOpen(open) {
      isOpen = Boolean(open);
      applyPanelState();
    }

    toggleBtn.addEventListener("click", () => {
      setOpen(!isOpen);
    });

    const mediaHandler = () => {
      isMobile = mediaQuery.matches;
      applyPanelState();
      scheduleRender();
    };
    if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", mediaHandler);
    else if (typeof mediaQuery.addListener === "function") mediaQuery.addListener(mediaHandler);

    const colorHandler = () => {
      syncTheme();
    };
    if (typeof colorQuery.addEventListener === "function") colorQuery.addEventListener("change", colorHandler);
    else if (typeof colorQuery.addListener === "function") colorQuery.addListener(colorHandler);

    window.addEventListener("storage", (ev) => {
      if (!ev || ev.key === null || ev.key === THEME_STORAGE_KEY) syncTheme();
    });

    const rootObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          syncTheme();
          break;
        }
      }
    });
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    setInterval(() => {
      try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY) || "";
        if (raw !== lastThemeStoreRaw) {
          lastThemeStoreRaw = raw;
          syncTheme();
        }
      } catch (_) {}
    }, 1200);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) setOpen(false);
    });

    prevBtn.addEventListener("click", () => {
      if (currentPage <= 1 || panelBusy) return;
      currentPage -= 1;
      scheduleRender();
    });

    nextBtn.addEventListener("click", () => {
      const totalPages = getTotalPages(getFilteredItems(pendingFiles));
      if (currentPage >= totalPages || panelBusy) return;
      currentPage += 1;
      scheduleRender();
    });

    async function batchQueryItems(items, alreadyBusy) {
      const codexItems = items.filter((item) => supportsActiveCheck(item));
      if (!codexItems.length) {
        setProgress("Codex 0");
        return;
      }
      if (!alreadyBusy) setBusy(true, "query");
      let ok = 0;
      let fail = 0;
      let processed = 0;
      try {
        await runWithConcurrency(codexItems, QUERY_CONCURRENCY, async (item) => {
          try {
            const res = await callWithAuthRetry(`检测 Codex ${item.name}`, (token) =>
              queryUsageByAuthIndex(token, item)
            );
            const snap = parseUsageSnapshot(res.bodyObj);
            markQueryResult(item, res, snap);
            if (isHealthyState(item)) ok += 1;
            else if (isFailedState(item)) fail += 1;
          } catch (_) {
            markQueryFailed(item, "ERR");
            fail += 1;
          }
          processed += 1;
          setProgress(`Codex ${processed}/${codexItems.length}`);
          scheduleRender();
        });
        const done = collectStats(pendingFiles);
        setProgress(`健康 ${done.healthy}  无额度 ${done.quota}  失效 ${done.failed}`);
      } finally {
        scheduleRender();
        if (!alreadyBusy) setBusy(false);
      }
    }
    async function fetchAndQueryAll() {
      setBusy(true, "query");
      setProgress("读取中");
      try {
        const allFiles = await callWithAuthRetry("读取全部 Codex 凭证", (token) => fetchAllFiles(token));
        const codexFiles = allFiles.filter((item) => supportsActiveCheck(item));
        inventorySnapshot = buildInventorySnapshot(codexFiles);
        currentPage = 1;
        pendingFiles = codexFiles.slice();
        renderList();
        if (!pendingFiles.length) {
          setProgress("总数 0");
          return;
        }
        await batchQueryItems(pendingFiles, true);
      } catch (e) {
        setProgress(e?.status === 401 ? "读取失败" : "检查失败");
      } finally {
        setBusy(false);
        scheduleRender();
      }
    }

    async function fetchAndQueryNonActive() {
      setBusy(true, "query");
      setProgress("读取异常中");
      try {
        const abnormalFiles = await callWithAuthRetry("读取异常 Codex 凭证", (token) => fetchNonActive(token));
        const codexFiles = abnormalFiles.filter((item) => supportsActiveCheck(item));
        inventorySnapshot = buildInventorySnapshot(codexFiles);
        currentPage = 1;
        pendingFiles = codexFiles.slice();
        renderList();
        if (!pendingFiles.length) {
          setProgress("异常 0");
          return;
        }
        await batchQueryItems(pendingFiles, true);
      } catch (e) {
        setProgress(e?.status === 401 ? "读取失败" : "快速检查失败");
      } finally {
        setBusy(false);
        scheduleRender();
      }
    }

    function isToggleUnsupportedError(err) {
      const status = Number(err?.status);
      return status === 404 || status === 405 || status === 501;
    }

    function syncLocalDisabledState(item, disabled) {
      item.disabled = Boolean(disabled);
      if (disabled) {
        item.status = "disabled";
        item.statusMessage = "disabled via management API";
        return;
      }
      item.status = "active";
      item.statusMessage = "";
    }

    async function updateItemsDisabledState(items, disabled, phaseLabel, progressPrefix) {
      if (!items.length) {
        return { success: 0, failed: 0, unsupported: false };
      }
      let success = 0;
      let failed = 0;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        setProgress(`${progressPrefix} ${i + 1}/${items.length}`);
        try {
          await callWithAuthRetry(`${phaseLabel} ${item.name}`, (token) =>
            patchAuthFileDisabled(token, item.name, disabled)
          );
          syncLocalDisabledState(item, disabled);
          success += 1;
        } catch (err) {
          if (isToggleUnsupportedError(err)) {
            return { success, failed, unsupported: true };
          }
          failed += 1;
        }
        scheduleRender();
      }
      return { success, failed, unsupported: false };
    }

    async function deleteFailedItems() {
      if (!pendingFiles.length) {
        setProgress("总数 0");
        return;
      }
      const deletable = pendingFiles.filter((x) => supportsActiveCheck(x) && x.deleteEligible && x.name && x.name !== "(no-name)");
      const enableTargets = pendingFiles.filter((x) =>
        supportsActiveCheck(x) && isHealthyState(x) && x.disabled && x.name && x.name !== "(no-name)"
      );
      const disableTargets = pendingFiles.filter((x) =>
        supportsActiveCheck(x) && isQuotaState(x) && !x.disabled && x.name && x.name !== "(no-name)"
      );
      if (!deletable.length && !enableTargets.length && !disableTargets.length) {
        setProgress("无需优化");
        return;
      }

      setBusy(true, "delete");
      let deleteSuccess = 0;
      const deletedSet = new Set();
      let enableSummary = { success: 0, failed: 0, unsupported: false };
      let disableSummary = { success: 0, failed: 0, unsupported: false };
      try {
        for (let i = 0; i < deletable.length; i += 1) {
          const item = deletable[i];
          setProgress(`删除失效 ${i + 1}/${deletable.length}`);
          try {
            const r = await callWithAuthRetry(`删除 ${item.name}`, (token) =>
              deleteByName(token, item.name)
            );
            if (r.ok) {
              deleteSuccess += 1;
              deletedSet.add(item);
            }
          } catch (_) {
            // keep failed item in list
          }
          scheduleRender();
        }
        pendingFiles = pendingFiles.filter((x) => !deletedSet.has(x));
        applyDeletedItems(Array.from(deletedSet));
        enableSummary = await updateItemsDisabledState(enableTargets, false, "启用凭证", "启用健康");
        disableSummary = await updateItemsDisabledState(disableTargets, true, "禁用凭证", "禁用无额度");

        const deleteFailed = deletable.length - deleteSuccess;
        const parts = [
          `已删 ${deleteSuccess}`,
          deleteFailed ? `未删 ${deleteFailed}` : "",
          `已启用 ${enableSummary.success}`,
          enableSummary.failed ? `启用失败 ${enableSummary.failed}` : "",
          `已禁用 ${disableSummary.success}`,
          disableSummary.failed ? `禁用失败 ${disableSummary.failed}` : "",
        ].filter(Boolean);
        if (enableSummary.unsupported || disableSummary.unsupported) {
          parts.push("启用/禁用接口不可用");
        }
        setProgress(parts.join("  "));
      } finally {
        setBusy(false, "delete");
        scheduleRender();
      }
    }

    btnBatchQuery.addEventListener("click", async () => {
      if (panelBusy) return;
      await fetchAndQueryAll();
    });

    btnQuickCheck.addEventListener("click", async () => {
      if (panelBusy) return;
      await fetchAndQueryNonActive();
    });

    btnBatchDelete.addEventListener("click", async () => {
      if (panelBusy) return;
      await deleteFailedItems();
    });

    syncTheme();
    renderList();
    applyPanelState();
    document.body.appendChild(panel);
    document.body.appendChild(toggleBtn);
  }


  function init() {
    installTokenSniffer();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createSidebar, { once: true });
    } else {
      createSidebar();
    }
  }

  init();
})();
