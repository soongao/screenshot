import { app, BrowserWindow, clipboard, dialog, ipcMain, globalShortcut, desktopCapturer, nativeImage, screen, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '../..')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
let captureWindows: BrowserWindow[] = []
let pinWindows: BrowserWindow[] = []
let activeSelectionWebContentsId: number | null = null
type CaptureMode = 'region'
type CaptureIntent = 'default' | 'ocr' | 'translate'
type TranslateSourceLang = 'auto' | 'zh' | 'en'
type TranslateTargetLang = 'zh' | 'en'
type ExportFormat = 'png' | 'jpg'
type OcrLanguages = 'eng' | 'chi_sim' | 'eng+chi_sim'
type ShortcutAction = 'startCapture' | 'startOcr' | 'startTranslate' | 'forceExit'

type ShortcutSettings = Record<ShortcutAction, string>
type AppSettings = ShortcutSettings & {
  translationSourceLang: TranslateSourceLang
  translationTargetLang: TranslateTargetLang
  defaultExportFormat: ExportFormat
  closeAfterCopy: boolean
  closeAfterSave: boolean
  closeAfterPin: boolean
  historyLimit: number
  annotationColor: string
  annotationStrokeWidth: number
  annotationFontSize: number
  toolbarOpacity: number
  toolbarScale: number
  ocrLanguages: OcrLanguages
  pinWindowShadow: boolean
  pinWindowOpacity: number
}

type SaveScreenshotPayload = {
  dataURL: string
  format?: ExportFormat
  quality?: number
}

type CaptureHistoryAction = 'copy' | 'save' | 'pin' | 'confirm'

type CaptureHistoryItem = {
  id: string
  filePath: string
  thumbnailPath: string
  createdAt: number
  action: CaptureHistoryAction
  format: ExportFormat
  width: number
  height: number
}

type CaptureHistoryListItem = CaptureHistoryItem & {
  thumbnailDataURL: string
}

type RecordCaptureHistoryPayload = {
  dataURL: string
  action: CaptureHistoryAction
  format: ExportFormat
}

type NativeWindowInfo = {
  id: number
  ownerName: string
  name: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  displayId: string
}

const execFileAsync = promisify(execFile)
const DEFAULT_APP_SETTINGS: AppSettings = {
  startCapture: 'CommandOrControl+Shift+A',
  startOcr: 'CommandOrControl+Shift+O',
  startTranslate: 'CommandOrControl+Shift+T',
  forceExit: 'CommandOrControl+Shift+Q',
  translationSourceLang: 'auto',
  translationTargetLang: 'zh',
  defaultExportFormat: 'png',
  closeAfterCopy: true,
  closeAfterSave: false,
  closeAfterPin: true,
  historyLimit: 5,
  annotationColor: '#ff3b30',
  annotationStrokeWidth: 4,
  annotationFontSize: 20,
  toolbarOpacity: 0.94,
  toolbarScale: 1,
  ocrLanguages: 'eng+chi_sim',
  pinWindowShadow: true,
  pinWindowOpacity: 1,
}

let activeAppSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }
const pinWindowPayloads = new Map<string, string>()

async function tryLibreTranslateEndpoint(url: string, payload: { text: string; sourceLang: TranslateSourceLang; targetLang: TranslateTargetLang }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: payload.text,
      source: payload.sourceLang,
      target: payload.targetLang,
      format: 'text',
    }),
  })

  if (!response.ok) {
    throw new Error(`LibreTranslate endpoint failed: ${response.status}`)
  }

  const data = await response.json() as { translatedText?: string }
  return data.translatedText?.trim() || ''
}

async function tryMyMemoryEndpoint(payload: { text: string; sourceLang: TranslateSourceLang; targetLang: TranslateTargetLang }) {
  const sourceLang = payload.sourceLang === 'auto' ? 'auto' : payload.sourceLang
  const langpair = `${sourceLang}|${payload.targetLang}`
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(payload.text)}&langpair=${encodeURIComponent(langpair)}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`MyMemory endpoint failed: ${response.status}`)
  }

  const data = await response.json() as {
    responseData?: {
      translatedText?: string
    }
  }

  return data.responseData?.translatedText?.trim() || ''
}

function resetCaptureSessionState() {
  activeSelectionWebContentsId = null
}

function getShortcutSettingsPath() {
  return path.join(app.getPath('userData'), 'shortcut-settings.json')
}

async function readShortcutSettingsFromDisk(): Promise<AppSettings> {
  const settingsPath = getShortcutSettingsPath()
  await mkdir(path.dirname(settingsPath), { recursive: true })

  try {
    const raw = await readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
    }
  } catch {
    await writeFile(settingsPath, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2), 'utf8')
    return { ...DEFAULT_APP_SETTINGS }
  }
}

async function writeShortcutSettingsToDisk(settings: AppSettings) {
  const settingsPath = getShortcutSettingsPath()
  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

function validateShortcutSettings(settings: AppSettings) {
  const values = [
    settings.startCapture,
    settings.startOcr,
    settings.startTranslate,
    settings.forceExit,
  ].map((value) => value.trim())

  if (values.some((value) => !value)) {
    return { valid: false as const, message: '快捷键不能为空' }
  }

  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    return { valid: false as const, message: '快捷键不能重复，请为每个功能设置不同的组合键' }
  }

  return { valid: true as const }
}

function normalizeAppSettings(nextSettings: AppSettings): AppSettings {
  return {
    startCapture: nextSettings.startCapture.trim(),
    startOcr: nextSettings.startOcr.trim(),
    startTranslate: nextSettings.startTranslate.trim(),
    forceExit: nextSettings.forceExit.trim(),
    translationSourceLang: nextSettings.translationSourceLang,
    translationTargetLang: nextSettings.translationTargetLang,
    defaultExportFormat: nextSettings.defaultExportFormat === 'jpg' ? 'jpg' : 'png',
    closeAfterCopy: Boolean(nextSettings.closeAfterCopy),
    closeAfterSave: Boolean(nextSettings.closeAfterSave),
    closeAfterPin: Boolean(nextSettings.closeAfterPin),
    historyLimit: Math.min(200, Math.max(1, Number(nextSettings.historyLimit) || 5)),
    annotationColor: /^#([0-9a-fA-F]{6})$/.test(nextSettings.annotationColor) ? nextSettings.annotationColor : '#ff3b30',
    annotationStrokeWidth: [2, 4, 6, 8, 12].includes(Number(nextSettings.annotationStrokeWidth)) ? Number(nextSettings.annotationStrokeWidth) : 4,
    annotationFontSize: [14, 18, 20, 24, 28, 32].includes(Number(nextSettings.annotationFontSize)) ? Number(nextSettings.annotationFontSize) : 20,
    toolbarOpacity: Math.min(1, Math.max(0.7, Number(nextSettings.toolbarOpacity) || 0.94)),
    toolbarScale: [0.9, 1, 1.1, 1.2].includes(Number(nextSettings.toolbarScale)) ? Number(nextSettings.toolbarScale) : 1,
    ocrLanguages: nextSettings.ocrLanguages === 'eng' || nextSettings.ocrLanguages === 'chi_sim' ? nextSettings.ocrLanguages : 'eng+chi_sim',
    pinWindowShadow: Boolean(nextSettings.pinWindowShadow),
    pinWindowOpacity: Math.min(1, Math.max(0.2, Number(nextSettings.pinWindowOpacity) || 1)),
  }
}

function syncSelectionState(senderId: number, hasSelection: boolean) {
  if (hasSelection) {
    activeSelectionWebContentsId = senderId
    return
  }

  if (activeSelectionWebContentsId === senderId) {
    activeSelectionWebContentsId = null
  }
}

function clearSelectionsExcept(sender?: Electron.WebContents) {
  captureWindows.forEach((win) => {
    if (win.isDestroyed()) {
      return
    }

    if (sender && win.webContents === sender) {
      return
    }

    win.webContents.send('capture-clear-selection')
  })
}

function handleEscPressed() {
  const targetWebContentsId = activeSelectionWebContentsId
  if (targetWebContentsId === null) {
    closeCapture()
    return
  }

  const activeWindow = captureWindows.find((win) => {
    return !win.isDestroyed() && win.webContents.id === targetWebContentsId
  })

  if (!activeWindow) {
    resetCaptureSessionState()
    closeCapture()
    return
  }

  // Let the renderer decide whether Escape should finish text editing,
  // clear the current selection, or close the capture flow.
  activeWindow.webContents.send('capture-cancel-request')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(process.env.APP_ROOT, 'dist/index.html'))
  }
}

async function getVisibleWindows(): Promise<NativeWindowInfo[]> {
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
`

  const { stdout } = await execFileAsync('swift', ['-e', swiftScript], {
    cwd: process.env.APP_ROOT,
    maxBuffer: 1024 * 1024 * 8,
  })

  const parsed = JSON.parse(stdout.trim() || '[]') as Array<{
    id: number
    ownerName: string
    name: string
    bounds: { x: number; y: number; width: number; height: number }
  }>

  return parsed
    .filter((window) => {
      if (window.ownerName === app.getName()) {
        return false
      }
      if (window.ownerName === 'Dock' || window.ownerName === 'Window Server') {
        return false
      }
      return true
    })
    .map((window) => ({
      ...window,
      displayId: String(screen.getDisplayMatching(window.bounds).id),
    }))
}

function startCapture(mode: CaptureMode = 'region', intent: CaptureIntent = 'default') {
  if (captureWindows.length > 0) return
  resetCaptureSessionState()

  const displays = screen.getAllDisplays()
  console.log(`[Capture] Starting capture on ${displays.length} display(s)`)

  displays.forEach((display, index) => {
    console.log(`[Capture] Display ${index} (ID: ${display.id}) bounds:`, display.bounds)
    
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
      acceptFirstMouse: true, // 核心修复：允许在未聚焦的窗口上点击一次即触发事件
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    captureWin.setAlwaysOnTop(true, 'screen-saver')
    captureWin.setVisibleOnAllWorkspaces(true)
    
    if (process.platform === 'darwin') {
      captureWin.setBounds({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      })
    } else {
      captureWin.setFullScreen(true)
    }

    const captureQuery = `displayId=${display.id}&index=${index}&mode=${mode}&intent=${intent}&sourceLang=${activeAppSettings.translationSourceLang}&targetLang=${activeAppSettings.translationTargetLang}`

    if (VITE_DEV_SERVER_URL) {
      captureWin.loadURL(`${VITE_DEV_SERVER_URL}#/capture?${captureQuery}`)
    } else {
      captureWin.loadFile(path.join(process.env.APP_ROOT, 'dist/index.html'), { hash: `/capture?${captureQuery}` })
    }

    captureWindows.push(captureWin)

    // 监听每个窗口的 ESC 按键事件（在主进程级别拦截）
    captureWin.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        event.preventDefault()
        handleEscPressed()
      }
    })
  })
}

function closeCapture() {
  resetCaptureSessionState()
  // 1. 关闭所有被追踪的截图窗口
  captureWindows.forEach(win => {
    if (!win.isDestroyed()) {
      win.close()
    }
  })
  captureWindows = []

  // 2. 激进清理：为了防止热更新或异常导致的僵尸窗口，关闭所有非主窗口的实例
  BrowserWindow.getAllWindows().forEach(win => {
    const isPinWindow = pinWindows.includes(win)
    if (win !== mainWindow && !isPinWindow && !win.isDestroyed()) {
      win.close()
    }
  })
}

function forceExitApp() {
  closeCapture()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
  }

  app.exit(0)
}

function registerAppShortcuts(settings: AppSettings) {
  const validation = validateShortcutSettings(settings)
  if (!validation.valid) {
    return { success: false as const, message: validation.message }
  }

  globalShortcut.unregisterAll()

  const registrations: Array<[string, () => void, string]> = [
    [settings.startCapture, () => startCapture('region'), '截图快捷键注册失败'],
    [settings.startOcr, () => startCapture('region', 'ocr'), 'OCR 快捷键注册失败'],
    [settings.startTranslate, () => startCapture('region', 'translate'), '翻译快捷键注册失败'],
    [settings.forceExit, () => forceExitApp(), '强制退出快捷键注册失败'],
  ]

  for (const [accelerator, handler, errorMessage] of registrations) {
    const registered = globalShortcut.register(accelerator, handler)
    if (!registered) {
      globalShortcut.unregisterAll()
      return { success: false as const, message: `${errorMessage}，请检查组合键是否被系统或其他程序占用` }
    }
  }

  activeAppSettings = { ...settings }
  return { success: true as const }
}

function createScreenshotFilename(format: ExportFormat = 'png') {
  const now = new Date()
  const pad = (value: number) => value.toString().padStart(2, '0')

  return `screenshot_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${format}`
}

function normalizeSaveScreenshotPayload(payload: string | SaveScreenshotPayload): Required<SaveScreenshotPayload> {
  if (typeof payload === 'string') {
    return {
      dataURL: payload,
      format: 'png',
      quality: 92,
    }
  }

  return {
    dataURL: payload.dataURL,
    format: payload.format === 'jpg' ? 'jpg' : 'png',
    quality: Math.min(100, Math.max(10, payload.quality ?? 92)),
  }
}

function getCaptureHistoryFilePath() {
  return path.join(app.getPath('userData'), 'capture-history.json')
}

function getCaptureHistoryAssetDir() {
  return path.join(app.getPath('userData'), 'capture-history-assets')
}

async function readCaptureHistory(): Promise<CaptureHistoryItem[]> {
  const historyPath = getCaptureHistoryFilePath()
  await mkdir(path.dirname(historyPath), { recursive: true })

  try {
    const raw = await readFile(historyPath, 'utf8')
    return JSON.parse(raw) as CaptureHistoryItem[]
  } catch {
    await writeFile(historyPath, JSON.stringify([], null, 2), 'utf8')
    return []
  }
}

async function writeCaptureHistory(items: CaptureHistoryItem[]) {
  const historyPath = getCaptureHistoryFilePath()
  await mkdir(path.dirname(historyPath), { recursive: true })
  await writeFile(historyPath, JSON.stringify(items, null, 2), 'utf8')
}

async function trimCaptureHistoryToLimit(items: CaptureHistoryItem[], limit: number) {
  const safeLimit = Math.min(200, Math.max(1, limit))
  const keptItems = items.slice(0, safeLimit)
  const removedItems = items.slice(safeLimit)

  await Promise.allSettled(
    removedItems.flatMap((item) => {
      const deletions: Promise<unknown>[] = [unlink(item.filePath)]
      if (item.thumbnailPath !== item.filePath) {
        deletions.push(unlink(item.thumbnailPath))
      }
      return deletions
    }),
  )

  await writeCaptureHistory(keptItems)
  return keptItems
}

function toHistoryListItem(item: CaptureHistoryItem): CaptureHistoryListItem {
  const thumbnailImage = nativeImage.createFromPath(item.thumbnailPath)
  return {
    ...item,
    thumbnailDataURL: thumbnailImage.isEmpty() ? '' : thumbnailImage.toDataURL(),
  }
}

async function recordCaptureHistory(payload: RecordCaptureHistoryPayload) {
  const image = nativeImage.createFromDataURL(payload.dataURL)
  if (image.isEmpty()) {
    throw new Error('无效的历史截图数据')
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const assetDir = getCaptureHistoryAssetDir()
  const filePath = path.join(assetDir, `${id}.png`)
  await mkdir(assetDir, { recursive: true })
  await writeFile(filePath, image.toPNG())

  const size = image.getSize()
  const item: CaptureHistoryItem = {
    id,
    filePath,
    thumbnailPath: filePath,
    createdAt: Date.now(),
    action: payload.action,
    format: payload.format,
    width: size.width,
    height: size.height,
  }
  const current = await readCaptureHistory()
  const next = [item, ...current]
  await trimCaptureHistoryToLimit(next, activeAppSettings.historyLimit)
  return item
}

async function deleteCaptureHistoryItem(id: string) {
  const current = await readCaptureHistory()
  const target = current.find((item) => item.id === id)
  if (!target) {
    return false
  }

  await Promise.allSettled([
    unlink(target.filePath),
    target.thumbnailPath !== target.filePath ? unlink(target.thumbnailPath) : Promise.resolve(),
  ])
  await writeCaptureHistory(current.filter((item) => item.id !== id))
  return true
}

async function clearCaptureHistory() {
  const current = await readCaptureHistory()
  await Promise.allSettled(
    current.flatMap((item) => {
      const deletions: Promise<unknown>[] = [unlink(item.filePath)]
      if (item.thumbnailPath !== item.filePath) {
        deletions.push(unlink(item.thumbnailPath))
      }
      return deletions
    }),
  )
  await writeCaptureHistory([])
}

function createPinWindow(dataURL: string) {
  const pinId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const image = nativeImage.createFromDataURL(dataURL)
  const size = image.getSize()
  pinWindowPayloads.set(pinId, dataURL)

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
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  })

  pinWindow.setAlwaysOnTop(true, 'screen-saver')
  pinWindow.setVisibleOnAllWorkspaces(true)
  pinWindow.setOpacity(activeAppSettings.pinWindowOpacity)

  if (VITE_DEV_SERVER_URL) {
    pinWindow.loadURL(`${VITE_DEV_SERVER_URL}#/pin?id=${pinId}`)
  } else {
    pinWindow.loadFile(path.join(process.env.APP_ROOT, 'dist/index.html'), { hash: `/pin?id=${pinId}` })
  }

  pinWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault()
      pinWindow.close()
    }
  })

  pinWindows.push(pinWindow)
  pinWindow.on('closed', () => {
    pinWindowPayloads.delete(pinId)
    pinWindows = pinWindows.filter((window) => window !== pinWindow)
  })

  return { pinId }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // 检查并请求 macOS 的屏幕录制权限
    const hasScreenCapturePermission = systemPreferences.getMediaAccessStatus('screen') === 'granted'
    if (!hasScreenCapturePermission) {
      console.warn('[Capture] No screen capture permission. Please grant it in System Preferences -> Security & Privacy.')
      // 在新版 macOS 中，调用 desktopCapturer 会触发系统弹窗请求权限
    }
  }

  createWindow()

  const persistedShortcutSettings = await readShortcutSettingsFromDisk()
  const registerResult = registerAppShortcuts(persistedShortcutSettings)
  if (!registerResult.success) {
    const fallbackResult = registerAppShortcuts(DEFAULT_APP_SETTINGS)
    activeAppSettings = { ...DEFAULT_APP_SETTINGS }
    if (fallbackResult.success) {
      await writeShortcutSettingsToDisk(DEFAULT_APP_SETTINGS)
    } else {
      console.error('[Shortcut] Failed to register default shortcuts:', fallbackResult.message)
    }
    console.error('[Shortcut] Failed to register persisted shortcuts:', registerResult.message)
  }

  ipcMain.handle('get-desktop-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      })
      return sources.map(s => ({ id: s.id, display_id: s.display_id }))
    } catch (err) {
      console.error('[Capture] Failed to get desktop sources:', err)
      return []
    }
  })

  ipcMain.handle('close-capture', () => {
    closeCapture()
  })

  ipcMain.handle('get-visible-windows', async (_event, displayId?: string) => {
    try {
      const windows = await getVisibleWindows()
      if (!displayId) {
        return windows
      }

      const targetDisplay = screen.getAllDisplays().find((display) => String(display.id) === displayId)
      if (!targetDisplay) {
        return []
      }

      return windows
        .filter((window) => window.displayId === displayId)
        .sort((left, right) => (left.bounds.width * left.bounds.height) - (right.bounds.width * right.bounds.height))
        .map((window) => ({
          ...window,
          bounds: {
            x: window.bounds.x - targetDisplay.bounds.x,
            y: window.bounds.y - targetDisplay.bounds.y,
            width: window.bounds.width,
            height: window.bounds.height,
          },
        }))
    } catch (error) {
      console.error('[Capture] Failed to get visible windows:', error)
      return []
    }
  })

  ipcMain.handle('start-capture', (_event, mode: CaptureMode = 'region') => {
    startCapture(mode)
    return { status: 'ok' as const }
  })

  ipcMain.handle('start-ocr-capture', () => {
    startCapture('region', 'ocr')
    return { status: 'ok' as const }
  })

  ipcMain.handle('start-translate-capture', () => {
    startCapture('region', 'translate')
    return { status: 'ok' as const }
  })

  ipcMain.handle('get-shortcut-settings', async () => {
    const settings = await readShortcutSettingsFromDisk()
    activeAppSettings = { ...settings }
    return settings
  })

  ipcMain.handle('update-shortcut-settings', async (_event, nextSettings: AppSettings) => {
    const normalizedSettings = normalizeAppSettings(nextSettings)

    const previousSettings = { ...activeAppSettings }
    const registerResult = registerAppShortcuts(normalizedSettings)
    if (!registerResult.success) {
      registerAppShortcuts(previousSettings)
      return {
        status: 'error' as const,
        message: registerResult.message,
      }
    }

    await writeShortcutSettingsToDisk(normalizedSettings)
    activeAppSettings = { ...normalizedSettings }
    const currentHistory = await readCaptureHistory()
    await trimCaptureHistoryToLimit(currentHistory, normalizedSettings.historyLimit)
    return {
      status: 'success' as const,
      settings: normalizedSettings,
    }
  })

  ipcMain.handle('save-screenshot', async (event, payload: string | SaveScreenshotPayload) => {
    const captureWindow = BrowserWindow.fromWebContents(event.sender)
    const normalizedPayload = normalizeSaveScreenshotPayload(payload)
    const defaultPath = path.join(app.getPath('pictures'), createScreenshotFilename(normalizedPayload.format))

    try {
      const { canceled, filePath } = await dialog.showSaveDialog(captureWindow ?? undefined, {
        title: '保存截图',
        defaultPath,
        filters: [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
        ],
      })

      if (canceled || !filePath) {
        return { status: 'cancelled' as const }
      }

      const image = nativeImage.createFromDataURL(normalizedPayload.dataURL)
      if (image.isEmpty()) {
        return {
          status: 'error' as const,
          message: '无效的图片数据，无法保存截图',
        }
      }

      const finalFormat: ExportFormat = filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')
        ? 'jpg'
        : normalizedPayload.format
      const normalizedPath = finalFormat === 'jpg' && !/\.(jpg|jpeg)$/i.test(filePath)
        ? `${filePath}.jpg`
        : finalFormat === 'png' && !/\.png$/i.test(filePath)
          ? `${filePath}.png`
          : filePath
      const buffer = finalFormat === 'jpg'
        ? image.toJPEG(normalizedPayload.quality)
        : image.toPNG()

      await writeFile(normalizedPath, buffer)

      return {
        status: 'success' as const,
        filePath: normalizedPath,
        format: finalFormat,
      }
    } catch (error) {
      console.error('[Capture] Failed to save screenshot:', error)

      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : '保存截图时发生未知错误',
      }
    }
  })

  ipcMain.handle('reveal-file-in-finder', async (_event, filePath: string) => {
    if (!filePath) {
      return { status: 'error' as const, message: '没有可定位的文件路径' }
    }

    try {
      shell.showItemInFolder(filePath)
      return { status: 'success' as const }
    } catch (error) {
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : '打开文件位置失败',
      }
    }
  })

  ipcMain.handle('record-capture-history', async (_event, payload: RecordCaptureHistoryPayload) => {
    try {
      const item = await recordCaptureHistory(payload)
      return {
        status: 'success' as const,
        item,
      }
    } catch (error) {
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : '写入截图历史失败',
      }
    }
  })

  ipcMain.handle('list-capture-history', async () => {
    const items = await readCaptureHistory()
    return items.map(toHistoryListItem)
  })

  ipcMain.handle('delete-capture-history', async (_event, id: string) => {
    const deleted = await deleteCaptureHistoryItem(id)
    return { status: deleted ? 'success' as const : 'error' as const, message: deleted ? undefined : '未找到对应的历史记录' }
  })

  ipcMain.handle('clear-capture-history', async () => {
    await clearCaptureHistory()
    return { status: 'success' as const }
  })

  ipcMain.handle('copy-history-image', async (_event, id: string) => {
    const items = await readCaptureHistory()
    const target = items.find((item) => item.id === id)
    if (!target) {
      return { status: 'error' as const, message: '未找到对应的历史截图' }
    }

    clipboard.writeImage(nativeImage.createFromPath(target.filePath))
    return { status: 'success' as const }
  })

  ipcMain.handle('create-pin-window', async (_event, payload: { dataURL: string }) => {
    try {
      return {
        status: 'success' as const,
        ...createPinWindow(payload.dataURL),
      }
    } catch (error) {
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : '创建贴图窗口失败',
      }
    }
  })

  ipcMain.handle('get-pin-window-data', (_event, pinId: string) => {
    const dataURL = pinWindowPayloads.get(pinId)
    if (!dataURL) {
      return { status: 'error' as const, message: '贴图内容已失效，请重新贴图' }
    }

    return { status: 'success' as const, dataURL }
  })

  ipcMain.handle('set-pin-window-opacity', (event, opacity: number) => {
    const pinWindow = BrowserWindow.fromWebContents(event.sender)
    if (!pinWindow) {
      return { status: 'error' as const, message: '当前贴图窗口不可用' }
    }

    pinWindow.setOpacity(Math.min(1, Math.max(0.2, opacity)))
    return { status: 'success' as const }
  })

  ipcMain.handle('resize-current-window', (event, payload: { width: number; height: number }) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return { status: 'error' as const, message: '当前窗口不可用' }
    }

    const width = Math.max(160, Math.round(payload.width))
    const height = Math.max(120, Math.round(payload.height))
    currentWindow.setSize(width, height, false)
    return { status: 'success' as const }
  })

  ipcMain.handle('set-current-window-bounds', (event, payload: { x: number; y: number; width: number; height: number }) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return { status: 'error' as const, message: '当前窗口不可用' }
    }

    currentWindow.setBounds({
      x: Math.round(payload.x),
      y: Math.round(payload.y),
      width: Math.max(160, Math.round(payload.width)),
      height: Math.max(120, Math.round(payload.height)),
    }, false)
    return { status: 'success' as const }
  })

  ipcMain.handle('move-current-window', (event, payload: { x: number; y: number }) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return { status: 'error' as const, message: '当前窗口不可用' }
    }

    currentWindow.setPosition(Math.round(payload.x), Math.round(payload.y), false)
    return { status: 'success' as const }
  })

  ipcMain.handle('close-current-window', (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    currentWindow?.close()
    return { status: 'success' as const }
  })

  ipcMain.handle('translate-text', async (_event, payload: { text: string; sourceLang: TranslateSourceLang; targetLang: TranslateTargetLang }) => {
    const text = payload.text.trim()
    if (!text) {
      return {
        status: 'error' as const,
        message: '没有可翻译的文本内容',
      }
    }

    const providers = [
      () => tryLibreTranslateEndpoint('https://translate.argosopentech.com/translate', { text, sourceLang: payload.sourceLang, targetLang: payload.targetLang }),
      () => tryLibreTranslateEndpoint('https://libretranslate.com/translate', { text, sourceLang: payload.sourceLang, targetLang: payload.targetLang }),
      () => tryMyMemoryEndpoint({ text, sourceLang: payload.sourceLang, targetLang: payload.targetLang }),
    ]

    try {
      for (const provider of providers) {
        try {
          const translatedText = await provider()
          if (translatedText) {
            return {
              status: 'success' as const,
              text: translatedText,
            }
          }
        } catch (providerError) {
          console.warn('[Translate] Provider failed:', providerError)
        }
      }

      return {
        status: 'error' as const,
        message: '翻译服务暂时不可用，请稍后重试',
      }
    } catch (error) {
      console.error('[Translate] Failed to translate text:', error)
      return {
        status: 'error' as const,
        message: '翻译失败，请检查网络后重试',
      }
    }
  })

  ipcMain.on('capture-begin-selection', (event) => {
    activeSelectionWebContentsId = event.sender.id
    clearSelectionsExcept(event.sender)
  })

  ipcMain.on('capture-selection-state', (event, payload: { hasSelection: boolean }) => {
    syncSelectionState(event.sender.id, payload.hasSelection)
  })

  ipcMain.on('capture-clear-others', (event) => {
    clearSelectionsExcept(event.sender)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
