import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, FolderOpen, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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

function toFileURL(filePath: string) {
  return `file://${filePath}`
}

function formatActionLabel(action: CaptureHistoryItem['action']) {
  if (action === 'copy') return '复制'
  if (action === 'save') return '保存'
  return '贴图'
}

export default function History() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CaptureHistoryItem[]>([])
  const [error, setError] = useState('')

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
    <div className="min-h-screen bg-zinc-50 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-zinc-900">最近截图</div>
            <div className="mt-1 text-sm text-zinc-500">管理最近输出的截图结果，支持再次复制、定位文件和删除记录。</div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={16} />
            返回首页
          </button>
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

        {items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
            还没有截图历史。先去截图、保存、复制或贴图一次吧。
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-sm">
                <div className="aspect-[16/10] bg-zinc-100">
                  <img src={toFileURL(item.thumbnailPath)} alt="history thumbnail" className="h-full w-full object-cover" />
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-900">{formatActionLabel(item.action)}</div>
                    <div className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-500">{item.format.toUpperCase()}</div>
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
