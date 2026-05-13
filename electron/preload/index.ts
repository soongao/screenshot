import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  getVisibleWindows: (displayId?: string) => ipcRenderer.invoke('get-visible-windows', displayId),
  getShortcutSettings: () => ipcRenderer.invoke('get-shortcut-settings'),
  updateShortcutSettings: (settings: {
    startCapture: string
    startOcr: string
    startTranslate: string
    forceExit: string
    translationSourceLang: 'auto' | 'zh' | 'en'
    translationTargetLang: 'zh' | 'en'
    defaultExportFormat: 'png' | 'jpg'
    closeAfterCopy: boolean
    closeAfterSave: boolean
    closeAfterPin: boolean
    historyLimit: number
    annotationColor: string
    annotationStrokeWidth: number
    annotationFontSize: number
    toolbarOpacity: number
    toolbarScale: number
    ocrLanguages: 'eng' | 'chi_sim' | 'eng+chi_sim'
    pinWindowShadow: boolean
    pinWindowOpacity: number
  }) => ipcRenderer.invoke('update-shortcut-settings', settings),
  startCapture: (mode: 'region') => ipcRenderer.invoke('start-capture', mode),
  startOcrCapture: () => ipcRenderer.invoke('start-ocr-capture'),
  startTranslateCapture: () => ipcRenderer.invoke('start-translate-capture'),
  closeCapture: () => ipcRenderer.invoke('close-capture'),
  saveScreenshot: (payload: { dataURL: string; format?: 'png' | 'jpg'; quality?: number }) => ipcRenderer.invoke('save-screenshot', payload),
  revealFileInFinder: (filePath: string) => ipcRenderer.invoke('reveal-file-in-finder', filePath),
  recordCaptureHistory: (payload: { dataURL: string; action: 'copy' | 'save' | 'pin' | 'confirm'; format: 'png' | 'jpg' }) => ipcRenderer.invoke('record-capture-history', payload),
  listCaptureHistory: () => ipcRenderer.invoke('list-capture-history'),
  deleteCaptureHistory: (id: string) => ipcRenderer.invoke('delete-capture-history', id),
  clearCaptureHistory: () => ipcRenderer.invoke('clear-capture-history'),
  copyHistoryImage: (id: string) => ipcRenderer.invoke('copy-history-image', id),
  createPinWindow: (payload: { dataURL: string }) => ipcRenderer.invoke('create-pin-window', payload),
  getPinWindowData: (pinId: string) => ipcRenderer.invoke('get-pin-window-data', pinId),
  setPinWindowOpacity: (opacity: number) => ipcRenderer.invoke('set-pin-window-opacity', opacity),
  resizeCurrentWindow: (payload: { width: number; height: number }) => ipcRenderer.invoke('resize-current-window', payload),
  setCurrentWindowBounds: (payload: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('set-current-window-bounds', payload),
  moveCurrentWindow: (payload: { x: number; y: number }) => ipcRenderer.invoke('move-current-window', payload),
  closeCurrentWindow: () => ipcRenderer.invoke('close-current-window'),
  translateText: (payload: { text: string; sourceLang: 'auto' | 'zh' | 'en'; targetLang: 'zh' | 'en' }) => ipcRenderer.invoke('translate-text', payload),
  notifySelectionStart: () => ipcRenderer.send('capture-begin-selection'),
  updateSelectionState: (hasSelection: boolean) => ipcRenderer.send('capture-selection-state', { hasSelection }),
  clearOtherSelections: () => ipcRenderer.send('capture-clear-others'),
  onClearSelection: (callback: () => void) => {
    ipcRenderer.removeAllListeners('capture-clear-selection')
    ipcRenderer.on('capture-clear-selection', () => callback())
  },
  onCancelCaptureRequest: (callback: () => void) => {
    ipcRenderer.removeAllListeners('capture-cancel-request')
    ipcRenderer.on('capture-cancel-request', () => callback())
  }
})
