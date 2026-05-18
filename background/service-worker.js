// injected/lib/origins.ts
var CHATGPT_ORIGIN = "https://chatgpt.com";
var CHATGPT_WORKER_URL = `${CHATGPT_ORIGIN}/?save-sora-worker=1`;
var SORA_ORIGIN = "https://sora.chatgpt.com";

// background/hidden-tab-pool.ts
var WORKER_BOOTSTRAP_HASH = "save-sora-worker";
var WORKER_BOOTSTRAP_URL = `${SORA_ORIGIN}/profile#${WORKER_BOOTSTRAP_HASH}`;
var WORKER_LOAD_TIMEOUT_MS = 2e4;
var WORKER_PREPARE_RETRY_LIMIT = 2;
var WORKER_IDLE_EVICTION_MS = 1e4;
var WORKER_TRACKING_KEY = "saveSoraHiddenWorkers";
var WORKER_WINDOW_WIDTH = 420;
var WORKER_WINDOW_HEIGHT = 760;
var WORKER_WINDOW_LEFT = -1e4;
var WORKER_WINDOW_TOP = 0;
var HiddenTabPool = class {
  constructor(maxWorkers) {
    this.maxWorkers = maxWorkers;
  }
  workers = [];
  idleDisposalTimers = /* @__PURE__ */ new Map();
  queue = [];
  async run(task) {
    let lastError = null;
    for (let attempt = 0; attempt < WORKER_PREPARE_RETRY_LIMIT; attempt += 1) {
      const worker = await this.acquireWorker();
      let shouldDisposeWorker = false;
      try {
        await ensureWorkerReady(worker);
        return await task(worker.tabId);
      } catch (error) {
        lastError = error;
        shouldDisposeWorker = shouldRetryWorkerTask(error);
        if (!shouldDisposeWorker) {
          throw error;
        }
      } finally {
        if (shouldDisposeWorker) {
          await this.disposeWorker(worker);
        } else {
          this.releaseWorker(worker);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Unknown worker failure.");
  }
  async acquireWorker() {
    while (true) {
      await this.reconcileWorkers();
      const availableWorker = this.workers.find((worker) => !worker.busy);
      if (availableWorker) {
        this.clearIdleDisposalTimer(availableWorker.tabId);
        availableWorker.busy = true;
        return availableWorker;
      }
      if (this.workers.length < this.maxWorkers) {
        const worker = await createDedicatedWorker();
        worker.busy = true;
        this.workers.push(worker);
        await this.persistTrackedWorkers();
        return worker;
      }
      await new Promise((resolve) => this.queue.push(resolve));
    }
  }
  releaseWorker(worker) {
    worker.busy = false;
    this.scheduleIdleDisposal(worker);
    this.queue.shift()?.();
  }
  async disposeAllWorkers() {
    const workersToDispose = [...this.workers];
    await Promise.all(workersToDispose.map((worker) => this.disposeWorker(worker, true)));
  }
  async disposeWorker(worker, force = false) {
    if (worker.busy && !force) {
      return;
    }
    this.clearIdleDisposalTimer(worker.tabId);
    const workerIndex = this.workers.findIndex((candidate) => candidate.tabId === worker.tabId);
    if (workerIndex >= 0) {
      this.workers.splice(workerIndex, 1);
    }
    worker.busy = false;
    worker.injected = false;
    if (typeof worker.windowId === "number") {
      try {
        const workerWindow = await chrome.windows.get(worker.windowId, { populate: true });
        const tabs = workerWindow.tabs ?? [];
        const hasWorkerTab = tabs.some((tab) => tab.id === worker.tabId);
        const onlyReusableSoraTabs = tabs.length > 0 && tabs.every((tab) => isReusableSoraWorkerTabUrl(tab.url));
        if (workerWindow.type === "popup" && hasWorkerTab && onlyReusableSoraTabs) {
          await chrome.windows.remove(worker.windowId);
          await this.persistTrackedWorkers();
          this.queue.shift()?.();
          return;
        }
      } catch (_error) {
      }
    }
    try {
      await chrome.tabs.remove(worker.tabId);
    } catch (_error) {
    } finally {
      await this.persistTrackedWorkers();
      this.queue.shift()?.();
    }
  }
  async reconcileWorkers() {
    for (let index = this.workers.length - 1; index >= 0; index -= 1) {
      const worker = this.workers[index];
      try {
        const tab = await chrome.tabs.get(worker.tabId);
        if (!worker.busy && !isReusableSoraWorkerTabUrl(tab.url)) {
          await this.disposeWorker(worker, true);
        }
      } catch (_error) {
        if (!worker.busy) {
          await this.disposeWorker(worker, true);
        }
      }
    }
  }
  scheduleIdleDisposal(worker) {
    this.clearIdleDisposalTimer(worker.tabId);
    const timeout = setTimeout(() => {
      void this.disposeWorker(worker);
    }, WORKER_IDLE_EVICTION_MS);
    this.idleDisposalTimers.set(worker.tabId, timeout);
  }
  clearIdleDisposalTimer(tabId) {
    const timeout = this.idleDisposalTimers.get(tabId);
    if (timeout) {
      clearTimeout(timeout);
      this.idleDisposalTimers.delete(tabId);
    }
  }
  async persistTrackedWorkers() {
    const trackedWorkers = {
      tab_ids: this.workers.map((worker) => worker.tabId),
      window_ids: this.workers.map((worker) => worker.windowId).filter((windowId) => typeof windowId === "number")
    };
    await chrome.storage.session.set({ [WORKER_TRACKING_KEY]: trackedWorkers }).catch(() => void 0);
  }
};
function shouldRetryWorkerTask(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist/i.test(message) || /No tab with id/i.test(message) || /message channel closed before a response was received/i.test(message) || /message channel is closed/i.test(message) || /back\/forward cache/i.test(message) || /bfcache/i.test(message) || /The message port closed before a response was received/i.test(message) || /Could not derive a Sora bearer token/i.test(message) || /Could not derive the signed-in Sora viewer id/i.test(message) || /Missing bearer authentication/i.test(message) || /Frame with ID 0 is showing error page/i.test(message) || /Cannot access contents of url/i.test(message) || /hidden Sora worker tab was closed before it finished loading/i.test(message) || /Timed out waiting for the hidden Sora worker tab to finish loading/i.test(message);
}
async function createDedicatedWorker() {
  let workerTab = null;
  let workerWindowId = null;
  try {
    const workerWindow = await chrome.windows.create({
      focused: false,
      height: WORKER_WINDOW_HEIGHT,
      left: WORKER_WINDOW_LEFT,
      top: WORKER_WINDOW_TOP,
      type: "popup",
      url: WORKER_BOOTSTRAP_URL,
      width: WORKER_WINDOW_WIDTH
    });
    workerWindowId = typeof workerWindow.id === "number" ? workerWindow.id : null;
    workerTab = workerWindow.tabs?.find((tab) => typeof tab.id === "number") ?? null;
    if (workerWindowId !== null) {
      await chrome.windows.update(workerWindowId, { focused: false, state: "minimized" }).catch(() => void 0);
    }
  } catch (_error) {
    workerWindowId = null;
    workerTab = null;
  }
  if (!workerTab?.id) {
    const fallbackTab = await chrome.tabs.create({
      active: false,
      pinned: false,
      url: WORKER_BOOTSTRAP_URL
    });
    workerTab = fallbackTab;
  }
  if (!workerTab.id) {
    throw new Error("Could not create a dedicated Sora worker tab.");
  }
  await waitForTabComplete(workerTab.id);
  await chrome.tabs.update(workerTab.id, { active: false, autoDiscardable: false, pinned: false }).catch(() => void 0);
  return {
    busy: false,
    injected: false,
    tabId: workerTab.id,
    windowId: workerWindowId
  };
}
async function ensureWorkerReady(worker) {
  for (let attempt = 0; attempt < WORKER_PREPARE_RETRY_LIMIT; attempt += 1) {
    const currentTab = await chrome.tabs.get(worker.tabId);
    if (!isReusableSoraWorkerTabUrl(currentTab.url) || currentTab.status !== "complete") {
      await chrome.tabs.update(worker.tabId, { active: false, url: WORKER_BOOTSTRAP_URL });
      await waitForTabComplete(worker.tabId);
      worker.injected = false;
    }
    const readyTab = await chrome.tabs.get(worker.tabId);
    if (!isReusableSoraWorkerTabUrl(readyTab.url)) {
      throw new Error(`Worker tab failed to load a reusable Sora page: ${String(readyTab.url ?? "")}`);
    }
    try {
      if (!worker.injected) {
        await chrome.scripting.executeScript({
          target: { tabId: worker.tabId },
          files: ["injected/content-script.js"]
        });
        worker.injected = true;
      }
      await pingWorker(worker.tabId);
      return;
    } catch (error) {
      worker.injected = false;
      if (attempt + 1 >= WORKER_PREPARE_RETRY_LIMIT || !shouldRetryWorkerTask(error)) {
        throw error;
      }
      await chrome.tabs.update(worker.tabId, { active: false, url: WORKER_BOOTSTRAP_URL });
      await waitForTabComplete(worker.tabId);
    }
  }
}
async function pingWorker(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: "ping" });
  if (!response?.ok || response.payload?.ready !== true) {
    throw new Error("Worker content script is not ready.");
  }
}
function waitForTabComplete(tabId, timeoutMs = WORKER_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      reject(new Error("Timed out waiting for the hidden Sora worker tab to finish loading."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    };
    const finishIfReady = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          if (resolved) {
            return;
          }
          resolved = true;
          cleanup();
          resolve();
        }
      } catch (error) {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("The hidden Sora worker tab became unavailable."));
      }
    };
    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || resolved) {
        return;
      }
      void finishIfReady();
    };
    const handleRemoved = (removedTabId) => {
      if (removedTabId !== tabId || resolved) {
        return;
      }
      resolved = true;
      cleanup();
      reject(new Error("The hidden Sora worker tab was closed before it finished loading."));
    };
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    void finishIfReady();
  });
}
function isReusableSoraWorkerTabUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  return url === SORA_ORIGIN || url.startsWith(`${SORA_ORIGIN}/`);
}
function isWorkerBootstrapTabUrl(url) {
  if (typeof url !== "string" || !url.startsWith(`${SORA_ORIGIN}/profile`)) {
    return false;
  }
  return url.includes(`#${WORKER_BOOTSTRAP_HASH}`);
}
async function cleanupTrackedHiddenWorkers() {
  const stored = await chrome.storage.session.get(WORKER_TRACKING_KEY).catch(() => ({}));
  const storedRecord = stored;
  const tracked = storedRecord[WORKER_TRACKING_KEY];
  const windowIds = [...new Set((tracked?.window_ids ?? []).filter((windowId) => Number.isInteger(windowId)))];
  const tabIds = [...new Set((tracked?.tab_ids ?? []).filter((tabId) => Number.isInteger(tabId)))];
  for (const windowId of windowIds) {
    try {
      const workerWindow = await chrome.windows.get(windowId, { populate: true });
      const tabs = workerWindow.tabs ?? [];
      const onlyReusableSoraTabs = tabs.length > 0 && tabs.every((tab) => isReusableSoraWorkerTabUrl(tab.url));
      if (workerWindow.type === "popup" && onlyReusableSoraTabs) {
        await chrome.windows.remove(windowId);
      }
    } catch (_error) {
    }
  }
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (_error) {
    }
  }
  const allWindows = await chrome.windows.getAll({ populate: true }).catch(() => []);
  for (const chromeWindow of allWindows) {
    if (chromeWindow.type !== "popup" || typeof chromeWindow.id !== "number") {
      continue;
    }
    const tabs = chromeWindow.tabs ?? [];
    const isSoraPopupWorkerWindow = tabs.length === 1 && isWorkerBootstrapTabUrl(tabs[0]?.url);
    if (!isSoraPopupWorkerWindow) {
      continue;
    }
    try {
      await chrome.windows.remove(chromeWindow.id);
    } catch (_error) {
    }
  }
  await chrome.storage.session.remove(WORKER_TRACKING_KEY).catch(() => void 0);
}

// background/kontenai-links.ts
var SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
var SORA_SHARE_URL_PREFIX = "https://sora.chatgpt.com/p/";
var KONTENAI_LINKS_ENDPOINT_PREFIX = "https://api.dyysy.com/links20260207/";
async function resolveKontenAiLinks(video_id) {
  const videoId = video_id.trim();
  if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("resolve-kontenai-links requires a valid s_* video_id.");
  }
  const soraShareUrl = `${SORA_SHARE_URL_PREFIX}${videoId}`;
  const response = await fetch(`${KONTENAI_LINKS_ENDPOINT_PREFIX}${encodeURIComponent(soraShareUrl)}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    if (isTerminalKontenAiStatus(response.status)) {
      return null;
    }
    throw new Error(`KontenAI links endpoint failed with status ${response.status}.`);
  }
  const payload = await response.json();
  return normalizeOpenAiVideoUrl(payload.links?.mp4_source);
}
function isTerminalKontenAiStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410 || status === 422;
}
function normalizeOpenAiVideoUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "videos.openai.com" || hostname.endsWith(".videos.openai.com")) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

// background/service-worker.ts
var pool = new HiddenTabPool(3);
var APP_URL = chrome.runtime.getURL("app.html");
var startupCleanupPromise = cleanupTrackedHiddenWorkers();
chrome.action.onClicked.addListener(() => {
  void openOrFocusAppTab();
});
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  void handleRequest(request).then((response) => sendResponse(response)).catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return true;
});
chrome.runtime.onSuspend.addListener(() => {
  void pool.disposeAllWorkers();
});
async function openOrFocusAppTab() {
  const existingTabs = await chrome.tabs.query({ url: APP_URL });
  const existingTab = existingTabs[0];
  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ active: true, url: APP_URL });
}
async function handleRequest(request) {
  await startupCleanupPromise.catch(() => void 0);
  switch (request.type) {
    case "fetch-batch":
      return { ok: true, payload: await runContentScriptRequest(request) };
    case "resolve-creator-profile":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "resolve-viewer-identity":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "resolve-draft-reference":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "get-sora-watermark-task":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "get-sora-watermark-free-video":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "resolve-kontenai-links":
      return {
        ok: true,
        payload: await resolveKontenAiLinks(request.video_id)
      };
    case "fetch-character-accounts":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "fetch-detail-html":
      return {
        ok: true,
        payload: await runContentScriptRequest(request)
      };
    case "cleanup-hidden-workers":
      await pool.disposeAllWorkers();
      await cleanupTrackedHiddenWorkers();
      return {
        ok: true,
        payload: { closed: true }
      };
    default:
      throw new Error(`Unsupported background request type: ${request.type}`);
  }
}
async function runContentScriptRequest(request) {
  return pool.run(async (tabId) => {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "run-source-request",
      payload: request
    });
    if (!response) {
      throw new Error("The injected Sora fetch runtime did not return a response.");
    }
    if (!response.ok) {
      throw new Error(response.error || "The injected Sora fetch runtime returned an unknown error.");
    }
    return response.payload;
  });
}
