import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  getVisibleWindows: (displayId) => ipcRenderer.invoke("get-visible-windows", displayId),
  getShortcutSettings: () => ipcRenderer.invoke("get-shortcut-settings"),
  updateShortcutSettings: (settings) => ipcRenderer.invoke("update-shortcut-settings", settings),
  startCapture: (mode) => ipcRenderer.invoke("start-capture", mode),
  startOcrCapture: () => ipcRenderer.invoke("start-ocr-capture"),
  startTranslateCapture: () => ipcRenderer.invoke("start-translate-capture"),
  closeCapture: () => ipcRenderer.invoke("close-capture"),
  saveScreenshot: (payload) => ipcRenderer.invoke("save-screenshot", payload),
  revealFileInFinder: (filePath) => ipcRenderer.invoke("reveal-file-in-finder", filePath),
  recordCaptureHistory: (payload) => ipcRenderer.invoke("record-capture-history", payload),
  listCaptureHistory: () => ipcRenderer.invoke("list-capture-history"),
  deleteCaptureHistory: (id) => ipcRenderer.invoke("delete-capture-history", id),
  clearCaptureHistory: () => ipcRenderer.invoke("clear-capture-history"),
  copyHistoryImage: (id) => ipcRenderer.invoke("copy-history-image", id),
  createPinWindow: (payload) => ipcRenderer.invoke("create-pin-window", payload),
  getPinWindowData: (pinId) => ipcRenderer.invoke("get-pin-window-data", pinId),
  setPinWindowOpacity: (opacity) => ipcRenderer.invoke("set-pin-window-opacity", opacity),
  resizeCurrentWindow: (payload) => ipcRenderer.invoke("resize-current-window", payload),
  setCurrentWindowBounds: (payload) => ipcRenderer.invoke("set-current-window-bounds", payload),
  moveCurrentWindow: (payload) => ipcRenderer.invoke("move-current-window", payload),
  closeCurrentWindow: () => ipcRenderer.invoke("close-current-window"),
  translateText: (payload) => ipcRenderer.invoke("translate-text", payload),
  notifySelectionStart: () => ipcRenderer.send("capture-begin-selection"),
  updateSelectionState: (hasSelection) => ipcRenderer.send("capture-selection-state", { hasSelection }),
  clearOtherSelections: () => ipcRenderer.send("capture-clear-others"),
  onClearSelection: (callback) => {
    ipcRenderer.removeAllListeners("capture-clear-selection");
    ipcRenderer.on("capture-clear-selection", () => callback());
  },
  onCancelCaptureRequest: (callback) => {
    ipcRenderer.removeAllListeners("capture-cancel-request");
    ipcRenderer.on("capture-cancel-request", () => callback());
  }
});
