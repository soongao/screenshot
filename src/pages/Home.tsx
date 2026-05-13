import { useEffect, useMemo, useState } from 'react'
import { Keyboard, MonitorUp, ScanText, Scissors, Settings2, X } from 'lucide-react'
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
  ocrLanguages: 'eng' | 'chi_sim' | 'eng+chi_sim'
  pinWindowShadow: boolean
  pinWindowOpacity: number
}

type ShortcutField = 'startCapture' | 'startOcr' | 'startTranslate' | 'forceExit'

type CaptureHistoryItem = {
  id: string
  filePath: string
  thumbnailPath: string
  createdAt: number
  action: 'copy' | 'save' | 'pin'
  format: 'png' | 'jpg'
  width: number
  height: number
}

const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
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
        setRecentHistory(history.slice(0, 5))
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
      setSettingsSuccess('快捷键已保存并立即生效。')
    } catch (error) {
      console.error('Failed to save shortcut settings', error)
      setSettingsError('保存快捷键失败，请重试。')
    } finally {
      setIsSavingSettings(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Scissors size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-zinc-900">截图工具</h1>
                <p className="mt-1 text-zinc-500">从应用主界面选择功能，用快捷键快速进入对应截图模式。</p>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm transition hover:border-blue-300 hover:text-blue-600"
              onClick={openSettings}
            >
              <Settings2 size={16} />
              设置
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {featureCards.map((feature) => (
              <button
                key={feature.key}
                type="button"
                className={`rounded-2xl border p-5 text-left transition ${
                  feature.enabled
                    ? 'border-zinc-200 bg-white hover:border-blue-300 hover:shadow-md'
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
                  <div className={`rounded-xl border border-zinc-100 bg-white p-2 shadow-sm ${feature.iconClassName}`}>
                    {feature.icon}
                  </div>
                  {!feature.enabled && (
                    <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs text-zinc-600">开发中</span>
                  )}
                </div>
                <div className="text-lg font-medium text-zinc-900">{feature.title}</div>
                <div className="mt-2 text-sm leading-6 text-zinc-500">{feature.description}</div>
                <div className="mt-4 inline-flex items-center rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">
                  {feature.shortcut}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
            <div className="mb-4 flex items-center gap-3 text-zinc-900">
              <MonitorUp size={20} className="text-blue-600" />
              <h2 className="text-xl font-semibold">推荐使用方式</h2>
            </div>
            <div className="space-y-4 text-sm leading-7 text-zinc-600">
              <div>1. 打开应用主界面，先确认你要进入的截图能力。</div>
              <div>2. 直接按快捷键进入截图，不在截图画布顶部再切模式。</div>
              <div>3. `翻译` 快捷键会直接进入自动识别并翻译流程，语言使用当前设置。</div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
            <div className="mb-4 flex items-center gap-3 text-zinc-900">
              <ScanText size={20} className="text-purple-600" />
              <h2 className="text-xl font-semibold">当前能力</h2>
            </div>
            <div className="space-y-3 text-sm text-zinc-600">
              <div>统一截图入口</div>
              <div>窗口悬停吸附预览</div>
              <div>基础标注与文字编辑</div>
              <div>独立 OCR 快捷触发</div>
              <div>独立翻译快捷触发</div>
              <div>OCR 结果面板展示</div>
              <div>源语言/目标语言选择</div>
              <div>复制、保存、撤销重做</div>
              <div>快捷键自定义</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xl font-semibold text-zinc-900">最近截图</div>
              <div className="mt-1 text-sm text-zinc-500">展示最近 5 条已输出的截图结果，可进入完整历史页面继续管理。</div>
            </div>
            <button
              type="button"
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              onClick={() => navigate('/history')}
            >
              查看全部
            </button>
          </div>

          {recentHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-10 text-center text-sm text-zinc-500">
              还没有最近截图。完成一次复制、保存或贴图后会显示在这里。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-5">
              {recentHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-50 text-left shadow-sm transition hover:border-blue-300 hover:bg-white hover:shadow-md"
                  onClick={() => navigate('/history')}
                >
                  <div className="aspect-[4/3] bg-zinc-100">
                    <img src={`file://${item.thumbnailPath}`} alt="recent capture" className="h-full w-full object-cover" />
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-medium text-zinc-900">{new Date(item.createdAt).toLocaleString()}</div>
                    <div className="mt-1 text-xs text-zinc-500">{`${item.width} × ${item.height}`}</div>
                    <div className="mt-2 text-[11px] text-zinc-400">{item.action === 'copy' ? '复制' : item.action === 'save' ? '保存' : '贴图'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl">
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

            <div className="mt-5 flex min-h-6 items-center text-sm">
              {isLoadingSettings && <div className="text-zinc-500">正在读取设置...</div>}
              {!isLoadingSettings && settingsError && <div className="text-red-600">{settingsError}</div>}
              {!isLoadingSettings && !settingsError && settingsSuccess && <div className="text-green-600">{settingsSuccess}</div>}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
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
