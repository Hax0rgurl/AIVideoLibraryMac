"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // injected/lib/origins.ts
  var CHATGPT_ORIGIN, CHATGPT_WORKER_URL, SORA_ORIGIN;
  var init_origins = __esm({
    "injected/lib/origins.ts"() {
      "use strict";
      CHATGPT_ORIGIN = "https://chatgpt.com";
      CHATGPT_WORKER_URL = `${CHATGPT_ORIGIN}/?save-sora-worker=1`;
      SORA_ORIGIN = "https://sora.chatgpt.com";
    }
  });

  // injected/lib/auth.ts
  var auth_exports = {};
  __export(auth_exports, {
    deriveAuthContext: () => deriveAuthContext,
    deriveViewerUserId: () => deriveViewerUserId
  });
  async function deriveAuthContext() {
    if (cachedAuthContext && Date.now() - cachedAuthContextAt < AUTH_CACHE_TTL_MS) {
      return cachedAuthContext;
    }
    const deviceId = getCookieValue("oai-did");
    const language = navigator.language || "en-US";
    const bootstrapSnapshot = readBootstrapSnapshot();
    const sessionSnapshot = bootstrapSnapshot || await trySessionEndpoint(`${SORA_ORIGIN}/api/auth/session`) || await trySessionEndpoint(`${SORA_ORIGIN}/auth/session`) || await trySessionEndpoint("/api/auth/session") || await trySessionEndpoint("/auth/session") || await trySessionEndpoint(`${CHATGPT_ORIGIN}/api/auth/session`) || await trySessionEndpoint(`${CHATGPT_ORIGIN}/auth/session`);
    const token = pickFirstString([
      window.sessionStorage.getItem("save_sora_auth_token"),
      window.localStorage.getItem("save_sora_auth_token"),
      bootstrapSnapshot?.token,
      sessionSnapshot?.token
    ]) || findTokenInWebStorage(window.sessionStorage) || findTokenInWebStorage(window.localStorage) || findTokenInObject(window.__NEXT_DATA__);
    if (!token) {
      throw new Error("Could not derive a Sora bearer token from the signed-in browser session.");
    }
    if (sessionSnapshot?.userId) {
      cachedViewerUserId = sessionSnapshot.userId;
    }
    cachedAuthContext = { token, deviceId, language };
    cachedAuthContextAt = Date.now();
    return cachedAuthContext;
  }
  async function deriveViewerUserId() {
    if (cachedViewerUserId) {
      return cachedViewerUserId;
    }
    const bootstrapSnapshot = readBootstrapSnapshot();
    const seededViewerUserId = pickFirstString([
      window.localStorage.getItem("save_sora_viewer_user_id"),
      window.sessionStorage.getItem("save_sora_viewer_user_id"),
      bootstrapSnapshot?.userId
    ]);
    if (seededViewerUserId) {
      cachedViewerUserId = seededViewerUserId;
      return cachedViewerUserId;
    }
    const sessionSnapshot = bootstrapSnapshot || await trySessionEndpoint(`${SORA_ORIGIN}/api/auth/session`) || await trySessionEndpoint(`${SORA_ORIGIN}/auth/session`) || await trySessionEndpoint("/api/auth/session") || await trySessionEndpoint("/auth/session") || await trySessionEndpoint(`${CHATGPT_ORIGIN}/api/auth/session`) || await trySessionEndpoint(`${CHATGPT_ORIGIN}/auth/session`);
    if (sessionSnapshot?.userId) {
      cachedViewerUserId = sessionSnapshot.userId;
      return cachedViewerUserId;
    }
    const authContext = await deriveAuthContext();
    const tokenPayload = decodeJwtPayload(authContext.token);
    const authClaims = tokenPayload?.["https://api.openai.com/auth"];
    const tokenUserId = pickFirstString([
      authClaims?.user_id,
      authClaims?.chatgpt_user_id,
      tokenPayload?.user_id,
      tokenPayload?.chatgpt_user_id
    ]);
    if (typeof tokenUserId === "string" && /^user-[A-Za-z0-9_-]+$/.test(tokenUserId)) {
      cachedViewerUserId = tokenUserId;
      return cachedViewerUserId;
    }
    const nextDataUserId = findViewerUserIdFromPayload(window.__NEXT_DATA__);
    if (nextDataUserId) {
      cachedViewerUserId = nextDataUserId;
      return cachedViewerUserId;
    }
    throw new Error("Could not derive the signed-in Sora viewer id.");
  }
  function getCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }
  function readBootstrapSnapshot() {
    const bootstrapJson = pickFirstString([
      window.sessionStorage.getItem("save_sora_auth_bootstrap"),
      window.localStorage.getItem("save_sora_auth_bootstrap")
    ]);
    const seededToken = pickFirstString([
      window.sessionStorage.getItem("save_sora_auth_token"),
      window.localStorage.getItem("save_sora_auth_token")
    ]);
    const seededUserId = pickFirstString([
      window.sessionStorage.getItem("save_sora_viewer_user_id"),
      window.localStorage.getItem("save_sora_viewer_user_id")
    ]);
    let parsedBootstrap = null;
    if (bootstrapJson) {
      try {
        parsedBootstrap = JSON.parse(bootstrapJson);
      } catch (_error) {
        parsedBootstrap = null;
      }
    }
    const token = pickFirstString([
      seededToken,
      findTokenInObject(parsedBootstrap)
    ]);
    const userId = pickFirstString([
      seededUserId,
      findViewerUserIdFromPayload(parsedBootstrap)
    ]);
    if (!token && !userId) {
      return null;
    }
    return { token, userId };
  }
  async function trySessionEndpoint(url) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" }
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      const token = findTokenInObject(payload);
      const userId = findViewerUserIdFromPayload(payload);
      if (!token && !userId) {
        return null;
      }
      return {
        token: findTokenInObject(payload),
        userId: findViewerUserIdFromPayload(payload)
      };
    } catch (_error) {
      return null;
    }
  }
  function findTokenInWebStorage(storage) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      const value = storage.getItem(key);
      if (!value) {
        continue;
      }
      const directMatch = extractBearerToken(value);
      if (directMatch) {
        return directMatch;
      }
      try {
        const parsedValue = JSON.parse(value);
        const objectMatch = findTokenInObject(parsedValue);
        if (objectMatch) {
          return objectMatch;
        }
      } catch (_error) {
        continue;
      }
    }
    return "";
  }
  function findTokenInObject(value, depth = 0) {
    if (depth > 6 || value == null) {
      return "";
    }
    if (typeof value === "string") {
      return extractBearerToken(value);
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const match = findTokenInObject(entry, depth + 1);
        if (match) {
          return match;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }
    const record = value;
    const directToken = pickFirstString([
      record.accessToken,
      record.access_token,
      record.token,
      record.idToken,
      record.id_token
    ]);
    if (directToken) {
      return extractBearerToken(directToken);
    }
    for (const entryValue of Object.values(record)) {
      const match = findTokenInObject(entryValue, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }
  function extractBearerToken(value) {
    const trimmedValue = value.trim();
    if (/^eyJ[A-Za-z0-9._-]+$/.test(trimmedValue)) {
      return trimmedValue;
    }
    const bearerMatch = trimmedValue.match(/eyJ[A-Za-z0-9._-]+/);
    return bearerMatch?.[0] ?? "";
  }
  function decodeJwtPayload(token) {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    try {
      const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(payload);
    } catch (_error) {
      return null;
    }
  }
  function findViewerUserIdFromPayload(value, depth = 0) {
    if (depth > 6 || value == null) {
      return "";
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const match = findViewerUserIdFromPayload(entry, depth + 1);
        if (match) {
          return match;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }
    const record = value;
    const userId = pickFirstString([
      record.user_id,
      record.userId,
      record.chatgpt_user_id,
      record.chatgptUserId,
      record.id
    ]);
    if (userId && /^user-[A-Za-z0-9_-]+$/.test(userId)) {
      return userId;
    }
    for (const entryValue of Object.values(record)) {
      const match = findViewerUserIdFromPayload(entryValue, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }
  function pickFirstString(candidates) {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  }
  var AUTH_CACHE_TTL_MS, cachedAuthContext, cachedAuthContextAt, cachedViewerUserId;
  var init_auth = __esm({
    "injected/lib/auth.ts"() {
      "use strict";
      init_origins();
      AUTH_CACHE_TTL_MS = 6e4;
      cachedAuthContext = null;
      cachedAuthContextAt = 0;
      cachedViewerUserId = "";
    }
  });

  // injected/sources/source-runner.ts
  init_auth();
  init_origins();

  // injected/lib/shared.ts
  init_auth();
  init_origins();
  var FETCH_RETRY_DELAYS_MS = [500, 1500, 3e3];
  var DEFAULT_MAX_ATTEMPTS = FETCH_RETRY_DELAYS_MS.length + 1;
  var ADAPTIVE_429_BASE_DELAY_MS = 900;
  var ADAPTIVE_429_MAX_DELAY_MS = 2e4;
  var ADAPTIVE_429_MAX_ATTEMPTS = 12;
  async function fetchJson(url) {
    return (await fetchJsonWithDiagnostics(url)).payload;
  }
  async function fetchJsonWithDiagnostics(url, options = {}) {
    const authContext = await deriveAuthContext();
    const resolvedUrl = resolveSoraUrl(url);
    const headers = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${authContext.token}`,
      "oai-language": authContext.language,
      ...authContext.deviceId ? { "oai-device-id": authContext.deviceId } : {}
    };
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const maxAttempts = resolveMaxAttempts(options);
    let rateLimited = false;
    let networkErrorCount = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetch(resolvedUrl, {
          credentials: "include",
          headers
        });
      } catch (error) {
        networkErrorCount += 1;
        const isLastAttempt2 = attempt >= maxAttempts - 1;
        if (isLastAttempt2 || !isRetriableFetchError(error)) {
          throw new Error(
            buildSoraNetworkRequestErrorMessage(
              resolvedUrl,
              "GET",
              attempt + 1,
              getFetchErrorMessage(error)
            )
          );
        }
        await sleep(resolveRetryDelayMs(null, attempt, options));
        continue;
      }
      if (response.ok) {
        return {
          payload: await response.json(),
          diagnostics: {
            requested_at: requestedAt,
            responded_at: (/* @__PURE__ */ new Date()).toISOString(),
            status: response.status,
            attempts: attempt + 1,
            rate_limited: rateLimited,
            network_errors: networkErrorCount
          }
        };
      }
      if (response.status === 429) {
        rateLimited = true;
      }
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt || !isRetriableSoraStatus(response.status)) {
        throw new Error(buildSoraRequestErrorMessage(response.status, resolvedUrl, "GET", attempt + 1));
      }
      const delayMs = resolveRetryDelayMs(response, attempt, options);
      await sleep(delayMs);
    }
    throw new Error("Sora request failed after retries.");
  }
  async function fetchText(url) {
    const resolvedUrl = resolveSoraUrl(url);
    const response = await fetch(resolvedUrl, {
      credentials: "include",
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(buildSoraRequestErrorMessage(response.status, resolvedUrl, "GET"));
    }
    return response.text();
  }
  function getPostListingRows(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const record = payload;
    return pickFirstArray([record.items, record.data, record.results, record.posts, record.entries, record.feed, record.nodes]);
  }
  function getNextCursor(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const record = payload;
    return pickFirstString2([
      record.next_cursor,
      record.nextCursor,
      record.pagination?.next_cursor,
      record.pagination?.nextCursor,
      record.cursor
    ]) || null;
  }
  function getEstimatedTotalCount(payload, observedCount) {
    if (!payload || typeof payload !== "object") {
      return observedCount;
    }
    const record = payload;
    return pickFirstNumber([
      record.total_count,
      record.totalCount,
      record.estimated_total_count,
      record.estimatedTotalCount,
      record.item_count,
      record.itemCount,
      record.result_count,
      record.resultCount,
      record.pagination?.total_count,
      record.pagination?.totalCount,
      observedCount
    ]) ?? observedCount;
  }
  function getUsernameFromRouteUrl(routeUrl) {
    const normalizedRouteUrl = routeUrl.trim();
    if (/^@?[A-Za-z0-9._-]+$/.test(normalizedRouteUrl)) {
      return normalizedRouteUrl.replace(/^@+/, "");
    }
    try {
      const pathname = new URL(routeUrl, SORA_ORIGIN).pathname;
      const segments = pathname.split("/").filter(Boolean);
      const profileSegment = segments.find((segment) => segment.startsWith("@")) ?? (segments[0] === "profile" ? segments[1] : segments[0]);
      return typeof profileSegment === "string" ? profileSegment.replace(/^@+/, "") : "";
    } catch (_error) {
      return "";
    }
  }
  function resolveSoraUrl(url) {
    try {
      return new URL(url, SORA_ORIGIN).toString();
    } catch (_error) {
      return url;
    }
  }
  function isRetriableSoraStatus(status) {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
  }
  function resolveMaxAttempts(options) {
    if (typeof options.maxAttempts === "number" && options.maxAttempts > 0) {
      return Math.max(1, Math.floor(options.maxAttempts));
    }
    return options.adaptive429 ? ADAPTIVE_429_MAX_ATTEMPTS : DEFAULT_MAX_ATTEMPTS;
  }
  function resolveRetryDelayMs(response, attempt, options) {
    if (response && options.adaptive429 && response.status === 429) {
      const retryAfterDelay = parseRetryAfterMs(response.headers.get("retry-after"));
      if (retryAfterDelay != null) {
        return clampDelay(retryAfterDelay, options);
      }
      const baseDelay = options.adaptive429BaseDelayMs ?? ADAPTIVE_429_BASE_DELAY_MS;
      const exponentialDelay = baseDelay * Math.pow(2, Math.min(6, attempt));
      return clampDelay(exponentialDelay, options);
    }
    return FETCH_RETRY_DELAYS_MS[Math.min(attempt, FETCH_RETRY_DELAYS_MS.length - 1)] ?? FETCH_RETRY_DELAYS_MS[FETCH_RETRY_DELAYS_MS.length - 1] ?? 3e3;
  }
  function isRetriableFetchError(error) {
    const message = getFetchErrorMessage(error).toLowerCase();
    if (!message) {
      return true;
    }
    if (message.includes("aborted")) {
      return false;
    }
    return message.includes("failed to fetch") || message.includes("network") || message.includes("load failed");
  }
  function getFetchErrorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    if (typeof error === "string") {
      return error.trim();
    }
    return "";
  }
  function parseRetryAfterMs(headerValue) {
    if (!headerValue) {
      return null;
    }
    const trimmedHeader = headerValue.trim();
    if (!trimmedHeader) {
      return null;
    }
    const secondsValue = Number(trimmedHeader);
    if (Number.isFinite(secondsValue) && secondsValue >= 0) {
      return secondsValue * 1e3;
    }
    const parsedDateMs = Date.parse(trimmedHeader);
    if (!Number.isFinite(parsedDateMs)) {
      return null;
    }
    return Math.max(0, parsedDateMs - Date.now());
  }
  function clampDelay(delayMs, options) {
    const maxDelay = options.adaptive429MaxDelayMs ?? ADAPTIVE_429_MAX_DELAY_MS;
    return Math.min(maxDelay, Math.max(250, Math.round(delayMs)));
  }
  function sleep(durationMs) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
  function buildSoraRequestErrorMessage(status, requestUrl, method, attempts = 1) {
    const requestLabel = describeRequestForError(requestUrl, method);
    const attemptsLabel = attempts > 1 ? ` Attempts: ${attempts}.` : "";
    if (status === 400) {
      return `Sora request failed with status 400. Request: ${requestLabel}.${attemptsLabel}`;
    }
    if (status === 401 || status === 403) {
      return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
    }
    if (status === 404) {
      return `Sora request failed with status 404. Request: ${requestLabel}.${attemptsLabel}`;
    }
    if (status === 429) {
      return `Sora request failed with status 429. Request: ${requestLabel}.${attemptsLabel}`;
    }
    if (status >= 500) {
      return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
    }
    return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
  }
  function buildSoraNetworkRequestErrorMessage(requestUrl, method, attempts, lastErrorMessage) {
    const requestLabel = describeRequestForError(requestUrl, method);
    const attemptLabel = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
    const trailingError = lastErrorMessage ? ` Last error: ${lastErrorMessage}.` : "";
    return `Sora request failed due to a network error after ${attemptLabel}. Request: ${requestLabel}.${trailingError}`;
  }
  function describeRequestForError(requestUrl, method) {
    try {
      const url = new URL(requestUrl);
      const filteredParams = new URLSearchParams();
      const includeParam = (key) => {
        const value = url.searchParams.get(key);
        if (!value) {
          return;
        }
        filteredParams.set(key, value.length > 48 ? `${value.slice(0, 48)}...` : value);
      };
      includeParam("cut");
      includeParam("limit");
      includeParam("cursor");
      includeParam("offset");
      const query = filteredParams.toString();
      return `${method} ${url.pathname}${query ? `?${query}` : ""}`;
    } catch (_error) {
      return `${method} ${requestUrl}`;
    }
  }
  function resolveSharedVideoIdFromValue(value, depth = 0) {
    if (depth > 6 || value == null) {
      return "";
    }
    if (typeof value === "string") {
      return extractSharedVideoId(value);
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const match = resolveSharedVideoIdFromValue(entry, depth + 1);
        if (match) {
          return match;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }
    const record = value;
    const typeHint = pickFirstString2([
      record.kind,
      record.type,
      record.role,
      record.asset_type,
      record.assetType,
      record.media_type,
      record.mediaType
    ]).toLowerCase();
    const isSourceLikeRecord = typeHint.includes("source") || typeHint.includes("reference") || typeHint.includes("input");
    if (isSourceLikeRecord) {
      return "";
    }
    const directMatch = pickFirstString2([
      record.shared_post_id,
      record.sharedPostId,
      record.post_id,
      record.postId,
      record.share_id,
      record.shareId,
      record.public_id,
      record.publicId,
      record.id,
      extractSharedVideoId(record.permalink),
      extractSharedVideoId(record.detail_url),
      extractSharedVideoId(record.detailUrl),
      extractSharedVideoId(record.share_url),
      extractSharedVideoId(record.shareUrl),
      extractSharedVideoId(record.url)
    ]);
    if (/^s_[A-Za-z0-9_-]+$/.test(directMatch)) {
      return directMatch;
    }
    for (const entryValue of Object.values(record)) {
      const match = resolveSharedVideoIdFromValue(entryValue, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }
  function extractSharedVideoId(value) {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    const trimmedValue = value.trim();
    if (/^s_[A-Za-z0-9_-]+$/.test(trimmedValue)) {
      return trimmedValue;
    }
    const match = trimmedValue.match(/\/(?:p|video)\/(s_[A-Za-z0-9_-]+)/i);
    return match?.[1] ?? "";
  }
  function extractDraftGenerationId(value, depth = 0) {
    if (depth > 6 || value == null) {
      return "";
    }
    if (typeof value === "string") {
      return /^gen_[A-Za-z0-9_-]+$/.test(value.trim()) ? value.trim() : "";
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const match = extractDraftGenerationId(entry, depth + 1);
        if (match) {
          return match;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }
    const record = value;
    const directMatch = pickFirstString2([record.generation_id, record.generationId, record.id, record.task_id, record.taskId]);
    if (/^gen_[A-Za-z0-9_-]+$/.test(directMatch)) {
      return directMatch;
    }
    for (const entryValue of Object.values(record)) {
      const match = extractDraftGenerationId(entryValue, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }
  function pickFirstArray(candidates) {
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }
    return [];
  }
  function pickFirstString2(candidates) {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  }
  function pickFirstNumber(candidates) {
    for (const candidate of candidates) {
      const numericValue = Number(candidate);
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }
    return null;
  }
  function getRawRowKey(row) {
    if (!row || typeof row !== "object") {
      return "";
    }
    const record = row;
    return pickFirstString2([
      resolveSharedVideoIdFromValue(record),
      extractDraftGenerationId(record),
      record.post_id,
      record.postId,
      record.public_id,
      record.publicId,
      record.id,
      extractSharedVideoId(record.permalink),
      extractSharedVideoId(record.detail_url),
      extractSharedVideoId(record.detailUrl),
      extractSharedVideoId(record.url),
      pickFirstString2([
        typeof record.url === "string" ? record.url : "",
        typeof record.detail_url === "string" ? record.detail_url : "",
        typeof record.detailUrl === "string" ? record.detailUrl : ""
      ])
    ]);
  }

  // injected/sources/draft-metadata-helpers.ts
  var SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
  function getDraftKind(row) {
    return pickFirstString2([
      row.kind,
      row.draft?.kind,
      row.item?.kind,
      row.data?.kind,
      row.output?.kind
    ]);
  }
  function extractEstimatedSizeBytesFromAnyRecord(record) {
    const candidates = [
      record.size_bytes,
      record.sizeBytes,
      record.file_size,
      record.fileSize,
      record.filesize
    ];
    const attachments = getNestedObjectArrays(record);
    for (const attachment of attachments) {
      candidates.push(
        attachment.size_bytes,
        attachment.sizeBytes,
        attachment.file_size,
        attachment.fileSize,
        attachment.filesize
      );
      const encodings = attachment.encodings && typeof attachment.encodings === "object" ? attachment.encodings : null;
      const source = encodings?.source && typeof encodings.source === "object" ? encodings.source : null;
      const sourceWm = encodings?.source_wm && typeof encodings.source_wm === "object" ? encodings.source_wm : null;
      const md = encodings?.md && typeof encodings.md === "object" ? encodings.md : null;
      candidates.push(source?.size, sourceWm?.size, md?.size);
    }
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
    return null;
  }
  function extractThumbnailUrlFromAnyRecord(record) {
    const directCandidates = [record.thumbnail_url, record.thumbnailUrl, record.preview_image_url, record.previewImageUrl, record.poster_url, record.posterUrl, record.image_url, record.imageUrl];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
    const attachments = getNestedObjectArrays(record);
    for (const attachment of attachments) {
      const attachmentCandidates = [attachment.thumbnail_url, attachment.thumbnailUrl, attachment.preview_image_url, attachment.previewImageUrl, attachment.poster_url, attachment.posterUrl, attachment.image_url, attachment.imageUrl];
      for (const candidate of attachmentCandidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate;
        }
      }
    }
    return "";
  }
  function extractPlaybackUrlFromAnyRecord(record) {
    const directDownloadUrls = record.download_urls && typeof record.download_urls === "object" ? record.download_urls : null;
    const directDownloadUrlsCamel = record.downloadUrls && typeof record.downloadUrls === "object" ? record.downloadUrls : null;
    const directPlayback = pickFirstOpenAiVideoUrl([
      directDownloadUrls?.watermark,
      directDownloadUrlsCamel?.watermark
    ]);
    if (directPlayback) {
      return directPlayback;
    }
    const attachments = getNestedObjectArrays(record);
    for (const attachment of attachments) {
      const attachmentDownloadUrls = attachment.download_urls && typeof attachment.download_urls === "object" ? attachment.download_urls : null;
      const attachmentDownloadUrlsCamel = attachment.downloadUrls && typeof attachment.downloadUrls === "object" ? attachment.downloadUrls : null;
      const attachmentPlayback = pickFirstOpenAiVideoUrl([
        attachmentDownloadUrls?.watermark,
        attachmentDownloadUrlsCamel?.watermark
      ]);
      if (attachmentPlayback) {
        return attachmentPlayback;
      }
    }
    return "";
  }
  function extractDownloadUrlFromAnyRecord(record) {
    const directDownloadUrls = record.download_urls && typeof record.download_urls === "object" ? record.download_urls : null;
    const directDownloadUrlsCamel = record.downloadUrls && typeof record.downloadUrls === "object" ? record.downloadUrls : null;
    const directEncodings = record.encodings && typeof record.encodings === "object" ? record.encodings : null;
    const directSourceWm = directEncodings?.source_wm && typeof directEncodings.source_wm === "object" ? directEncodings.source_wm : null;
    const directSource = directEncodings?.source && typeof directEncodings.source === "object" ? directEncodings.source : null;
    const directMd = directEncodings?.md && typeof directEncodings.md === "object" ? directEncodings.md : null;
    const directLd = directEncodings?.ld && typeof directEncodings.ld === "object" ? directEncodings.ld : null;
    const directDownload = pickFirstOpenAiVideoUrl([
      directDownloadUrls?.no_watermark,
      directDownloadUrlsCamel?.no_watermark,
      directDownloadUrlsCamel?.noWatermark,
      directDownloadUrls?.watermark,
      directDownloadUrlsCamel?.watermark,
      record.resolved_download_url,
      record.resolvedDownloadUrl,
      record.resolved_playback_url,
      record.resolvedPlaybackUrl,
      record.downloadable_url,
      record.downloadableUrl,
      directSourceWm?.path,
      directSource?.path,
      record.url,
      directMd?.path,
      directLd?.path
    ]);
    if (directDownload) {
      return directDownload;
    }
    const attachments = getNestedObjectArrays(record);
    for (const attachment of attachments) {
      const attachmentDownloadUrls = attachment.download_urls && typeof attachment.download_urls === "object" ? attachment.download_urls : null;
      const attachmentDownloadUrlsCamel = attachment.downloadUrls && typeof attachment.downloadUrls === "object" ? attachment.downloadUrls : null;
      const attachmentEncodings = attachment.encodings && typeof attachment.encodings === "object" ? attachment.encodings : null;
      const attachmentSourceWm = attachmentEncodings?.source_wm && typeof attachmentEncodings.source_wm === "object" ? attachmentEncodings.source_wm : null;
      const attachmentSource = attachmentEncodings?.source && typeof attachmentEncodings.source === "object" ? attachmentEncodings.source : null;
      const attachmentMd = attachmentEncodings?.md && typeof attachmentEncodings.md === "object" ? attachmentEncodings.md : null;
      const attachmentLd = attachmentEncodings?.ld && typeof attachmentEncodings.ld === "object" ? attachmentEncodings.ld : null;
      const attachmentDownload = pickFirstOpenAiVideoUrl([
        attachmentDownloadUrls?.no_watermark,
        attachmentDownloadUrlsCamel?.no_watermark,
        attachmentDownloadUrlsCamel?.noWatermark,
        attachmentDownloadUrls?.watermark,
        attachmentDownloadUrlsCamel?.watermark,
        attachment.resolved_download_url,
        attachment.resolvedDownloadUrl,
        attachment.resolved_playback_url,
        attachment.resolvedPlaybackUrl,
        attachment.downloadable_url,
        attachment.downloadableUrl,
        attachmentSourceWm?.path,
        attachmentSource?.path,
        attachment.url,
        attachmentMd?.path,
        attachmentLd?.path
      ]);
      if (attachmentDownload) {
        return attachmentDownload;
      }
    }
    return "";
  }
  function resolveExistingDraftVideoId(row) {
    const resolvedVideoId = pickFirstString2([
      row.resolved_video_id,
      row.resolvedVideoId,
      extractSharedVideoId(row.resolved_share_url),
      extractSharedVideoId(row.resolvedShareUrl)
    ]);
    if (SHARED_VIDEO_ID_PATTERN.test(resolvedVideoId)) {
      return resolvedVideoId;
    }
    const draftRecord = row.draft && typeof row.draft === "object" ? row.draft : null;
    const postObject = row.post && typeof row.post === "object" ? row.post : null;
    const draftPostObject = draftRecord?.post && typeof draftRecord.post === "object" ? draftRecord.post : null;
    const directVideoId = pickFirstString2([
      getDirectSharedVideoId(row),
      draftRecord ? getDirectSharedVideoId(draftRecord) : "",
      postObject ? resolveSharedVideoIdFromValue(postObject) : "",
      draftPostObject ? resolveSharedVideoIdFromValue(draftPostObject) : "",
      postObject && typeof postObject.post === "object" ? resolveSharedVideoIdFromValue(postObject.post) : "",
      draftPostObject && typeof draftPostObject.post === "object" ? resolveSharedVideoIdFromValue(draftPostObject.post) : "",
      getSharedVideoIdFromOutputArrays(row),
      draftRecord ? getSharedVideoIdFromOutputArrays(draftRecord) : ""
    ]);
    return SHARED_VIDEO_ID_PATTERN.test(directVideoId) ? directVideoId : "";
  }
  function getNestedObjectArrays(record) {
    const keys = ["attachments", "outputs", "media", "assets", "files", "videos", "entries", "nodes", "results", "clips"];
    const nested = [];
    for (const key of keys) {
      const value = record[key];
      if (!Array.isArray(value)) {
        continue;
      }
      for (const entry of value) {
        if (entry && typeof entry === "object") {
          nested.push(entry);
        }
      }
    }
    return nested;
  }
  function pickFirstOpenAiVideoUrl(candidates) {
    for (const candidate of candidates) {
      const normalized = normalizeOpenAiVideoUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return "";
  }
  function normalizeOpenAiVideoUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    try {
      const parsed = new URL(value, "https://sora.chatgpt.com");
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "videos.openai.com" || hostname.endsWith(".videos.openai.com")) {
        return parsed.toString();
      }
    } catch (_error) {
      return "";
    }
    return "";
  }
  function getDirectSharedVideoId(record) {
    const recordId = typeof record.id === "string" ? record.id : "";
    return pickFirstString2([
      record.shared_post_id,
      record.sharedPostId,
      record.post_id,
      record.postId,
      record.public_id,
      record.publicId,
      record.share_id,
      record.shareId,
      record.video_id,
      record.videoId,
      SHARED_VIDEO_ID_PATTERN.test(recordId) ? recordId : "",
      extractSharedVideoId(record.permalink),
      extractSharedVideoId(record.detail_url),
      extractSharedVideoId(record.detailUrl),
      extractSharedVideoId(record.share_url),
      extractSharedVideoId(record.shareUrl),
      extractSharedVideoId(record.public_url),
      extractSharedVideoId(record.publicUrl),
      extractSharedVideoId(record.url)
    ]);
  }
  function getSharedVideoIdFromOutputArrays(record) {
    for (const key of ["attachments", "outputs", "media", "assets", "files", "videos", "entries", "nodes", "results", "clips"]) {
      const value = record[key];
      if (!Array.isArray(value)) {
        continue;
      }
      const match = resolveSharedVideoIdFromValue(value);
      if (SHARED_VIDEO_ID_PATTERN.test(match)) {
        return match;
      }
    }
    return "";
  }

  // injected/sources/fetch-batch-filters.ts
  function filterRowsByTimeWindow(rows, sinceMs, untilMs) {
    if (sinceMs == null && untilMs == null) {
      return rows;
    }
    return rows.filter((row) => {
      const timestampMs = extractRowTimestampMs(row);
      if (timestampMs == null) {
        return true;
      }
      if (sinceMs != null && timestampMs < sinceMs) {
        return false;
      }
      if (untilMs != null && timestampMs > untilMs) {
        return false;
      }
      return true;
    });
  }
  function reachedOlderThanSinceBoundary(rows, sinceMs) {
    if (sinceMs == null || rows.length === 0) {
      return false;
    }
    let seenTimestamp = false;
    for (const row of rows) {
      const timestampMs = extractRowTimestampMs(row);
      if (timestampMs == null) {
        return false;
      }
      seenTimestamp = true;
      if (timestampMs >= sinceMs) {
        return false;
      }
    }
    return seenTimestamp;
  }
  function extractRowTimestampMs(row) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const record = row;
    const post = record.post && typeof record.post === "object" ? record.post : null;
    const draft = record.draft && typeof record.draft === "object" ? record.draft : null;
    return pickFirstTimestampMs([
      record.liked_at,
      record.likedAt,
      record.liked_on,
      record.likedOn,
      record.posted_at,
      record.postedAt,
      record.published_at,
      record.publishedAt,
      record.created_at,
      record.createdAt,
      record.updated_at,
      record.updatedAt,
      post?.liked_at,
      post?.likedAt,
      post?.liked_on,
      post?.likedOn,
      post?.posted_at,
      post?.postedAt,
      post?.published_at,
      post?.publishedAt,
      post?.created_at,
      post?.createdAt,
      post?.updated_at,
      post?.updatedAt,
      draft?.liked_at,
      draft?.likedAt,
      draft?.liked_on,
      draft?.likedOn,
      draft?.posted_at,
      draft?.postedAt,
      draft?.published_at,
      draft?.publishedAt,
      draft?.created_at,
      draft?.createdAt,
      draft?.updated_at,
      draft?.updatedAt
    ]);
  }
  function pickFirstTimestampMs(candidates) {
    for (const candidate of candidates) {
      const parsed = parseTimestampMsCandidate(candidate);
      if (parsed != null) {
        return parsed;
      }
    }
    return null;
  }
  function parseTimestampMsCandidate(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e10 ? value : value * 1e3;
    }
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e10 ? numeric : numeric * 1e3;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // injected/sources/source-runner.ts
  var DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS = 3e3;
  var DRAFT_SHARE_POST_MAX_RETRY_DELAY_MS = 3e4;
  var DRAFT_SHARE_POST_MAX_ATTEMPTS = 2;
  var DRAFT_RESOLUTION_LOG_PREFIX = "[Save Sora][Draft Resolve]";
  var SAVEV_API_ORIGIN = "https://crx-api.savev.co";
  var SAVEV_SORA_WATERMARK_UUID = "eaa665130fc1a1d2f3acc5c5265a1c00ddd9924fc6d20566___";
  var SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
  var creatorTargetCache = /* @__PURE__ */ new Map();
  var characterIdByUsernameCache = /* @__PURE__ */ new Map();
  function logDraftResolutionStep(step, context) {
    try {
      console.log(`${DRAFT_RESOLUTION_LOG_PREFIX} ${step}`, context);
    } catch (_error) {
    }
  }
  async function runSourceRequest(request) {
    if (request.type === "fetch-detail-html") {
      return { detail_url: request.detail_url, html: await fetchText(request.detail_url) };
    }
    if (request.type === "resolve-viewer-identity") {
      return resolveViewerIdentity();
    }
    if (request.type === "resolve-draft-reference") {
      return resolveDraftReference(request);
    }
    if (request.type === "get-sora-watermark-task") {
      return getSoraWatermarkTask(request);
    }
    if (request.type === "get-sora-watermark-free-video") {
      return getSoraWatermarkFreeVideo(request);
    }
    if (request.type === "resolve-creator-profile") {
      return resolveCreatorProfile(request.route_url);
    }
    if (request.type === "fetch-character-accounts") {
      const viewerUserId = await deriveViewerUserId();
      const url = new URL(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, SORA_ORIGIN);
      url.searchParams.set("limit", String(request.limit ?? 100));
      if (request.cursor) {
        url.searchParams.set("cursor", request.cursor);
      }
      const payload = await fetchJson(url.toString());
      return {
        accounts: getPostListingRows(payload),
        next_cursor: getNextCursor(payload)
      };
    }
    if (request.type === "fetch-batch") {
      return runFetchBatch(request);
    }
    throw new Error(`Unsupported injected request type: ${String(request.type)}`);
  }
  async function getSoraWatermarkTask(request) {
    const videoId = request.video_id.trim();
    if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error("getSoraWatermarkTask requires a valid s_* video_id.");
    }
    const targetUrl = `${SORA_ORIGIN}/p/${encodeURIComponent(videoId)}`;
    const endpointUrl = new URL("/v2/oversea-extension/soraWatermark/soraWatermarkTask", SAVEV_API_ORIGIN);
    endpointUrl.searchParams.set("url", targetUrl);
    endpointUrl.searchParams.set("uuid", SAVEV_SORA_WATERMARK_UUID);
    const response = await fetch(endpointUrl.toString(), {
      headers: {
        accept: "*/*"
      },
      method: "GET"
    });
    if (!response.ok) {
      throw new Error(`getSoraWatermarkTask failed with status ${response.status}.`);
    }
    const payload = await response.json();
    const taskId = typeof payload.data === "string" ? payload.data.trim() : "";
    if (!taskId) {
      throw new Error("getSoraWatermarkTask response missing data.");
    }
    return taskId;
  }
  async function getSoraWatermarkFreeVideo(request) {
    const taskId = request.task_id.trim();
    if (!taskId) {
      throw new Error("getSoraWatermarkFreeVideo requires a non-empty task_id.");
    }
    const endpointUrl = new URL("/v2/oversea-extension/soraWatermark/queryTask", SAVEV_API_ORIGIN);
    endpointUrl.searchParams.set("taskId", taskId);
    const response = await fetch(endpointUrl.toString(), {
      headers: {
        accept: "*/*"
      },
      method: "GET"
    });
    if (!response.ok) {
      throw new Error(`getSoraWatermarkFreeVideo failed with status ${response.status}.`);
    }
    const payload = await response.json();
    if (typeof payload.data !== "string") {
      return null;
    }
    const normalizedUrl = payload.data.trim();
    return normalizedUrl.length > 0 ? normalizedUrl : null;
  }
  async function runFetchBatch(request) {
    if (request.source === "creatorPublished") {
      return runCreatorPublishedBatch(request);
    }
    if (request.source === "characterAccountAppearances" || request.source === "sideCharacter") {
      return runCharacterAccountAppearancesBatch(request);
    }
    let cursor = request.cursor ?? null;
    let offset = request.offset ?? (request.source === "drafts" || request.source === "likes" ? 0 : null);
    let estimatedTotalCount = 0;
    let endpointKey = request.endpoint_key ?? null;
    const rows = [];
    const rowKeys = [];
    for (let pageIndex = 0; pageIndex < (request.page_budget ?? 1); pageIndex += 1) {
      const batchPayload = await fetchBatchPayload(request, cursor, offset, endpointKey);
      const payload = batchPayload.payload;
      const pageRows = annotateLikesRowsWithSourceOrder(
        request.source,
        batchPayload.endpointKey,
        getPostListingRows(payload),
        offset
      );
      const inRangeRows = filterRowsByTimeWindow(pageRows, request.since_ms, request.until_ms);
      const enrichedRows = isDraftSource(request.source) ? enrichDraftRows(inRangeRows, request.draft_resolution_entries ?? [], request.source) : inRangeRows;
      rows.push(...enrichedRows);
      rowKeys.push(...enrichedRows.map((row) => getRawRowKey(row)).filter(Boolean));
      endpointKey = batchPayload.endpointKey;
      estimatedTotalCount = Math.max(estimatedTotalCount, getEstimatedTotalCount(payload, rows.length));
      const nextCursor = getNextCursor(payload);
      const requestLimit = getFetchLimitForSource(request.source, request.limit);
      const hasMoreRows = pageRows.length >= requestLimit;
      const usesOffsetPagination = shouldUseOffsetPagination(request.source, batchPayload.endpointKey);
      const nextOffset = usesOffsetPagination ? (offset ?? 0) + Math.max(1, pageRows.length) : null;
      const isDone = shouldFinishFetchPage(request.source, pageRows.length, nextCursor, hasMoreRows) || reachedOlderThanSinceBoundary(pageRows, request.since_ms);
      cursor = nextCursor;
      offset = nextOffset;
      if (isDone) {
        return {
          rows,
          row_keys: rowKeys,
          estimated_total_count: estimatedTotalCount,
          endpoint_key: endpointKey,
          next_cursor: cursor,
          next_offset: offset,
          done: true
        };
      }
    }
    return {
      rows,
      row_keys: rowKeys,
      estimated_total_count: estimatedTotalCount,
      endpoint_key: endpointKey,
      next_cursor: cursor,
      next_offset: offset,
      done: false
    };
  }
  async function runCharacterAccountAppearancesBatch(request) {
    const resolvedCharacterId = await resolveCharacterAccountId(
      request.character_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    if (!resolvedCharacterId.startsWith("ch_")) {
      throw new Error("Character appearances fetch requires a resolvable ch_* id.");
    }
    const limit = String(getFetchLimitForSource(request.source, request.limit));
    const requestedCursor = request.cursor ?? null;
    const fetchResult = await fetchJsonWithDiagnostics(
      buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(resolvedCharacterId)}`, {
        limit,
        cut: "appearances",
        cursor: requestedCursor
      }).toString(),
      request.source === "sideCharacter" ? { adaptive429: true } : {}
    );
    const payload = fetchResult.payload;
    const pageRows = getPostListingRows(payload);
    const nextCursor = getNextCursor(payload);
    const endpointKey = request.source === "sideCharacter" ? "side-character-feed-appearances" : "character-feed-appearances";
    return {
      rows: pageRows,
      row_keys: pageRows.map((row) => getRawRowKey(row)).filter(Boolean),
      estimated_total_count: getEstimatedTotalCount(payload, pageRows.length),
      endpoint_key: endpointKey,
      next_cursor: nextCursor,
      next_offset: null,
      request_diagnostics: request.source === "sideCharacter" ? {
        ...fetchResult.diagnostics,
        cursor_in: requestedCursor,
        cursor_out: nextCursor
      } : void 0,
      done: !nextCursor || reachedOlderThanSinceBoundary(pageRows, request.since_ms)
    };
  }
  async function runCreatorPublishedBatch(request) {
    const resolvedCreatorId = await resolveCreatorPublishedUserId(
      request.creator_user_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    if (!resolvedCreatorId) {
      throw new Error("Creator published fetch requires a resolvable user id.");
    }
    const limit = String(getFetchLimitForSource(request.source, request.limit));
    const payload = await fetchJson(
      buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(resolvedCreatorId)}`, {
        limit,
        cut: "nf2",
        cursor: request.cursor ?? null
      }).toString()
    );
    const pageRows = getPostListingRows(payload);
    const nextCursor = getNextCursor(payload);
    return {
      rows: pageRows,
      row_keys: pageRows.map((row) => getRawRowKey(row)).filter(Boolean),
      estimated_total_count: getEstimatedTotalCount(payload, pageRows.length),
      endpoint_key: "creator-feed-nf2",
      next_cursor: nextCursor,
      next_offset: null,
      done: !nextCursor || reachedOlderThanSinceBoundary(pageRows, request.since_ms)
    };
  }
  function annotateLikesRowsWithSourceOrder(source, endpointKey, rows, offset) {
    if (source !== "likes" || endpointKey !== "likes") {
      return rows;
    }
    const baseOffset = Math.max(0, offset ?? 0);
    return rows.map((row, index) => {
      if (!row || typeof row !== "object") {
        return row;
      }
      const record = row;
      return {
        ...record,
        __save_sora_like_rank: baseOffset + index
      };
    });
  }
  async function fetchBatchPayload(request, cursor, offset, endpointKey) {
    const limit = String(getFetchLimitForSource(request.source, request.limit));
    const endpointCandidates = await buildFetchEndpointCandidates(request, cursor, offset, limit);
    const matchedCandidate = endpointKey ? endpointCandidates.find((candidate) => candidate.key === endpointKey) ?? null : null;
    if (matchedCandidate) {
      try {
        return {
          endpointKey: matchedCandidate.key,
          payload: await fetchCandidatePayload(matchedCandidate)
        };
      } catch (_error) {
        return selectBestBatchPayload(endpointCandidates, request);
      }
    }
    return selectBestBatchPayload(endpointCandidates, request);
  }
  async function fetchCandidatePayload(candidate) {
    if (!candidate.optional) {
      return fetchJson(candidate.url);
    }
    try {
      return await fetchJson(candidate.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/status (400|404)\b/.test(message)) {
        return { items: [], next_cursor: null };
      }
      throw error;
    }
  }
  async function selectBestBatchPayload(candidates, request) {
    const attemptFailures = [];
    if (shouldUseStrictSequentialEndpointSelection(request.source)) {
      for (const candidate of candidates) {
        try {
          return {
            endpointKey: candidate.key,
            payload: await fetchCandidatePayload(candidate)
          };
        } catch (error) {
          attemptFailures.push({
            key: candidate.key,
            request: describeRequestFromCandidateUrl(candidate.url),
            status: extractStatusFromErrorMessage(error instanceof Error ? error.message : String(error))
          });
        }
      }
      throw new Error(buildFetchBatchAttemptFailureMessage(request, attemptFailures));
    }
    let firstSuccessfulResult = null;
    let bestResult = null;
    let bestScore = -1;
    let bestPaginatedResult = null;
    let bestPaginatedScore = -1;
    let bestEstimatedResult = null;
    let bestEstimatedTotalCount = -1;
    let bestEstimatedRowCount = -1;
    let bestEstimatedHasCursor = -1;
    let bestEstimatedPriority = -1;
    for (const candidate of candidates) {
      let payload;
      try {
        payload = await fetchCandidatePayload(candidate);
      } catch (error) {
        attemptFailures.push({
          key: candidate.key,
          request: describeRequestFromCandidateUrl(candidate.url),
          status: extractStatusFromErrorMessage(error instanceof Error ? error.message : String(error))
        });
        continue;
      }
      const rows = getPostListingRows(payload);
      const nextCursor = getNextCursor(payload);
      const score = rows.length;
      const result = { endpointKey: candidate.key, payload };
      if (!firstSuccessfulResult) {
        firstSuccessfulResult = result;
      }
      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
      if (nextCursor && score > 0 && score > bestPaginatedScore) {
        bestPaginatedScore = score;
        bestPaginatedResult = result;
      }
      if (score > 0) {
        const estimatedTotalCount = getEstimatedTotalCount(payload, score);
        const hasCursor = nextCursor ? 1 : 0;
        const priority = getEndpointCandidatePriority(request.source, candidate.key);
        const shouldReplaceEstimated = estimatedTotalCount > bestEstimatedTotalCount || estimatedTotalCount === bestEstimatedTotalCount && (score > bestEstimatedRowCount || score === bestEstimatedRowCount && (hasCursor > bestEstimatedHasCursor || hasCursor === bestEstimatedHasCursor && priority > bestEstimatedPriority));
        if (shouldReplaceEstimated) {
          bestEstimatedTotalCount = estimatedTotalCount;
          bestEstimatedRowCount = score;
          bestEstimatedHasCursor = hasCursor;
          bestEstimatedPriority = priority;
          bestEstimatedResult = result;
        }
      }
    }
    const resolvedResult = bestEstimatedResult ?? bestPaginatedResult ?? bestResult ?? firstSuccessfulResult;
    if (resolvedResult) {
      return resolvedResult;
    }
    throw new Error(buildFetchBatchAttemptFailureMessage(request, attemptFailures));
  }
  function shouldUseStrictSequentialEndpointSelection(source) {
    return source === "creatorPublished" || source === "characterAccountAppearances" || source === "sideCharacter";
  }
  function getEndpointCandidatePriority(source, endpointKey) {
    const normalizedKey = endpointKey.toLowerCase();
    if (source === "creatorPublished") {
      if (normalizedKey.includes("profile")) {
        return 5;
      }
      if (normalizedKey.includes("published")) {
        return 4;
      }
      if (normalizedKey.includes("public")) {
        return 3;
      }
      if (normalizedKey.includes("feed-nf2")) {
        return 2;
      }
      if (normalizedKey.includes("posts")) {
        return 1;
      }
    }
    return 0;
  }
  async function resolveCreatorProfile(routeUrl) {
    const username = getUsernameFromRouteUrl(routeUrl);
    if (!username) {
      return null;
    }
    const payload = await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`);
    const profileRecord = getLookupProfileRecord(payload);
    const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
    const resolvedUsername = resolveLookupUsername(payload, username);
    const resolvedCharacterUserId = resolveLookupCharacterId(payload) || await resolveCharacterIdFromAppearancesProbe(resolvedUsername || username);
    const resolvedPermalink = pickFirstString2([
      profileRecord.permalink,
      profileRecord.url,
      payload.permalink,
      payload.url
    ]) || `${SORA_ORIGIN}/profile/${encodeURIComponent(resolvedUsername || username)}`;
    return {
      ...payload,
      ...profileRecord,
      owner_profile: ownerProfileRecord ?? profileRecord.owner_profile ?? payload.owner_profile ?? null,
      username: resolvedUsername,
      user_id: resolveLookupUserId(payload) || pickFirstString2([profileRecord.user_id, profileRecord.userId, payload.user_id, payload.userId]),
      owner_user_id: pickFirstString2([
        profileRecord.owner_user_id,
        profileRecord.ownerUserId,
        payload.owner_user_id,
        payload.ownerUserId,
        ownerProfileRecord?.user_id,
        ownerProfileRecord?.userId
      ]),
      character_user_id: resolvedCharacterUserId,
      permalink: resolvedPermalink
    };
  }
  async function resolveViewerIdentity() {
    const viewerUserId = await deriveViewerUserId();
    let username = "";
    let displayName = "";
    let canCameo = true;
    let profilePictureUrl = "";
    let planType = null;
    let permalink = "";
    let createdAt = "";
    let characterCount = null;
    try {
      const payload = await fetchJson("/backend/project_y/v2/me");
      const profileRecord = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
      username = pickFirstString2([
        profileRecord?.username,
        profileRecord?.user_name,
        profileRecord?.userName,
        payload.username,
        payload.user_name,
        payload.userName
      ]);
      displayName = pickFirstString2([
        profileRecord?.display_name,
        profileRecord?.displayName,
        profileRecord?.name,
        payload.display_name,
        payload.displayName,
        payload.name,
        username
      ]);
      profilePictureUrl = pickFirstString2([
        profileRecord?.profile_picture_url,
        profileRecord?.profilePictureUrl,
        profileRecord?.avatar_url,
        profileRecord?.avatarUrl,
        payload.profile_picture_url,
        payload.profilePictureUrl,
        payload.avatar_url,
        payload.avatarUrl,
        profilePictureUrl
      ]);
      planType = pickFirstString2([
        profileRecord?.plan_type,
        profileRecord?.planType,
        payload.plan_type,
        payload.planType,
        planType
      ]) || null;
      permalink = pickFirstString2([
        profileRecord?.permalink,
        profileRecord?.url,
        payload.permalink,
        payload.url,
        permalink
      ]);
      createdAt = pickFirstTimestamp([
        profileRecord?.created_at,
        profileRecord?.createdAt,
        payload.created_at,
        payload.createdAt,
        createdAt
      ]);
      characterCount = pickFirstNumber2([
        profileRecord?.character_count,
        profileRecord?.characterCount,
        payload.character_count,
        payload.characterCount,
        characterCount
      ]);
      const canCameoValue = profileRecord?.can_cameo ?? profileRecord?.canCameo ?? payload.can_cameo ?? payload.canCameo;
      if (typeof canCameoValue === "boolean") {
        canCameo = canCameoValue;
      }
    } catch (_error) {
    }
    try {
      if (!username || !displayName) {
        const payload = await fetchJson(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}`);
        username = pickFirstString2([payload.username, payload.user_name, payload.userName, username]);
        displayName = pickFirstString2([payload.display_name, payload.displayName, payload.name, displayName, username]);
        profilePictureUrl = pickFirstString2([
          payload.profile_picture_url,
          payload.profilePictureUrl,
          payload.avatar_url,
          payload.avatarUrl,
          profilePictureUrl
        ]);
        planType = pickFirstString2([payload.plan_type, payload.planType, planType]) || null;
        permalink = pickFirstString2([payload.permalink, payload.url, permalink]);
        createdAt = pickFirstTimestamp([payload.created_at, payload.createdAt, createdAt]);
        characterCount = pickFirstNumber2([payload.character_count, payload.characterCount, characterCount]);
        const canCameoValue = payload.can_cameo ?? payload.canCameo;
        if (typeof canCameoValue === "boolean") {
          canCameo = canCameoValue;
        }
      }
    } catch (_error) {
    }
    if (!username) {
      try {
        const feedPayload = await fetchJson(buildUrl("/backend/project_y/profile_feed/me", { limit: "1", cut: "nf2" }).toString());
        const firstRow = getPostListingRows(feedPayload)[0];
        if (firstRow && typeof firstRow === "object") {
          const rowRecord = firstRow;
          const profileRecord = rowRecord.profile && typeof rowRecord.profile === "object" ? rowRecord.profile : null;
          if (profileRecord) {
            username = pickFirstString2([profileRecord.username, profileRecord.user_name, profileRecord.userName]);
            displayName = pickFirstString2([profileRecord.display_name, profileRecord.displayName, profileRecord.name, username]);
            profilePictureUrl = pickFirstString2([
              profileRecord.profile_picture_url,
              profileRecord.profilePictureUrl,
              profileRecord.avatar_url,
              profileRecord.avatarUrl,
              profilePictureUrl
            ]);
            planType = pickFirstString2([profileRecord.plan_type, profileRecord.planType, planType]) || null;
            permalink = pickFirstString2([profileRecord.permalink, profileRecord.url, permalink]);
            createdAt = pickFirstTimestamp([profileRecord.created_at, profileRecord.createdAt, createdAt]);
            characterCount = pickFirstNumber2([
              profileRecord.character_count,
              profileRecord.characterCount,
              characterCount
            ]);
            const canCameoValue = profileRecord.can_cameo ?? profileRecord.canCameo;
            if (typeof canCameoValue === "boolean") {
              canCameo = canCameoValue;
            }
          }
        }
      } catch (_error) {
      }
    }
    if (!displayName) {
      displayName = username;
    }
    if (!permalink && username) {
      permalink = `${SORA_ORIGIN}/profile/${encodeURIComponent(username)}`;
    }
    return {
      user_id: viewerUserId,
      username,
      display_name: displayName,
      can_cameo: canCameo,
      profile_picture_url: profilePictureUrl || null,
      plan_type: planType,
      permalink,
      created_at: createdAt,
      character_count: characterCount
    };
  }
  function pickFirstNumber2(values) {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsedValue = Number(value.trim());
        if (Number.isFinite(parsedValue)) {
          return parsedValue;
        }
      }
    }
    return null;
  }
  function pickFirstTimestamp(values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return "";
  }
  async function resolveCreatorTarget(explicitCreatorId, routeUrl, creatorUsername) {
    const routeUsername = getUsernameFromRouteUrl(routeUrl);
    const normalizedExplicitId = explicitCreatorId.trim();
    const normalizedUsername = creatorUsername.trim() || routeUsername;
    const cacheKey = [
      normalizedExplicitId.toLowerCase(),
      normalizedUsername.toLowerCase(),
      routeUsername.toLowerCase()
    ].join("|");
    const cachedTarget = creatorTargetCache.get(cacheKey);
    if (cachedTarget) {
      return cachedTarget;
    }
    let resolvedUserId = normalizedExplicitId;
    let resolvedUsername = normalizedUsername;
    if (normalizedUsername) {
      try {
        const payload = await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(normalizedUsername)}`);
        resolvedUserId = pickFirstString2([resolveLookupUserId(payload), resolveLookupCharacterId(payload), resolvedUserId]);
        resolvedUsername = resolveLookupUsername(payload, resolvedUsername || routeUsername);
      } catch (_error) {
      }
    }
    const identifiers = [...new Set([
      resolvedUserId,
      normalizedExplicitId,
      resolvedUsername,
      normalizedUsername,
      routeUsername
    ].map((value) => value.trim()).filter(Boolean))];
    if (identifiers.length === 0) {
      throw new Error("Creator fetch requires a user id or creator route.");
    }
    const target = {
      userId: resolvedUserId,
      username: resolvedUsername,
      identifiers
    };
    creatorTargetCache.set(cacheKey, target);
    return target;
  }
  async function resolveCharacterAccountId(explicitCharacterId, routeUrl, creatorUsername) {
    const trimmedCharacterId = explicitCharacterId.trim();
    if (trimmedCharacterId.startsWith("ch_")) {
      return trimmedCharacterId;
    }
    const username = creatorUsername || getUsernameFromRouteUrl(routeUrl);
    if (!username) {
      return "";
    }
    const normalizedUsername = username.trim().toLowerCase();
    const cachedCharacterId = characterIdByUsernameCache.get(normalizedUsername);
    if (cachedCharacterId) {
      return cachedCharacterId;
    }
    try {
      const payload = await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`);
      const resolvedCharacterId = resolveLookupCharacterId(payload);
      if (resolvedCharacterId) {
        characterIdByUsernameCache.set(normalizedUsername, resolvedCharacterId);
        return resolvedCharacterId;
      }
    } catch (_error) {
    }
    const probedCharacterId = await resolveCharacterIdFromAppearancesProbe(username);
    if (probedCharacterId) {
      characterIdByUsernameCache.set(normalizedUsername, probedCharacterId);
      return probedCharacterId;
    }
    return "";
  }
  async function resolveCreatorPublishedUserId(explicitCreatorId, routeUrl, creatorUsername) {
    const trimmedCreatorId = explicitCreatorId.trim();
    if (isUserAccountId(trimmedCreatorId)) {
      return trimmedCreatorId;
    }
    const username = creatorUsername || getUsernameFromRouteUrl(routeUrl);
    if (!username) {
      return "";
    }
    try {
      const payload = await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`);
      const resolvedUserId = resolveLookupUserId(payload);
      return isUserAccountId(resolvedUserId) ? resolvedUserId : "";
    } catch (_error) {
      return "";
    }
  }
  function asObjectRecord(value) {
    return value && typeof value === "object" ? value : null;
  }
  function getLookupProfileRecord(payload) {
    return asObjectRecord(payload.profile) ?? payload;
  }
  function getLookupOwnerProfileRecord(value) {
    return asObjectRecord(value.owner_profile) ?? asObjectRecord(value.ownerProfile);
  }
  function resolveLookupUsername(payload, fallbackUsername = "") {
    const profileRecord = getLookupProfileRecord(payload);
    const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
    return pickFirstString2([
      profileRecord.username,
      profileRecord.user_name,
      profileRecord.userName,
      profileRecord.handle,
      payload.username,
      payload.user_name,
      payload.userName,
      payload.handle,
      ownerProfileRecord?.username,
      ownerProfileRecord?.user_name,
      ownerProfileRecord?.userName,
      ownerProfileRecord?.handle,
      fallbackUsername
    ]);
  }
  function resolveLookupUserId(payload) {
    const profileRecord = getLookupProfileRecord(payload);
    const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
    const candidates = [
      profileRecord.user_id,
      profileRecord.userId,
      payload.user_id,
      payload.userId,
      profileRecord.owner_user_id,
      profileRecord.ownerUserId,
      payload.owner_user_id,
      payload.ownerUserId,
      ownerProfileRecord?.user_id,
      ownerProfileRecord?.userId
    ].map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean);
    return candidates.find((value) => isUserAccountId(value)) ?? "";
  }
  function resolveLookupCharacterId(payload) {
    const profileRecord = getLookupProfileRecord(payload);
    const characterRecord = asObjectRecord(profileRecord.character) ?? asObjectRecord(payload.character);
    const candidates = [
      profileRecord.character_user_id,
      profileRecord.characterUserId,
      payload.character_user_id,
      payload.characterUserId,
      profileRecord.profile_id,
      profileRecord.profileId,
      profileRecord.id,
      payload.profile_id,
      payload.profileId,
      payload.id,
      profileRecord.user_id,
      profileRecord.userId,
      payload.user_id,
      payload.userId,
      characterRecord?.character_user_id,
      characterRecord?.characterUserId,
      characterRecord?.profile_id,
      characterRecord?.profileId,
      characterRecord?.id,
      characterRecord?.user_id,
      characterRecord?.userId
    ].map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean);
    return candidates.find((value) => value.startsWith("ch_")) ?? "";
  }
  async function resolveCharacterIdFromAppearancesProbe(username) {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      return "";
    }
    const cachedCharacterId = characterIdByUsernameCache.get(normalizedUsername);
    if (cachedCharacterId) {
      return cachedCharacterId;
    }
    try {
      const payload = await fetchJson(
        buildUrl(`/backend/project_y/profile_feed/username/${encodeURIComponent(username)}`, {
          limit: "1",
          cut: "appearances"
        }).toString()
      );
      const rows = getPostListingRows(payload);
      const resolvedCharacterId = resolveCharacterIdFromAppearanceRows(rows, normalizedUsername);
      if (resolvedCharacterId) {
        characterIdByUsernameCache.set(normalizedUsername, resolvedCharacterId);
        return resolvedCharacterId;
      }
    } catch (_error) {
      return "";
    }
    return "";
  }
  function resolveCharacterIdFromAppearanceRows(rows, normalizedUsername) {
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const record = row;
      const directCharacterId = pickFirstString2([
        record.character_id,
        record.characterId,
        record.character_user_id,
        record.characterUserId,
        record.character_account_id,
        record.characterAccountId
      ]);
      if (directCharacterId.startsWith("ch_")) {
        return directCharacterId;
      }
      const postRecord = record.post && typeof record.post === "object" ? record.post : null;
      const cameoProfileEntries = [
        ...asUnknownArray(record.cameo_profiles),
        ...asUnknownArray(record.cameoProfiles),
        ...asUnknownArray(postRecord?.cameo_profiles),
        ...asUnknownArray(postRecord?.cameoProfiles)
      ];
      let fallbackCharacterId = "";
      for (const cameoProfileEntry of cameoProfileEntries) {
        if (!cameoProfileEntry || typeof cameoProfileEntry !== "object") {
          continue;
        }
        const cameoProfile = cameoProfileEntry;
        const cameoCharacterId = pickFirstString2([cameoProfile.user_id, cameoProfile.userId]);
        if (!cameoCharacterId.startsWith("ch_")) {
          continue;
        }
        const cameoUsername = pickFirstString2([
          cameoProfile.username,
          cameoProfile.user_name,
          cameoProfile.userName,
          cameoProfile.handle
        ]).toLowerCase();
        if (cameoUsername && cameoUsername === normalizedUsername) {
          return cameoCharacterId;
        }
        if (!fallbackCharacterId) {
          fallbackCharacterId = cameoCharacterId;
        }
      }
      if (fallbackCharacterId) {
        return fallbackCharacterId;
      }
    }
    return "";
  }
  function isUserAccountId(value) {
    return value.startsWith("user_") || value.startsWith("user-");
  }
  function enrichDraftRows(rows, knownResolutionEntries, source) {
    const knownResolutionMap = new Map(knownResolutionEntries.map((entry) => [entry.generation_id, entry.video_id]));
    for (const [rowIndex, row] of rows.entries()) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const record = row;
      const generationId = extractDraftGenerationId(record);
      if (!generationId) {
        continue;
      }
      const draftKind = getDraftKind(record);
      logDraftResolutionStep("Start gen_* -> s_* resolution", {
        source,
        row_index: rowIndex,
        generation_id: generationId,
        kind: draftKind,
        has_post: Boolean(record.post)
      });
      const draftRecord = record.draft && typeof record.draft === "object" ? record.draft : record;
      const postVideoId = resolveSharedVideoIdFromValue(record.post ?? null);
      if (postVideoId) {
        logDraftResolutionStep("Resolved from row.post", {
          source,
          generation_id: generationId,
          video_id: postVideoId
        });
        const metadata = extractResolvedDraftMetadataFromValue(record.post, postVideoId);
        applyResolvedDraftReference(record, draftRecord, {
          video_id: postVideoId,
          share_url: `${SORA_ORIGIN}/p/${postVideoId}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        });
        continue;
      }
      const cachedVideoId = knownResolutionMap.get(generationId);
      if (cachedVideoId) {
        logDraftResolutionStep("Resolved from in-memory draft cache", {
          source,
          generation_id: generationId,
          video_id: cachedVideoId
        });
        const metadata = extractResolvedDraftMetadataFromValue(record, cachedVideoId);
        applyResolvedDraftReference(record, draftRecord, {
          video_id: cachedVideoId,
          share_url: `${SORA_ORIGIN}/p/${cachedVideoId}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        });
        continue;
      }
      const directVideoId = resolveExistingDraftVideoId2(record);
      if (directVideoId) {
        logDraftResolutionStep("Resolved from existing row payload", {
          source,
          generation_id: generationId,
          video_id: directVideoId
        });
        const metadata = extractResolvedDraftMetadataFromValue(record, directVideoId);
        applyResolvedDraftReference(record, draftRecord, {
          video_id: directVideoId,
          share_url: `${SORA_ORIGIN}/p/${directVideoId}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        });
        continue;
      }
      const canCreateSharedReference = !record.post && isShareableDraftKind(getDraftKind(record)) && (source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts");
      if (!canCreateSharedReference) {
        const skipReasons = [];
        if (record.post) {
          skipReasons.push("post_present_without_resolved_video_id");
        }
        if (!isShareableDraftKind(draftKind)) {
          skipReasons.push(`unsupported_kind:${draftKind || "unknown"}`);
        }
        if (!(source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts")) {
          skipReasons.push(`unsupported_source:${source}`);
        }
        logDraftResolutionStep("Skipped share creation path", {
          source,
          generation_id: generationId,
          reasons: skipReasons
        });
      }
      if (canCreateSharedReference) {
        logDraftResolutionStep("Deferring share creation to app recovery stage", {
          source,
          generation_id: generationId
        });
      }
    }
    return rows;
  }
  function applyResolvedDraftReference(rowRecord, draftRecord, reference) {
    rowRecord.resolved_video_id = reference.video_id;
    rowRecord.resolvedVideoId = reference.video_id;
    rowRecord.resolved_share_url = reference.share_url;
    rowRecord.resolvedShareUrl = reference.share_url;
    draftRecord.resolved_video_id = reference.video_id;
    draftRecord.resolvedVideoId = reference.video_id;
    draftRecord.resolved_share_url = reference.share_url;
    draftRecord.resolvedShareUrl = reference.share_url;
    if (reference.playback_url) {
      ensureResolvedDownloadUrls(rowRecord, reference);
      ensureResolvedDownloadUrls(draftRecord, reference);
      rowRecord.resolved_playback_url = reference.playback_url;
      rowRecord.resolvedPlaybackUrl = reference.playback_url;
      draftRecord.resolved_playback_url = reference.playback_url;
      draftRecord.resolvedPlaybackUrl = reference.playback_url;
      if (!pickFirstString2([draftRecord.downloadable_url, draftRecord.downloadableUrl])) {
        draftRecord.downloadable_url = reference.playback_url;
        draftRecord.downloadableUrl = reference.playback_url;
      }
    }
    if (reference.download_url) {
      rowRecord.resolved_download_url = reference.download_url;
      rowRecord.resolvedDownloadUrl = reference.download_url;
      draftRecord.resolved_download_url = reference.download_url;
      draftRecord.resolvedDownloadUrl = reference.download_url;
    }
    if (typeof reference.estimated_size_bytes === "number" && Number.isFinite(reference.estimated_size_bytes)) {
      rowRecord.resolved_estimated_size_bytes = reference.estimated_size_bytes;
      rowRecord.resolvedEstimatedSizeBytes = reference.estimated_size_bytes;
      draftRecord.resolved_estimated_size_bytes = reference.estimated_size_bytes;
      draftRecord.resolvedEstimatedSizeBytes = reference.estimated_size_bytes;
    }
    if (reference.thumbnail_url) {
      rowRecord.resolved_thumbnail_url = reference.thumbnail_url;
      rowRecord.resolvedThumbnailUrl = reference.thumbnail_url;
      draftRecord.resolved_thumbnail_url = reference.thumbnail_url;
      draftRecord.resolvedThumbnailUrl = reference.thumbnail_url;
    }
  }
  function ensureResolvedDownloadUrls(target, reference) {
    const currentDownloadUrls = target.download_urls && typeof target.download_urls === "object" ? target.download_urls : {};
    target.download_urls = {
      ...currentDownloadUrls,
      watermark: reference.playback_url,
      no_watermark: reference.download_url || currentDownloadUrls.no_watermark || null
    };
    const currentDownloadUrlsCamel = target.downloadUrls && typeof target.downloadUrls === "object" ? target.downloadUrls : {};
    target.downloadUrls = {
      ...currentDownloadUrlsCamel,
      watermark: reference.playback_url,
      no_watermark: reference.download_url || currentDownloadUrlsCamel.no_watermark || null
    };
  }
  function isShareableDraftKind(kind) {
    const normalizedKind = kind.trim().toLowerCase();
    return normalizedKind === "sora_draft" || normalizedKind === "draft";
  }
  async function resolveDraftReference(request) {
    logDraftResolutionStep("resolve-draft-reference request received", {
      generation_id: request.generation_id
    });
    const rowPayload = request.row_payload && typeof request.row_payload === "object" ? request.row_payload : {};
    const workingRow = {
      ...rowPayload,
      generation_id: rowPayload.generation_id ?? rowPayload.generationId ?? request.generation_id,
      detail_url: rowPayload.detail_url ?? rowPayload.detailUrl ?? request.detail_url
    };
    if (shouldSkipDraftRow(workingRow)) {
      const skipReason2 = classifyDraftSkipReason(workingRow);
      logDraftResolutionStep("resolve-draft-reference skipped", {
        generation_id: request.generation_id,
        skip_reason: skipReason2,
        kind: getDraftKind(workingRow)
      });
      return {
        generation_id: request.generation_id,
        video_id: "",
        share_url: "",
        playback_url: "",
        download_url: "",
        thumbnail_url: "",
        estimated_size_bytes: null,
        skip_reason: skipReason2
      };
    }
    let createdReference = null;
    let skipReason = "unresolved_draft_video_id";
    try {
      createdReference = await createSharedDraftReference(workingRow, request.generation_id);
    } catch (error) {
      const errorMessage = getUnknownErrorMessage(error);
      skipReason = isDraftShareRateLimitErrorMessage(errorMessage) ? "share_rate_limited" : "unresolved_draft_video_id";
      logDraftResolutionStep("resolve-draft-reference failed", {
        generation_id: request.generation_id,
        error: errorMessage,
        skip_reason: skipReason
      });
    }
    logDraftResolutionStep("resolve-draft-reference completed", {
      generation_id: request.generation_id,
      resolved_video_id: createdReference?.video_id ?? "",
      skip_reason: createdReference?.video_id ? "" : skipReason
    });
    return {
      generation_id: request.generation_id,
      video_id: createdReference?.video_id ?? "",
      share_url: createdReference?.share_url ?? "",
      playback_url: createdReference?.playback_url ?? "",
      download_url: createdReference?.download_url ?? "",
      thumbnail_url: createdReference?.thumbnail_url ?? "",
      estimated_size_bytes: createdReference?.estimated_size_bytes ?? null,
      skip_reason: createdReference?.video_id ? "" : skipReason
    };
  }
  async function buildFetchEndpointCandidates(request, cursor, offset, limit) {
    if (request.source === "profile") {
      return [{ key: "profile-feed", url: buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "nf2", cursor }).toString() }];
    }
    if (request.source === "drafts") {
      return [{ key: "drafts-v2", url: buildUrl("/backend/project_y/profile/drafts/v2", { limit, cursor, offset }).toString() }];
    }
    if (request.source === "likes") {
      const viewerUserId = await deriveViewerUserId();
      const includeOffset = !cursor;
      return [{
        key: "likes",
        url: buildUrl(
          `/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/likes`,
          includeOffset ? { limit, cursor, offset } : { limit, cursor }
        ).toString()
      }];
    }
    if (request.source === "characters") {
      return [{ key: "viewer-appearances", url: buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "appearances", cursor }).toString() }];
    }
    if (request.source === "characterDrafts") {
      return [{ key: "viewer-character-drafts", url: buildUrl("/backend/project_y/profile/drafts/cameos", { limit, cursor }).toString() }];
    }
    if (request.source === "characterProfiles") {
      const viewerUserId = await deriveViewerUserId();
      return [{
        key: "character-profiles",
        url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, { limit, cursor }).toString()
      }];
    }
    if (request.source === "characterAccountAppearances" || request.source === "sideCharacter") {
      const resolvedCharacterId = await resolveCharacterAccountId(
        request.character_id ?? "",
        request.route_url ?? "",
        request.creator_username ?? ""
      );
      const encodedCharacterId = encodeURIComponent(resolvedCharacterId);
      const endpointKey = request.source === "sideCharacter" ? "side-character-feed-appearances" : "character-feed-appearances";
      return [{
        key: endpointKey,
        url: buildUrl(`/backend/project_y/profile_feed/${encodedCharacterId}`, { limit, cut: "appearances", cursor }).toString()
      }];
    }
    if (request.source === "characterAccountDrafts") {
      const resolvedCharacterId = await resolveCharacterAccountId(
        request.character_id ?? "",
        request.route_url ?? "",
        request.creator_username ?? ""
      );
      const encodedCharacterId = encodeURIComponent(resolvedCharacterId);
      return [
        {
          key: "character-account-drafts",
          optional: true,
          url: buildUrl(`/backend/project_y/profile/drafts/cameos/character/${encodedCharacterId}`, {
            limit,
            cursor
          }).toString()
        },
        {
          key: "character-post-listing-drafts",
          optional: true,
          url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/drafts`, { limit, cursor }).toString()
        }
      ];
    }
    if (request.source === "creatorPublished") {
      const creatorTarget = await resolveCreatorTarget(
        request.creator_user_id ?? "",
        request.route_url ?? "",
        request.creator_username ?? ""
      );
      const endpointCandidates = [];
      creatorTarget.identifiers.forEach((identifier, index) => {
        const suffix = index === 0 ? "" : `-alt${index}`;
        const encodedIdentifier = encodeURIComponent(identifier);
        endpointCandidates.push(
          {
            key: `creator-post-listing-published${suffix}`,
            url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/published`, { limit, cursor }).toString()
          },
          {
            key: `creator-post-listing-profile${suffix}`,
            url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/profile`, { limit, cursor }).toString()
          },
          {
            key: `creator-post-listing-public${suffix}`,
            url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/public`, { limit, cursor }).toString()
          },
          {
            key: `creator-post-listing-posts${suffix}`,
            url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/posts`, { limit, cursor }).toString()
          },
          {
            key: `creator-feed-nf2${suffix}`,
            url: buildUrl(`/backend/project_y/profile_feed/${encodedIdentifier}`, { limit, cut: "nf2", cursor }).toString()
          }
        );
      });
      if (creatorTarget.username) {
        const encodedUsername = encodeURIComponent(creatorTarget.username);
        endpointCandidates.push(
          {
            key: "creator-post-listing-posts-username",
            url: buildUrl(`/backend/project_y/profile/username/${encodedUsername}/post_listing/posts`, { limit, cursor }).toString()
          },
          {
            key: "creator-post-listing-profile-username",
            url: buildUrl(`/backend/project_y/profile/username/${encodedUsername}/post_listing/profile`, { limit, cursor }).toString()
          }
        );
      }
      return endpointCandidates;
    }
    if (request.source === "creatorCameos") {
      const creatorTarget = await resolveCreatorTarget(
        request.creator_user_id ?? "",
        request.route_url ?? "",
        request.creator_username ?? ""
      );
      const orderedIdentifiers = [
        creatorTarget.userId,
        request.creator_user_id ?? "",
        ...creatorTarget.identifiers
      ].map((value) => value.trim()).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
      const candidates = orderedIdentifiers.map((identifier, index) => ({
        key: index === 0 ? "creator-appearances" : `creator-appearances-alt${index}`,
        url: buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(identifier)}`, { limit, cut: "appearances", cursor }).toString()
      }));
      if (creatorTarget.username) {
        candidates.push({
          key: "creator-appearances-username",
          url: buildUrl(`/backend/project_y/profile_feed/username/${encodeURIComponent(creatorTarget.username)}`, {
            limit,
            cut: "appearances",
            cursor
          }).toString()
        });
      }
      return candidates.filter((candidate, index, list) => list.findIndex((entry) => entry.url === candidate.url) === index);
    }
    throw new Error(`Unsupported fetch source: ${request.source}`);
  }
  async function createSharedDraftReference(row, generationId) {
    logDraftResolutionStep("createSharedDraftReference start", { generation_id: generationId });
    const existingVideoId = resolveExistingDraftVideoId2(row);
    if (existingVideoId) {
      logDraftResolutionStep("Using existing s_* id from payload", {
        generation_id: generationId,
        video_id: existingVideoId
      });
      const metadata = extractResolvedDraftMetadataFromValue(row, existingVideoId);
      return {
        video_id: existingVideoId,
        share_url: `${SORA_ORIGIN}/p/${existingVideoId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
    if (shouldSkipDraftRow(row)) {
      logDraftResolutionStep("Skipping draft due to blocked kind", {
        generation_id: generationId,
        skip_reason: classifyDraftSkipReason(row),
        kind: getDraftKind(row)
      });
      return null;
    }
    const detailUrl = resolveDraftDetailUrl(row, generationId);
    if (detailUrl) {
      logDraftResolutionStep("Attempting detail JSON resolution", {
        generation_id: generationId,
        detail_url: detailUrl
      });
      const detailPayload = await fetchJson(detailUrl).catch(() => null);
      if (detailPayload) {
        const recoveredFromPayload = resolveSharedVideoIdFromValue(detailPayload);
        if (recoveredFromPayload) {
          logDraftResolutionStep("Resolved from detail JSON payload", {
            generation_id: generationId,
            video_id: recoveredFromPayload
          });
          const metadata = extractResolvedDraftMetadataFromValue(detailPayload, recoveredFromPayload);
          return {
            video_id: recoveredFromPayload,
            share_url: `${SORA_ORIGIN}/p/${recoveredFromPayload}`,
            playback_url: metadata.playback_url,
            download_url: metadata.download_url,
            estimated_size_bytes: metadata.estimated_size_bytes,
            thumbnail_url: metadata.thumbnail_url
          };
        }
        logDraftResolutionStep("Detail JSON did not include s_* id", {
          generation_id: generationId
        });
      }
      logDraftResolutionStep("Attempting detail HTML resolution", {
        generation_id: generationId,
        detail_url: detailUrl
      });
      const detailHtml = await fetchText(detailUrl).catch(() => "");
      const recoveredId = extractSharedVideoId(detailHtml);
      if (recoveredId) {
        logDraftResolutionStep("Resolved from detail HTML", {
          generation_id: generationId,
          video_id: recoveredId
        });
        const metadata = extractResolvedDraftMetadataFromValue(row, recoveredId);
        return {
          video_id: recoveredId,
          share_url: `${SORA_ORIGIN}/p/${recoveredId}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        };
      }
      logDraftResolutionStep("Detail HTML did not include s_* id", {
        generation_id: generationId
      });
    }
    try {
      logDraftResolutionStep("Attempting share-link POST /backend/project_y/post", {
        generation_id: generationId
      });
      const response = await fetchJsonWithMethod("/backend/project_y/post", "POST", {
        attachments_to_create: [{ generation_id: generationId, kind: "sora" }],
        post_text: resolveDraftShareText(row),
        destinations: [{ type: "shared_link_unlisted" }]
      });
      const videoId = resolveSharedVideoIdFromValue(response);
      if (videoId) {
        logDraftResolutionStep("Resolved from share-link POST response", {
          generation_id: generationId,
          video_id: videoId
        });
        const metadata = extractResolvedDraftMetadataFromValue(response, videoId);
        return {
          video_id: videoId,
          share_url: `${SORA_ORIGIN}/p/${videoId}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        };
      }
      logDraftResolutionStep("Share-link POST response missing s_* id", {
        generation_id: generationId
      });
    } catch (error) {
      const errorMessage = getUnknownErrorMessage(error);
      logDraftResolutionStep("Share-link POST failed", {
        generation_id: generationId,
        error: errorMessage
      });
      if (isDraftShareRateLimitErrorMessage(errorMessage)) {
        throw error;
      }
    }
    logDraftResolutionStep("Resolution failed; leaving draft unresolved", {
      generation_id: generationId
    });
    return null;
  }
  async function fetchJsonWithMethod(url, method, jsonBody) {
    const auth = await Promise.resolve().then(() => (init_auth(), auth_exports)).then((module) => module.deriveAuthContext());
    const requestUrl = new URL(url, SORA_ORIGIN).toString();
    const generationId = resolveShareRequestGenerationId(jsonBody);
    const headers = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
      "oai-language": auth.language,
      ...auth.deviceId ? { "oai-device-id": auth.deviceId } : {}
    };
    for (let attempt = 0; attempt < DRAFT_SHARE_POST_MAX_ATTEMPTS; attempt += 1) {
      logDraftResolutionStep("Share POST attempt", {
        generation_id: generationId,
        request_url: requestUrl,
        attempt: attempt + 1
      });
      const response = await fetch(requestUrl, {
        method,
        credentials: "include",
        headers,
        body: JSON.stringify(jsonBody)
      });
      if (response.ok) {
        logDraftResolutionStep("Share POST success", {
          generation_id: generationId,
          status: response.status,
          attempt: attempt + 1
        });
        return response.json();
      }
      if (response.status === 429) {
        logDraftResolutionStep("Share POST rate-limited", {
          generation_id: generationId,
          status: response.status,
          attempt: attempt + 1
        });
        throw new Error(`Draft share creation failed with status ${response.status}. Request: POST /backend/project_y/post.`);
      }
      const isLastAttempt = attempt >= DRAFT_SHARE_POST_MAX_ATTEMPTS - 1;
      if (!isRetriableSoraStatus(response.status)) {
        logDraftResolutionStep("Share POST non-retriable failure", {
          generation_id: generationId,
          status: response.status,
          attempt: attempt + 1
        });
        throw new Error(`Draft share creation failed with status ${response.status}. Request: POST /backend/project_y/post.`);
      }
      if (isLastAttempt) {
        logDraftResolutionStep("Share POST retries exhausted", {
          generation_id: generationId,
          status: response.status,
          attempt: attempt + 1
        });
        throw new Error(`Draft share creation failed with status ${response.status}. Request: POST /backend/project_y/post.`);
      }
      const retryDelayMs = resolveDraftShareRetryDelayMs(attempt);
      logDraftResolutionStep("Share POST retriable failure", {
        generation_id: generationId,
        status: response.status,
        attempt: attempt + 1,
        retry_delay_ms: retryDelayMs
      });
      await sleepWithJitter(retryDelayMs);
    }
    throw new Error("Draft share creation failed after retry budget. Request: POST /backend/project_y/post.");
  }
  function resolveShareRequestGenerationId(jsonBody) {
    if (!jsonBody || typeof jsonBody !== "object") {
      return "";
    }
    const record = jsonBody;
    const attachments = Array.isArray(record.attachments_to_create) ? record.attachments_to_create : [];
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== "object") {
        continue;
      }
      const generationId = pickFirstString2([
        attachment.generation_id,
        attachment.generationId
      ]);
      if (generationId) {
        return generationId;
      }
    }
    return "";
  }
  function resolveDraftShareText(row) {
    const draftRecord = row.draft && typeof row.draft === "object" ? row.draft : null;
    return pickFirstString2([
      row.discovery_phrase,
      row.discoveryPhrase,
      row.prompt,
      row.caption,
      row.description,
      draftRecord?.discovery_phrase,
      draftRecord?.discoveryPhrase,
      draftRecord?.prompt,
      draftRecord?.caption,
      draftRecord?.description
    ]);
  }
  function resolveExistingDraftVideoId2(row) {
    return resolveExistingDraftVideoId(row);
  }
  function extractResolvedDraftMetadataFromValue(value, videoId) {
    if (!value || typeof value !== "object") {
      return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "", download_url: "" };
    }
    const resolveFromRecord = (record) => ({
      estimated_size_bytes: extractEstimatedSizeBytesFromAnyRecord(record),
      thumbnail_url: extractThumbnailUrlFromAnyRecord(record),
      playback_url: extractPlaybackUrlFromAnyRecord(record),
      download_url: extractDownloadUrlFromAnyRecord(record)
    });
    const directRecord = value;
    const directSize = extractEstimatedSizeBytesFromAnyRecord(directRecord);
    const directThumbnail = extractThumbnailUrlFromAnyRecord(directRecord);
    const directPlayback = extractPlaybackUrlFromAnyRecord(directRecord);
    const directDownload = extractDownloadUrlFromAnyRecord(directRecord);
    if ((directSize != null || directThumbnail || directPlayback || directDownload) && resolveSharedVideoIdFromValue(value) === videoId) {
      return {
        estimated_size_bytes: directSize,
        thumbnail_url: directThumbnail,
        playback_url: directPlayback,
        download_url: directDownload
      };
    }
    const rows = getPostListingRows(value);
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      if (resolveSharedVideoIdFromValue(row) !== videoId) {
        continue;
      }
      return resolveFromRecord(row);
    }
    return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "", download_url: "" };
  }
  function shouldSkipDraftRow(row) {
    if (!row || typeof row !== "object") {
      return true;
    }
    const kind = getDraftKind(row).trim().toLowerCase();
    return kind === "sora_error" || kind === "sora_content_violation";
  }
  function classifyDraftSkipReason(row) {
    const kind = getDraftKind(row).trim().toLowerCase();
    if (kind === "sora_error") {
      return "draft_error";
    }
    if (kind === "sora_content_violation") {
      return "draft_content_violation";
    }
    return "unresolved_draft_video_id";
  }
  function resolveDraftDetailUrl(row, generationId) {
    const directUrl = typeof row.detail_url === "string" ? row.detail_url : typeof row.detailUrl === "string" ? row.detailUrl : typeof row.url === "string" ? row.url : "";
    if (directUrl) {
      return directUrl;
    }
    return `${SORA_ORIGIN}/d/${generationId}`;
  }
  function buildUrl(pathname, params) {
    const url = new URL(pathname, SORA_ORIGIN);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    return url;
  }
  function sleepWithJitter(durationMs) {
    const jitterMs = Math.floor(Math.random() * 150);
    return new Promise((resolve) => setTimeout(resolve, durationMs + jitterMs));
  }
  function resolveDraftShareRetryDelayMs(attempt) {
    const exponential = Math.min(
      DRAFT_SHARE_POST_MAX_RETRY_DELAY_MS,
      DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS * Math.pow(2, Math.min(8, attempt))
    );
    return Math.max(DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS, exponential);
  }
  function isDraftShareRateLimitErrorMessage(message) {
    const normalizedMessage = message.toLowerCase();
    return normalizedMessage.includes("draft share") && normalizedMessage.includes("status 429") && normalizedMessage.includes("/backend/project_y/post");
  }
  function getUnknownErrorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    return "Unknown error";
  }
  function asUnknownArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function isDraftSource(source) {
    return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
  }
  function shouldFinishFetchPage(_source, _pageRowCount, nextCursor, hasMoreRows) {
    if (_source === "drafts" || _source === "likes") {
      return !nextCursor && !hasMoreRows;
    }
    return !nextCursor;
  }
  function getFetchLimitForSource(_source, requestedLimit = 100) {
    return requestedLimit;
  }
  function shouldUseOffsetPagination(source, endpointKey) {
    if (source === "drafts") {
      return true;
    }
    return source === "likes" && endpointKey === "likes";
  }
  function buildFetchBatchAttemptFailureMessage(request, failures) {
    if (failures.length === 0) {
      return `Sora fetch-batch failed for source=${request.source} with no successful endpoint candidates.`;
    }
    const summary = failures.map((failure) => {
      const statusLabel = typeof failure.status === "number" ? `status ${failure.status}` : "unknown status";
      return `${failure.key} (${statusLabel}) ${failure.request}`;
    }).join(" | ");
    return `Sora fetch-batch failed for source=${request.source}. Attempts: ${summary}`;
  }
  function describeRequestFromCandidateUrl(candidateUrl) {
    try {
      const url = new URL(candidateUrl);
      const filteredParams = new URLSearchParams();
      const includeParam = (key) => {
        const value = url.searchParams.get(key);
        if (!value) {
          return;
        }
        filteredParams.set(key, value.length > 48 ? `${value.slice(0, 48)}...` : value);
      };
      includeParam("cut");
      includeParam("limit");
      includeParam("cursor");
      includeParam("offset");
      const query = filteredParams.toString();
      return `GET ${url.pathname}${query ? `?${query}` : ""}`;
    } catch (_error) {
      return `GET ${candidateUrl}`;
    }
  }
  function extractStatusFromErrorMessage(message) {
    const match = message.match(/status\s+(\d{3})/i);
    if (!match) {
      return null;
    }
    const status = Number(match[1]);
    return Number.isFinite(status) ? status : null;
  }

  // injected/content-script.ts
  var listenerAttached = false;
  if (!listenerAttached) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) {
        return false;
      }
      if (message.type === "ping") {
        sendResponse({ ok: true, payload: { ready: true } });
        return false;
      }
      if (message.type !== "run-source-request") {
        return false;
      }
      void runSourceRequest(message.payload).then((payload) => sendResponse({ ok: true, payload })).catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return true;
    });
    listenerAttached = true;
  }
})();
