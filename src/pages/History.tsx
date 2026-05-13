import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, FolderOpen, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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

function formatActionLabel(action: CaptureHistoryItem['action']) {
  if (action === 'copy') return '复制'
  if (action === 'save') return '保存'
  if (action === 'pin') return '贴图'
  return '确认'
}

export default function History() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CaptureHistoryItem[]>([])
  const [error, setError] = useState('')
  const [isClearing, setIsClearing] = useState(false)

  const loadHistory = async () => {
    try {
      const history = await window.electronAPI.listCaptureHistory()
      setItems(history)
    } catch (loadError) {
      console.error('Failed to load history', loadError)
      setError('读取截图历史失败，请稍后重试。')
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  return (
    <div className="h-screen overflow-y-auto bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eef2ff_24%,#f8fafc_52%,#f8fafc_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-zinc-900">最近截图</div>
            <div className="mt-1 text-sm text-zinc-500">管理最近输出的截图结果，支持再次复制、定位文件、删除和一键清空。</div>
            <div className="mt-3 inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              共 {items.length} 条记录
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={items.length === 0 || isClearing}
              onClick={async () => {
                setError('')
                setIsClearing(true)
                try {
                  const result = await window.electronAPI.clearCaptureHistory()
                  if (result.status === 'error') {
                    setError(result.message ?? '清空历史失败')
                    return
                  }
                  setItems([])
                } catch (clearError) {
                  console.error('Failed to clear capture history', clearError)
                  setError('清空历史失败，请稍后重试。')
                } finally {
                  setIsClearing(false)
                }
              }}
            >
              <Trash2 size={16} />
              {isClearing ? '清空中...' : '一键清空'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50"
              onClick={() => navigate('/')}
            >
              <ArrowLeft size={16} />
              返回首页
            </button>
          </div>
          </div>
        </div>

        {error && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm">{error}</div>}

        {items.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-zinc-200 bg-white/90 p-12 text-center text-sm text-zinc-500 shadow-sm backdrop-blur">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Copy size={22} />
            </div>
            还没有截图历史。先去截图、确认、保存、复制或贴图一次吧。
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:shadow-[0_22px_52px_rgba(15,23,42,0.12)]">
                <div className="relative aspect-[16/10] bg-zinc-100">
                  {item.thumbnailDataURL ? (
                    <img src={item.thumbnailDataURL} alt="history thumbnail" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">暂无预览</div>
                  )}
                  <div className="absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                    {formatActionLabel(item.action)}
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-900">{formatActionLabel(item.action)}</div>
                    <div className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-500">{item.format.toUpperCase()}</div>
                  </div>
                  <div className="text-xs leading-6 text-zinc-500">
                    <div>{new Date(item.createdAt).toLocaleString()}</div>
                    <div>{`${item.width} × ${item.height}`}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                      onClick={async () => {
                        const result = await window.electronAPI.copyHistoryImage(item.id)
                        if (result.status === 'error') {
                          setError(result.message)
                        }
                      }}
                    >
                      <Copy size={12} />
                      再次复制
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                      onClick={async () => {
                        const result = await window.electronAPI.revealFileInFinder(item.filePath)
                        if (result.status === 'error') {
                          setError(result.message)
                        }
                      }}
                    >
                      <FolderOpen size={12} />
                      显示文件
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        const result = await window.electronAPI.deleteCaptureHistory(item.id)
                        if (result.status === 'error') {
                          setError(result.message ?? '删除失败')
                          return
                        }
                        setItems((current) => current.filter((currentItem) => currentItem.id !== item.id))
                      }}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
