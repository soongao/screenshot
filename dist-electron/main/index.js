import { app, systemPreferences, ipcMain, desktopCapturer, screen, BrowserWindow, dialog, nativeImage, shell, clipboard, globalShortcut } from "electron";
import { execFile } from "node:child_process";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "../..");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;
let captureWindows = [];
let pinWindows = [];
let activeSelectionWebContentsId = null;
const execFileAsync = promisify(execFile);
const DEFAULT_APP_SETTINGS = {
  startCapture: "CommandOrControl+Shift+A",
  startOcr: "CommandOrControl+Shift+O",
  startTranslate: "CommandOrControl+Shift+T",
  forceExit: "CommandOrControl+Shift+Q",
  translationSourceLang: "auto",
  translationTargetLang: "zh",
  defaultExportFormat: "png",
  closeAfterCopy: true,
  closeAfterSave: false,
  closeAfterPin: true,
  historyLimit: 5,
  annotationColor: "#ff3b30",
  annotationStrokeWidth: 4,
  annotationFontSize: 20,
  toolbarOpacity: 0.94,
  toolbarScale: 1,
  ocrLanguages: "eng+chi_sim",
  pinWindowShadow: true,
  pinWindowOpacity: 1
};
let activeAppSettings = { ...DEFAULT_APP_SETTINGS };
const pinWindowPayloads = /* @__PURE__ */ new Map();
async function tryLibreTranslateEndpoint(url, payload) {
  var _a;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: payload.text,
      source: payload.sourceLang,
      target: payload.targetLang,
      format: "text"
    })
  });
  if (!response.ok) {
    throw new Error(`LibreTranslate endpoint failed: ${response.status}`);
  }
  const data = await response.json();
  return ((_a = data.translatedText) == null ? void 0 : _a.trim()) || "";
}
async function tryMyMemoryEndpoint(payload) {
  var _a, _b;
  const sourceLang = payload.sourceLang === "auto" ? "auto" : payload.sourceLang;
  const langpair = `${sourceLang}|${payload.targetLang}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(payload.text)}&langpair=${encodeURIComponent(langpair)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MyMemory endpoint failed: ${response.status}`);
  }
  const data = await response.json();
  return ((_b = (_a = data.responseData) == null ? void 0 : _a.translatedText) == null ? void 0 : _b.trim()) || "";
}
function resetCaptureSessionState() {
  activeSelectionWebContentsId = null;
}
function getShortcutSettingsPath() {
  return path.join(app.getPath("userData"), "shortcut-settings.json");
}
async function readShortcutSettingsFromDisk() {
  const settingsPath = getShortcutSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed
    };
  } catch {
    await writeFile(settingsPath, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2), "utf8");
    return { ...DEFAULT_APP_SETTINGS };
  }
}
async function writeShortcutSettingsToDisk(settings) {
  const settingsPath = getShortcutSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}
function validateShortcutSettings(settings) {
  const values = [
    settings.startCapture,
    settings.startOcr,
    settings.startTranslate,
    settings.forceExit
  ].map((value) => value.trim());
  if (values.some((value) => !value)) {
    return { valid: false, message: "快捷键不能为空" };
  }
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    return { valid: false, message: "快捷键不能重复，请为每个功能设置不同的组合键" };
  }
  return { valid: true };
}
function normalizeAppSettings(nextSettings) {
  return {
    startCapture: nextSettings.startCapture.trim(),
    startOcr: nextSettings.startOcr.trim(),
    startTranslate: nextSettings.startTranslate.trim(),
    forceExit: nextSettings.forceExit.trim(),
    translationSourceLang: nextSettings.translationSourceLang,
    translationTargetLang: nextSettings.translationTargetLang,
    defaultExportFormat: nextSettings.defaultExportFormat === "jpg" ? "jpg" : "png",
    closeAfterCopy: Boolean(nextSettings.closeAfterCopy),
    closeAfterSave: Boolean(nextSettings.closeAfterSave),
    closeAfterPin: Boolean(nextSettings.closeAfterPin),
    historyLimit: Math.min(200, Math.max(1, Number(nextSettings.historyLimit) || 5)),
    annotationColor: /^#([0-9a-fA-F]{6})$/.test(nextSettings.annotationColor) ? nextSettings.annotationColor : "#ff3b30",
    annotationStrokeWidth: [2, 4, 6, 8, 12].includes(Number(nextSettings.annotationStrokeWidth)) ? Number(nextSettings.annotationStrokeWidth) : 4,
    annotationFontSize: [14, 18, 20, 24, 28, 32].includes(Number(nextSettings.annotationFontSize)) ? Number(nextSettings.annotationFontSize) : 20,
    toolbarOpacity: Math.min(1, Math.max(0.7, Number(nextSettings.toolbarOpacity) || 0.94)),
    toolbarScale: [0.9, 1, 1.1, 1.2].includes(Number(nextSettings.toolbarScale)) ? Number(nextSettings.toolbarScale) : 1,
    ocrLanguages: nextSettings.ocrLanguages === "eng" || nextSettings.ocrLanguages === "chi_sim" ? nextSettings.ocrLanguages : "eng+chi_sim",
    pinWindowShadow: Boolean(nextSettings.pinWindowShadow),
    pinWindowOpacity: Math.min(1, Math.max(0.2, Number(nextSettings.pinWindowOpacity) || 1))
  };
}
function syncSelectionState(senderId, hasSelection) {
  if (hasSelection) {
    activeSelectionWebContentsId = senderId;
    return;
  }
  if (activeSelectionWebContentsId === senderId) {
    activeSelectionWebContentsId = null;
  }
}
function clearSelectionsExcept(sender) {
  captureWindows.forEach((win) => {
    if (win.isDestroyed()) {
      return;
    }
    if (sender && win.webContents === sender) {
      return;
    }
    win.webContents.send("capture-clear-selection");
  });
}
function handleEscPressed() {
  const targetWebContentsId = activeSelectionWebContentsId;
  if (targetWebContentsId === null) {
    closeCapture();
    return;
  }
  const activeWindow = captureWindows.find((win) => {
    return !win.isDestroyed() && win.webContents.id === targetWebContentsId;
  });
  if (!activeWindow) {
    resetCaptureSessionState();
    closeCapture();
    return;
  }
  activeWindow.webContents.send("capture-cancel-request");
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.js"),
      nodeIntegration: true,
      contextIsolation: true
    }
  });
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(process.env.APP_ROOT, "dist/index.html"));
  }
}
async function getVisibleWindows() {
  const swiftScript = `
import Foundation
import CoreGraphics

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var result: [[String: Any]] = []

for window in windows {
  guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let x = bounds["X"] as? Double,
        let y = bounds["Y"] as? Double,
        let width = bounds["Width"] as? Double,
        let height = bounds["Height"] as? Double,
        let layer = window[kCGWindowLayer as String] as? Int,
        let alpha = window[kCGWindowAlpha as String] as? Double,
        let isOnscreen = window[kCGWindowIsOnscreen as String] as? Int,
        let number = window[kCGWindowNumber as String] as? Int,
        let ownerName = window[kCGWindowOwnerName as String] as? String
  else {
    continue
  }

  if layer != 0 || alpha <= 0 || isOnscreen == 0 {
    continue
  }

  if width < 120 || height < 80 {
    continue
  }

  let name = (window[kCGWindowName as String] as? String) ?? ""
  result.append([
    "id": number,
    "ownerName": ownerName,
    "name": name,
    "bounds": [
      "x": x,
      "y": y,
      "width": width,
      "height": height
    ]
  ])
}

let data = try JSONSerialization.data(withJSONObject: result, options: [])
print(String(data: data, encoding: .utf8) ?? "[]")
`;
  const { stdout } = await execFileAsync("swift", ["-e", swiftScript], {
    cwd: process.env.APP_ROOT,
    maxBuffer: 1024 * 1024 * 8
  });
  const parsed = JSON.parse(stdout.trim() || "[]");
  return parsed.filter((window) => {
    if (window.ownerName === app.getName()) {
      return false;
    }
    if (window.ownerName === "Dock" || window.ownerName === "Window Server") {
      return false;
    }
    return true;
  }).map((window) => ({
    ...window,
    displayId: String(screen.getDisplayMatching(window.bounds).id)
  }));
}
function startCapture(mode = "region", intent = "default") {
  if (captureWindows.length > 0) return;
  resetCaptureSessionState();
  const displays = screen.getAllDisplays();
  console.log(`[Capture] Starting capture on ${displays.length} display(s)`);
  displays.forEach((display, index) => {
    console.log(`[Capture] Display ${index} (ID: ${display.id}) bounds:`, display.bounds);
    const captureWin = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      acceptFirstMouse: true,
      // 核心修复：允许在未聚焦的窗口上点击一次即触发事件
      webPreferences: {
        preload: path.join(__dirname$1, "../preload/index.js"),
        nodeIntegration: true,
        contextIsolation: true
      }
    });
    captureWin.setAlwaysOnTop(true, "screen-saver");
    captureWin.setVisibleOnAllWorkspaces(true);
    if (process.platform === "darwin") {
      captureWin.setBounds({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      });
    } else {
      captureWin.setFullScreen(true);
    }
    const captureQuery = `displayId=${display.id}&index=${index}&mode=${mode}&intent=${intent}&sourceLang=${activeAppSettings.translationSourceLang}&targetLang=${activeAppSettings.translationTargetLang}`;
    if (VITE_DEV_SERVER_URL) {
      captureWin.loadURL(`${VITE_DEV_SERVER_URL}#/capture?${captureQuery}`);
    } else {
      captureWin.loadFile(path.join(process.env.APP_ROOT, "dist/index.html"), { hash: `/capture?${captureQuery}` });
    }
    captureWindows.push(captureWin);
    captureWin.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape" && input.type === "keyDown") {
        event.preventDefault();
        handleEscPressed();
      }
    });
  });
}
function closeCapture() {
  resetCaptureSessionState();
  captureWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.close();
    }
  });
  captureWindows = [];
  BrowserWindow.getAllWindows().forEach((win) => {
    const isPinWindow = pinWindows.includes(win);
    if (win !== mainWindow && !isPinWindow && !win.isDestroyed()) {
      win.close();
    }
  });
}
function forceExitApp() {
  closeCapture();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  app.exit(0);
}
function registerAppShortcuts(settings) {
  const validation = validateShortcutSettings(settings);
  if (!validation.valid) {
    return { success: false, message: validation.message };
  }
  globalShortcut.unregisterAll();
  const registrations = [
    [settings.startCapture, () => startCapture("region"), "截图快捷键注册失败"],
    [settings.startOcr, () => startCapture("region", "ocr"), "OCR 快捷键注册失败"],
    [settings.startTranslate, () => startCapture("region", "translate"), "翻译快捷键注册失败"],
    [settings.forceExit, () => forceExitApp(), "强制退出快捷键注册失败"]
  ];
  for (const [accelerator, handler, errorMessage] of registrations) {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      globalShortcut.unregisterAll();
      return { success: false, message: `${errorMessage}，请检查组合键是否被系统或其他程序占用` };
    }
  }
  activeAppSettings = { ...settings };
  return { success: true };
}
function createScreenshotFilename(format = "png") {
  const now = /* @__PURE__ */ new Date();
  const pad = (value) => value.toString().padStart(2, "0");
  return `screenshot_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${format}`;
}
function normalizeSaveScreenshotPayload(payload) {
  if (typeof payload === "string") {
    return {
      dataURL: payload,
      format: "png",
      quality: 92
    };
  }
  return {
    dataURL: payload.dataURL,
    format: payload.format === "jpg" ? "jpg" : "png",
    quality: Math.min(100, Math.max(10, payload.quality ?? 92))
  };
}
function getCaptureHistoryFilePath() {
  return path.join(app.getPath("userData"), "capture-history.json");
}
function getCaptureHistoryAssetDir() {
  return path.join(app.getPath("userData"), "capture-history-assets");
}
async function readCaptureHistory() {
  const historyPath = getCaptureHistoryFilePath();
  await mkdir(path.dirname(historyPath), { recursive: true });
  try {
    const raw = await readFile(historyPath, "utf8");
    return JSON.parse(raw);
  } catch {
    await writeFile(historyPath, JSON.stringify([], null, 2), "utf8");
    return [];
  }
}
async function writeCaptureHistory(items) {
  const historyPath = getCaptureHistoryFilePath();
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, JSON.stringify(items, null, 2), "utf8");
}
async function trimCaptureHistoryToLimit(items, limit) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const keptItems = items.slice(0, safeLimit);
  const removedItems = items.slice(safeLimit);
  await Promise.allSettled(
    removedItems.flatMap((item) => {
      const deletions = [unlink(item.filePath)];
      if (item.thumbnailPath !== item.filePath) {
        deletions.push(unlink(item.thumbnailPath));
      }
      return deletions;
    })
  );
  await writeCaptureHistory(keptItems);
  return keptItems;
}
function toHistoryListItem(item) {
  const thumbnailImage = nativeImage.createFromPath(item.thumbnailPath);
  return {
    ...item,
    thumbnailDataURL: thumbnailImage.isEmpty() ? "" : thumbnailImage.toDataURL()
  };
}
async function recordCaptureHistory(payload) {
  const image = nativeImage.createFromDataURL(payload.dataURL);
  if (image.isEmpty()) {
    throw new Error("无效的历史截图数据");
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const assetDir = getCaptureHistoryAssetDir();
  const filePath = path.join(assetDir, `${id}.png`);
  await mkdir(assetDir, { recursive: true });
  await writeFile(filePath, image.toPNG());
  const size = image.getSize();
  const item = {
    id,
    filePath,
    thumbnailPath: filePath,
    createdAt: Date.now(),
    action: payload.action,
    format: payload.format,
    width: size.width,
    height: size.height
  };
  const current = await readCaptureHistory();
  const next = [item, ...current];
  await trimCaptureHistoryToLimit(next, activeAppSettings.historyLimit);
  return item;
}
async function deleteCaptureHistoryItem(id) {
  const current = await readCaptureHistory();
  const target = current.find((item) => item.id === id);
  if (!target) {
    return false;
  }
  await Promise.allSettled([
    unlink(target.filePath),
    target.thumbnailPath !== target.filePath ? unlink(target.thumbnailPath) : Promise.resolve()
  ]);
  await writeCaptureHistory(current.filter((item) => item.id !== id));
  return true;
}
async function clearCaptureHistory() {
  const current = await readCaptureHistory();
  await Promise.allSettled(
    current.flatMap((item) => {
      const deletions = [unlink(item.filePath)];
      if (item.thumbnailPath !== item.filePath) {
        deletions.push(unlink(item.thumbnailPath));
      }
      return deletions;
    })
  );
  await writeCaptureHistory([]);
}
function createPinWindow(dataURL) {
  const pinId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const image = nativeImage.createFromDataURL(dataURL);
  const size = image.getSize();
  pinWindowPayloads.set(pinId, dataURL);
  const pinWindow = new BrowserWindow({
    width: Math.max(180, Math.min(size.width || 320, 960)),
    height: Math.max(120, Math.min(size.height || 240, 720)),
    frame: false,
    transparent: true,
    hasShadow: activeAppSettings.pinWindowShadow,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.js"),
      nodeIntegration: true,
      contextIsolation: true
    }
  });
  pinWindow.setAlwaysOnTop(true, "screen-saver");
  pinWindow.setVisibleOnAllWorkspaces(true);
  pinWindow.setOpacity(activeAppSettings.pinWindowOpacity);
  if (VITE_DEV_SERVER_URL) {
    pinWindow.loadURL(`${VITE_DEV_SERVER_URL}#/pin?id=${pinId}`);
  } else {
    pinWindow.loadFile(path.join(process.env.APP_ROOT, "dist/index.html"), { hash: `/pin?id=${pinId}` });
  }
  pinWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && input.type === "keyDown") {
      event.preventDefault();
      pinWindow.close();
    }
  });
  pinWindows.push(pinWindow);
  pinWindow.on("closed", () => {
    pinWindowPayloads.delete(pinId);
    pinWindows = pinWindows.filter((window) => window !== pinWindow);
  });
  return { pinId };
}
app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    const hasScreenCapturePermission = systemPreferences.getMediaAccessStatus("screen") === "granted";
    if (!hasScreenCapturePermission) {
      console.warn("[Capture] No screen capture permission. Please grant it in System Preferences -> Security & Privacy.");
    }
  }
  createWindow();
  const persistedShortcutSettings = await readShortcutSettingsFromDisk();
  const registerResult = registerAppShortcuts(persistedShortcutSettings);
  if (!registerResult.success) {
    const fallbackResult = registerAppShortcuts(DEFAULT_APP_SETTINGS);
    activeAppSettings = { ...DEFAULT_APP_SETTINGS };
    if (fallbackResult.success) {
      await writeShortcutSettingsToDisk(DEFAULT_APP_SETTINGS);
    } else {
      console.error("[Shortcut] Failed to register default shortcuts:", fallbackResult.message);
    }
    console.error("[Shortcut] Failed to register persisted shortcuts:", registerResult.message);
  }
  ipcMain.handle("get-desktop-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
      });
      return sources.map((s) => ({ id: s.id, display_id: s.display_id }));
    } catch (err) {
      console.error("[Capture] Failed to get desktop sources:", err);
      return [];
    }
  });
  ipcMain.handle("close-capture", () => {
    closeCapture();
  });
  ipcMain.handle("get-visible-windows", async (_event, displayId) => {
    try {
      const windows = await getVisibleWindows();
      if (!displayId) {
        return windows;
      }
      const targetDisplay = screen.getAllDisplays().find((display) => String(display.id) === displayId);
      if (!targetDisplay) {
        return [];
      }
      return windows.filter((window) => window.displayId === displayId).sort((left, right) => left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height).map((window) => ({
        ...window,
        bounds: {
          x: window.bounds.x - targetDisplay.bounds.x,
          y: window.bounds.y - targetDisplay.bounds.y,
          width: window.bounds.width,
          height: window.bounds.height
        }
      }));
    } catch (error) {
      console.error("[Capture] Failed to get visible windows:", error);
      return [];
    }
  });
  ipcMain.handle("start-capture", (_event, mode = "region") => {
    startCapture(mode);
    return { status: "ok" };
  });
  ipcMain.handle("start-ocr-capture", () => {
    startCapture("region", "ocr");
    return { status: "ok" };
  });
  ipcMain.handle("start-translate-capture", () => {
    startCapture("region", "translate");
    return { status: "ok" };
  });
  ipcMain.handle("get-shortcut-settings", async () => {
    const settings = await readShortcutSettingsFromDisk();
    activeAppSettings = { ...settings };
    return settings;
  });
  ipcMain.handle("update-shortcut-settings", async (_event, nextSettings) => {
    const normalizedSettings = normalizeAppSettings(nextSettings);
    const previousSettings = { ...activeAppSettings };
    const registerResult2 = registerAppShortcuts(normalizedSettings);
    if (!registerResult2.success) {
      registerAppShortcuts(previousSettings);
      return {
        status: "error",
        message: registerResult2.message
      };
    }
    await writeShortcutSettingsToDisk(normalizedSettings);
    activeAppSettings = { ...normalizedSettings };
    const currentHistory = await readCaptureHistory();
    await trimCaptureHistoryToLimit(currentHistory, normalizedSettings.historyLimit);
    return {
      status: "success",
      settings: normalizedSettings
    };
  });
  ipcMain.handle("save-screenshot", async (event, payload) => {
    const captureWindow = BrowserWindow.fromWebContents(event.sender);
    const normalizedPayload = normalizeSaveScreenshotPayload(payload);
    const defaultPath = path.join(app.getPath("pictures"), createScreenshotFilename(normalizedPayload.format));
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(captureWindow ?? void 0, {
        title: "保存截图",
        defaultPath,
        filters: [
          { name: "PNG Image", extensions: ["png"] },
          { name: "JPEG Image", extensions: ["jpg", "jpeg"] }
        ]
      });
      if (canceled || !filePath) {
        return { status: "cancelled" };
      }
      const image = nativeImage.createFromDataURL(normalizedPayload.dataURL);
      if (image.isEmpty()) {
        return {
          status: "error",
          message: "无效的图片数据，无法保存截图"
        };
      }
      const finalFormat = filePath.toLowerCase().endsWith(".jpg") || filePath.toLowerCase().endsWith(".jpeg") ? "jpg" : normalizedPayload.format;
      const normalizedPath = finalFormat === "jpg" && !/\.(jpg|jpeg)$/i.test(filePath) ? `${filePath}.jpg` : finalFormat === "png" && !/\.png$/i.test(filePath) ? `${filePath}.png` : filePath;
      const buffer = finalFormat === "jpg" ? image.toJPEG(normalizedPayload.quality) : image.toPNG();
      await writeFile(normalizedPath, buffer);
      return {
        status: "success",
        filePath: normalizedPath,
        format: finalFormat
      };
    } catch (error) {
      console.error("[Capture] Failed to save screenshot:", error);
      return {
        status: "error",
        message: error instanceof Error ? error.message : "保存截图时发生未知错误"
      };
    }
  });
  ipcMain.handle("reveal-file-in-finder", async (_event, filePath) => {
    if (!filePath) {
      return { status: "error", message: "没有可定位的文件路径" };
    }
    try {
      shell.showItemInFolder(filePath);
      return { status: "success" };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "打开文件位置失败"
      };
    }
  });
  ipcMain.handle("record-capture-history", async (_event, payload) => {
    try {
      const item = await recordCaptureHistory(payload);
      return {
        status: "success",
        item
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "写入截图历史失败"
      };
    }
  });
  ipcMain.handle("list-capture-history", async () => {
    const items = await readCaptureHistory();
    return items.map(toHistoryListItem);
  });
  ipcMain.handle("delete-capture-history", async (_event, id) => {
    const deleted = await deleteCaptureHistoryItem(id);
    return { status: deleted ? "success" : "error", message: deleted ? void 0 : "未找到对应的历史记录" };
  });
  ipcMain.handle("clear-capture-history", async () => {
    await clearCaptureHistory();
    return { status: "success" };
  });
  ipcMain.handle("copy-history-image", async (_event, id) => {
    const items = await readCaptureHistory();
    const target = items.find((item) => item.id === id);
    if (!target) {
      return { status: "error", message: "未找到对应的历史截图" };
    }
    clipboard.writeImage(nativeImage.createFromPath(target.filePath));
    return { status: "success" };
  });
  ipcMain.handle("create-pin-window", async (_event, payload) => {
    try {
      return {
        status: "success",
        ...createPinWindow(payload.dataURL)
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "创建贴图窗口失败"
      };
    }
  });
  ipcMain.handle("get-pin-window-data", (_event, pinId) => {
    const dataURL = pinWindowPayloads.get(pinId);
    if (!dataURL) {
      return { status: "error", message: "贴图内容已失效，请重新贴图" };
    }
    return { status: "success", dataURL };
  });
  ipcMain.handle("set-pin-window-opacity", (event, opacity) => {
    const pinWindow = BrowserWindow.fromWebContents(event.sender);
    if (!pinWindow) {
      return { status: "error", message: "当前贴图窗口不可用" };
    }
    pinWindow.setOpacity(Math.min(1, Math.max(0.2, opacity)));
    return { status: "success" };
  });
  ipcMain.handle("resize-current-window", (event, payload) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!currentWindow) {
      return { status: "error", message: "当前窗口不可用" };
    }
    const width = Math.max(160, Math.round(payload.width));
    const height = Math.max(120, Math.round(payload.height));
    currentWindow.setSize(width, height, false);
    return { status: "success" };
  });
  ipcMain.handle("set-current-window-bounds", (event, payload) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!currentWindow) {
      return { status: "error", message: "当前窗口不可用" };
    }
    currentWindow.setBounds({
      x: Math.round(payload.x),
      y: Math.round(payload.y),
      width: Math.max(160, Math.round(payload.width)),
      height: Math.max(120, Math.round(payload.height))
    }, false);
    return { status: "success" };
  });
  ipcMain.handle("move-current-window", (event, payload) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!currentWindow) {
      return { status: "error", message: "当前窗口不可用" };
    }
    currentWindow.setPosition(Math.round(payload.x), Math.round(payload.y), false);
    return { status: "success" };
  });
  ipcMain.handle("close-current-window", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    currentWindow == null ? void 0 : currentWindow.close();
    return { status: "success" };
  });
  ipcMain.handle("translate-text", async (_event, payload) => {
    const text = payload.text.trim();
    if (!text) {
      return {
        status: "error",
        message: "没有可翻译的文本内容"
      };
    }
    const providers = [
      () => tryLibreTranslateEndpoint("https://translate.argosopentech.com/translate", { text, sourceLang: payload.sourceLang, targetLang: payload.targetLang }),
      () => tryLibreTranslateEndpoint("https://libretranslate.com/translate", { text, sourceLang: payload.sourceLang, targetLang: payload.targetLang }),
      () => tryMyMemoryEndpoint({ text, sourceLang: payload.sourceLang, targetLang: payload.targetLang })
    ];
    try {
      for (const provider of providers) {
        try {
          const translatedText = await provider();
          if (translatedText) {
            return {
              status: "success",
              text: translatedText
            };
          }
        } catch (providerError) {
          console.warn("[Translate] Provider failed:", providerError);
        }
      }
      return {
        status: "error",
        message: "翻译服务暂时不可用，请稍后重试"
      };
    } catch (error) {
      console.error("[Translate] Failed to translate text:", error);
      return {
        status: "error",
        message: "翻译失败，请检查网络后重试"
      };
    }
  });
  ipcMain.on("capture-begin-selection", (event) => {
    activeSelectionWebContentsId = event.sender.id;
    clearSelectionsExcept(event.sender);
  });
  ipcMain.on("capture-selection-state", (event, payload) => {
    syncSelectionState(event.sender.id, payload.hasSelection);
  });
  ipcMain.on("capture-clear-others", (event) => {
    clearSelectionsExcept(event.sender);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
export {
  VITE_DEV_SERVER_URL
};
