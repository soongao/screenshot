import { useEffect, useMemo, useState } from 'react'
import { History, Keyboard, MonitorUp, ScanText, Scissors, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

type ShortcutSettings = {
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
}

type ShortcutField = 'startCapture' | 'startOcr' | 'startTranslate' | 'forceExit'

type CaptureHistoryItem = {
  id: string
  filePath: string
  thumbnailPath: string
  thumbnailDataURL: string
  createdAt: number
  action: 'copy' | 'save' | 'pin' | 'confirm'
  format: 'png' | 'jpg'
  width: number
  height: number
}

function formatHistoryActionLabel(action: CaptureHistoryItem['action']) {
  if (action === 'copy') return '复制'
  if (action === 'save') return '保存'
  if (action === 'pin') return '贴图'
  return '确认'
}

const CAPABILITY_LABELS = [
  '统一截图入口',
  '窗口悬停吸附',
  '文字与形状标注',
  'OCR 结果面板',
  '翻译快捷触发',
  '贴图与历史记录',
  '快捷键自定义',
  '复制 / 保存 / 撤销重做',
]

const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  startCapture: 'CommandOrControl+Alt+A',
  startOcr: 'CommandOrControl+Alt+O',
  startTranslate: 'CommandOrControl+Alt+T',
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

const SHORTCUT_META: Record<ShortcutField, { title: string; description: string }> = {
  startCapture: {
    title: '开始截图',
    description: '从任意位置快速进入截图状态。',
  },
  startOcr: {
    title: '直接 OCR',
    description: '进入截图后，框选完成立即自动识别文字。',
  },
  startTranslate: {
    title: '直接翻译',
    description: '进入截图后，框选完成立即 OCR 并翻译。',
  },
  forceExit: {
    title: '强制关闭程序',
    description: '立即结束整个应用进程。',
  },
}

const LANGUAGE_LABELS = {
  auto: '自动检测',
  zh: '中文',
  en: '英文',
} as const

const OCR_LANGUAGE_LABELS = {
  eng: '英文',
  chi_sim: '简体中文',
  'eng+chi_sim': '中英混合',
} as const

const ANNOTATION_COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#5856d6', '#ff2d55', '#111827']

function formatShortcutLabel(accelerator: string) {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return 'Cmd/Ctrl'
      if (part === 'Escape') return 'Esc'
      if (part === 'ArrowUp') return 'Up'
      if (part === 'ArrowDown') return 'Down'
      if (part === 'ArrowLeft') return 'Left'
      if (part === 'ArrowRight') return 'Right'
      return part
    })
    .join(' + ')
}

function getAcceleratorFromEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const modifiers: string[] = []

  if (event.metaKey || event.ctrlKey) {
    modifiers.push('CommandOrControl')
  }
  if (event.altKey) {
    modifiers.push('Alt')
  }
  if (event.shiftKey) {
    modifiers.push('Shift')
  }

  const key = event.key
  const upperKey = key.toUpperCase()

  let normalizedKey = ''
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) {
    return null
  }

  if (/^[A-Z]$/.test(upperKey) || /^[0-9]$/.test(key)) {
    normalizedKey = upperKey
  } else if (/^F([1-9]|1[0-2])$/.test(upperKey)) {
    normalizedKey = upperKey
  } else {
    const keyMap: Record<string, string> = {
      Escape: 'Escape',
      Enter: 'Enter',
      Space: 'Space',
      ' ': 'Space',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
    }
    normalizedKey = keyMap[key] ?? ''
  }

  if (!normalizedKey) {
    return null
  }

  return [...modifiers, normalizedKey].join('+')
}

export default function Home() {
  const navigate = useNavigate()
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS)
  const [draftSettings, setDraftSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [recentHistory, setRecentHistory] = useState<CaptureHistoryItem[]>([])

  useEffect(() => {
    const loadShortcutSettings = async () => {
      try {
        const settings = await window.electronAPI.getShortcutSettings()
        setShortcutSettings(settings)
        setDraftSettings(settings)
        const history = await window.electronAPI.listCaptureHistory()
        setRecentHistory(history.slice(0, settings.historyLimit))
      } catch (error) {
        console.error('Failed to load shortcut settings', error)
        setSettingsError('读取快捷键设置失败，已使用默认配置展示。')
      } finally {
        setIsLoadingSettings(false)
      }
    }

    void loadShortcutSettings()
  }, [])

  const featureCards = useMemo(() => [
    {
      key: 'region' as const,
      title: '截图',
      description: '进入统一截图入口，支持窗口悬停吸附与手动画框两种方式。',
      shortcut: formatShortcutLabel(shortcutSettings.startCapture),
      icon: <Scissors size={20} />,
      iconClassName: 'text-blue-600',
      enabled: true,
    },
    {
      key: 'ocr' as const,
      title: 'OCR',
      description: '直接进入 OCR 截图流程，框选完成后自动识别并展示结果。',
      shortcut: formatShortcutLabel(shortcutSettings.startOcr),
      icon: <ScanText size={20} />,
      iconClassName: 'text-purple-600',
      enabled: true,
    },
    {
      key: 'translate' as const,
      title: '翻译',
      description: '直接进入翻译截图流程，框选完成后自动识别并翻译。',
      shortcut: formatShortcutLabel(shortcutSettings.startTranslate),
      icon: <ScanText size={20} />,
      iconClassName: 'text-emerald-600',
      enabled: true,
    },
  ], [shortcutSettings.startCapture, shortcutSettings.startOcr, shortcutSettings.startTranslate])

  const openSettings = () => {
    setDraftSettings(shortcutSettings)
    setSettingsError('')
    setSettingsSuccess('')
    setIsSettingsOpen(true)
  }

  const closeSettings = () => {
    setIsSettingsOpen(false)
    setDraftSettings(shortcutSettings)
    setSettingsError('')
    setSettingsSuccess('')
  }

  const handleShortcutKeyDown = (field: ShortcutField, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    setSettingsError('')
    setSettingsSuccess('')

    if (event.key === 'Escape') {
      closeSettings()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'backspace') {
      setDraftSettings((current) => ({
        ...current,
        [field]: '',
      }))
      return
    }

    const accelerator = getAcceleratorFromEvent(event)
    if (!accelerator) {
      setSettingsError('请按包含主键的组合键，例如 Cmd/Ctrl + Shift + A。')
      return
    }

    setDraftSettings((current) => ({
      ...current,
      [field]: accelerator,
    }))
  }

  const handleResetDefaults = () => {
    setDraftSettings(DEFAULT_SHORTCUT_SETTINGS)
    setSettingsError('')
    setSettingsSuccess('')
  }

  const handleSaveSettings = async () => {
    setIsSavingSettings(true)
    setSettingsError('')
    setSettingsSuccess('')

    try {
      const result = await window.electronAPI.updateShortcutSettings(draftSettings)
      if (result.status === 'error') {
        setSettingsError(result.message)
        return
      }

      setShortcutSettings(result.settings)
      setDraftSettings(result.settings)
      const history = await window.electronAPI.listCaptureHistory()
      setRecentHistory(history.slice(0, result.settings.historyLimit))
      setSettingsSuccess('快捷键已保存并立即生效。')
    } catch (error) {
      console.error('Failed to save shortcut settings', error)
      setSettingsError('保存快捷键失败，请重试。')
    } finally {
      setIsSavingSettings(false)
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eef2ff_24%,#f8fafc_52%,#f8fafc_100%)] px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="relative overflow-hidden rounded-[32px] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-blue-200/45 blur-3xl" />
          <div className="pointer-events-none absolute right-10 top-10 h-24 w-24 rounded-full bg-violet-200/35 blur-2xl" />
          <div className="relative z-10 mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-lg shadow-blue-500/20">
                <Scissors size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-zinc-900">截图工具</h1>
                <p className="mt-1 max-w-2xl text-zinc-600">从主界面快速进入截图、OCR、翻译与历史管理，让操作路径更接近成熟截图工具。</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-blue-700">区域截图</span>
                  <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-violet-700">OCR</span>
                  <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">翻译</span>
                  <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-amber-700">历史记录</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/80 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-600"
                onClick={() => navigate('/history')}
              >
                <History size={16} />
                历史记录
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/80 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-600"
                onClick={openSettings}
              >
                <Settings2 size={16} />
                设置
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {featureCards.map((feature) => (
              <button
                key={feature.key}
                type="button"
                className={`group rounded-[28px] border p-5 text-left transition ${
                  feature.enabled
                    ? 'border-white/80 bg-white/90 shadow-sm hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_18px_45px_rgba(37,99,235,0.14)]'
                    : 'border-zinc-100 bg-zinc-50/80 hover:border-zinc-200'
                }`}
                onClick={() => {
                  if (feature.key === 'ocr') {
                    void window.electronAPI.startOcrCapture()
                    return
                  }
                  if (feature.key === 'translate') {
                    void window.electronAPI.startTranslateCapture()
                    return
                  }
                  void window.electronAPI.startCapture('region')
                }}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className={`rounded-2xl border border-white/80 bg-white p-3 shadow-sm transition group-hover:scale-105 ${feature.iconClassName}`}>
                    {feature.icon}
                  </div>
                  {!feature.enabled && (
                    <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs text-zinc-600">开发中</span>
                  )}
                </div>
                <div className="text-lg font-medium text-zinc-900">{feature.title}</div>
                <div className="mt-2 text-sm leading-6 text-zinc-500">{feature.description}</div>
                <div className="mt-5 inline-flex items-center rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
                  {feature.shortcut}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-white/70 bg-white/85 p-8 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3 text-zinc-900">
              <MonitorUp size={20} className="text-blue-600" />
              <h2 className="text-xl font-semibold">推荐使用方式</h2>
            </div>
            <div className="space-y-4 text-sm leading-7 text-zinc-600">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">1. 先在主界面选择能力，确认你要进入的是截图、OCR 还是翻译。</div>
              <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">2. 平时优先使用快捷键直达，不需要在截图画布顶部切换模式。</div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">3. `翻译` 快捷键会自动走 OCR + 翻译流程，并使用当前设置里的默认语言。</div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/85 p-8 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3 text-zinc-900">
              <ScanText size={20} className="text-purple-600" />
              <h2 className="text-xl font-semibold">当前能力</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-zinc-600">
              {CAPABILITY_LABELS.map((label) => (
                <div key={label} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2">
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/70 bg-white/85 p-8 shadow-sm backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xl font-semibold text-zinc-900">最近截图</div>
              <div className="mt-1 text-sm text-zinc-500">{`展示最近 ${shortcutSettings.historyLimit} 条已输出的截图结果，可进入完整历史页面继续管理。`}</div>
            </div>
            <button
              type="button"
              className="rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-blue-200 hover:text-blue-600"
              onClick={() => navigate('/history')}
            >
              查看全部
            </button>
          </div>

          {recentHistory.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-12 text-center text-sm text-zinc-500">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                <History size={20} />
              </div>
              还没有最近截图。完成一次确认、复制、保存或贴图后会显示在这里。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-5">
              {recentHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="overflow-hidden rounded-[24px] border border-zinc-100 bg-zinc-50 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:bg-white hover:shadow-[0_16px_34px_rgba(15,23,42,0.12)]"
                  onClick={() => navigate('/history')}
                >
                  <div className="relative aspect-[4/3] bg-zinc-100">
                    {item.thumbnailDataURL ? (
                      <img src={item.thumbnailDataURL} alt="recent capture" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">暂无预览</div>
                    )}
                    <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
                      {formatHistoryActionLabel(item.action)}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-medium text-zinc-900">{new Date(item.createdAt).toLocaleString()}</div>
                    <div className="mt-1 text-xs text-zinc-500">{`${item.width} × ${item.height}`}</div>
                    <div className="mt-2 text-[11px] text-zinc-400">{item.format.toUpperCase()}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/30 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto flex max-h-[calc(100vh-48px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-zinc-900">
                  <Keyboard size={18} className="text-blue-600" />
                  <h2 className="text-xl font-semibold">截图偏好设置</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  点击输入框后直接按下新的组合键。你也可以在这里配置默认导出格式、关闭行为、OCR 语言与贴图偏好。
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
                onClick={closeSettings}
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-6">
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">快捷键</div>
                <div className="space-y-4">
              {(Object.keys(SHORTCUT_META) as ShortcutField[]).map((field) => (
                <div key={field} className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                  <div className="mb-2 text-sm font-medium text-zinc-900">{SHORTCUT_META[field].title}</div>
                  <div className="mb-3 text-sm leading-6 text-zinc-500">{SHORTCUT_META[field].description}</div>
                  <input
                    readOnly
                    value={draftSettings[field] ? formatShortcutLabel(draftSettings[field]) : ''}
                    placeholder="点击后按下组合键"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    onKeyDown={(event) => handleShortcutKeyDown(field, event)}
                  />
                  <div className="mt-2 text-xs text-zinc-400">
                    当前值：{formatShortcutLabel(shortcutSettings[field])}
                  </div>
                </div>
              ))}
                </div>
              </div>

              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">输出与识别偏好</div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-2 text-sm font-medium text-zinc-900">默认翻译语言</div>
                    <div className="mb-3 text-sm leading-6 text-zinc-500">用于“直接翻译”快捷键进入后的默认源语言和目标语言。</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">源语言</div>
                        <select
                          value={draftSettings.translationSourceLang}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            translationSourceLang: event.target.value as ShortcutSettings['translationSourceLang'],
                          }))}
                        >
                          <option value="auto">{LANGUAGE_LABELS.auto}</option>
                          <option value="zh">{LANGUAGE_LABELS.zh}</option>
                          <option value="en">{LANGUAGE_LABELS.en}</option>
                        </select>
                      </label>
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">目标语言</div>
                        <select
                          value={draftSettings.translationTargetLang}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            translationTargetLang: event.target.value as ShortcutSettings['translationTargetLang'],
                          }))}
                        >
                          <option value="zh">{LANGUAGE_LABELS.zh}</option>
                          <option value="en">{LANGUAGE_LABELS.en}</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-2 text-sm font-medium text-zinc-900">默认导出与 OCR</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">默认保存格式</div>
                        <select
                          value={draftSettings.defaultExportFormat}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            defaultExportFormat: event.target.value as ShortcutSettings['defaultExportFormat'],
                          }))}
                        >
                          <option value="png">PNG</option>
                          <option value="jpg">JPG</option>
                        </select>
                      </label>
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">OCR 默认语言</div>
                        <select
                          value={draftSettings.ocrLanguages}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            ocrLanguages: event.target.value as ShortcutSettings['ocrLanguages'],
                          }))}
                        >
                          <option value="eng">{OCR_LANGUAGE_LABELS.eng}</option>
                          <option value="chi_sim">{OCR_LANGUAGE_LABELS.chi_sim}</option>
                          <option value="eng+chi_sim">{OCR_LANGUAGE_LABELS['eng+chi_sim']}</option>
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm text-zinc-700">
                      <div className="mb-2 text-xs text-zinc-500">历史记录保存上限</div>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={draftSettings.historyLimit}
                        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                        onChange={(event) => setDraftSettings((current) => ({
                          ...current,
                          historyLimit: Math.min(200, Math.max(1, Number(event.target.value) || 5)),
                        }))}
                      />
                      <div className="mt-2 text-xs text-zinc-400">默认保存 5 张，超出后会自动清理更早的历史记录。</div>
                    </label>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-2 text-sm font-medium text-zinc-900">默认标注样式</div>
                    <div className="mb-3 text-sm leading-6 text-zinc-500">新进入截图时，工具栏默认使用这里的颜色、线宽和字号。</div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-16 shrink-0 text-xs text-zinc-500">颜色</div>
                        <div className="flex flex-wrap items-center gap-2">
                          {ANNOTATION_COLORS.map((presetColor) => {
                            const isActive = draftSettings.annotationColor.toLowerCase() === presetColor.toLowerCase()
                            return (
                              <button
                                key={presetColor}
                                type="button"
                                aria-label={`设置默认颜色 ${presetColor}`}
                                className={`h-7 w-7 rounded-full border transition ${isActive ? 'scale-110 border-zinc-900 shadow-sm ring-2 ring-zinc-200' : 'border-zinc-200 hover:border-zinc-400'}`}
                                style={{ backgroundColor: presetColor }}
                                onClick={() => setDraftSettings((current) => ({
                                  ...current,
                                  annotationColor: presetColor,
                                }))}
                              />
                            )
                          })}
                          <input
                            type="color"
                            value={draftSettings.annotationColor}
                            className="h-8 w-10 rounded-lg border border-zinc-200 bg-white p-1"
                            onChange={(event) => setDraftSettings((current) => ({
                              ...current,
                              annotationColor: event.target.value,
                            }))}
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-zinc-700">
                          <div className="mb-2 text-xs text-zinc-500">默认线宽</div>
                          <select
                            value={draftSettings.annotationStrokeWidth}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                            onChange={(event) => setDraftSettings((current) => ({
                              ...current,
                              annotationStrokeWidth: Number(event.target.value),
                            }))}
                          >
                            {[2, 4, 6, 8, 12].map((size) => (
                              <option key={size} value={size}>{`${size}px`}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm text-zinc-700">
                          <div className="mb-2 text-xs text-zinc-500">默认字号</div>
                          <select
                            value={draftSettings.annotationFontSize}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                            onChange={(event) => setDraftSettings((current) => ({
                              ...current,
                              annotationFontSize: Number(event.target.value),
                            }))}
                          >
                            {[14, 18, 20, 24, 28, 32].map((size) => (
                              <option key={size} value={size}>{`${size}px`}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-2 text-sm font-medium text-zinc-900">工具栏显示</div>
                    <div className="mb-3 text-sm leading-6 text-zinc-500">控制截图工具栏的默认透明度和整体大小。</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">{`工具栏透明度：${Math.round(draftSettings.toolbarOpacity * 100)}%`}</div>
                        <input
                          type="range"
                          min={0.7}
                          max={1}
                          step={0.02}
                          value={draftSettings.toolbarOpacity}
                          className="w-full accent-blue-600"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            toolbarOpacity: Number(event.target.value),
                          }))}
                        />
                      </label>
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">工具栏大小</div>
                        <select
                          value={draftSettings.toolbarScale}
                          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            toolbarScale: Number(event.target.value),
                          }))}
                        >
                          <option value={0.9}>紧凑</option>
                          <option value={1}>默认</option>
                          <option value={1.1}>偏大</option>
                          <option value={1.2}>大号</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-3 text-sm font-medium text-zinc-900">动作后的关闭策略</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={draftSettings.closeAfterCopy}
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            closeAfterCopy: event.target.checked,
                          }))}
                        />
                        复制后自动关闭
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={draftSettings.closeAfterSave}
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            closeAfterSave: event.target.checked,
                          }))}
                        />
                        保存后自动关闭
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={draftSettings.closeAfterPin}
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            closeAfterPin: event.target.checked,
                          }))}
                        />
                        贴图后自动关闭
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="mb-3 text-sm font-medium text-zinc-900">贴图窗口偏好</div>
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={draftSettings.pinWindowShadow}
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            pinWindowShadow: event.target.checked,
                          }))}
                        />
                        贴图窗口保留阴影
                      </label>
                      <label className="text-sm text-zinc-700">
                        <div className="mb-2 text-xs text-zinc-500">默认透明度：{Math.round(draftSettings.pinWindowOpacity * 100)}%</div>
                        <input
                          type="range"
                          min={0.2}
                          max={1}
                          step={0.05}
                          value={draftSettings.pinWindowOpacity}
                          className="w-full accent-blue-600"
                          onChange={(event) => setDraftSettings((current) => ({
                            ...current,
                            pinWindowOpacity: Number(event.target.value),
                          }))}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <div className="mt-5 flex min-h-6 shrink-0 items-center text-sm">
              {isLoadingSettings && <div className="text-zinc-500">正在读取设置...</div>}
              {!isLoadingSettings && settingsError && <div className="text-red-600">{settingsError}</div>}
              {!isLoadingSettings && !settingsError && settingsSuccess && <div className="text-green-600">{settingsSuccess}</div>}
            </div>

            <div className="mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                onClick={handleResetDefaults}
              >
                恢复默认
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  onClick={closeSettings}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingSettings}
                  onClick={() => void handleSaveSettings()}
                >
                  {isSavingSettings ? '保存中...' : '保存并生效'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
