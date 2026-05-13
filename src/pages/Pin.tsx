import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'

export default function Pin() {
  const location = useLocation()
  const pinId = useMemo(() => new URLSearchParams(location.search).get('id') ?? '', [location.search])
  const [dataURL, setDataURL] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!pinId) {
        setError('缺少贴图内容标识，请重新创建贴图。')
        return
      }

      const result = await window.electronAPI.getPinWindowData(pinId)
      if (result.status === 'error') {
        setError(result.message)
        return
      }

      setDataURL(result.dataURL)
    }

    void load()
  }, [pinId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void window.electronAPI.closeCurrentWindow()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black/35 p-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-xl">
          <div>{error}</div>
          <button
            type="button"
            className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white"
            onClick={() => void window.electronAPI.closeCurrentWindow()}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative h-screen w-screen overflow-hidden rounded-xl bg-transparent"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={() => void window.electronAPI.closeCurrentWindow()}
    >
      <div
        className="absolute inset-x-2 top-2 z-20 flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2 text-xs text-white backdrop-blur"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="truncate">贴图窗口</div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span>透明度</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              className="w-24 accent-white"
              onChange={(event) => {
                const value = Number(event.target.value)
                setOpacity(value)
                void window.electronAPI.setPinWindowOpacity(value)
              }}
            />
          </label>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-white/15"
            onClick={() => void window.electronAPI.closeCurrentWindow()}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex h-full w-full items-center justify-center p-4">
        {dataURL ? (
          <img
            src={dataURL}
            alt="Pinned screenshot"
            className="max-h-full max-w-full rounded-xl shadow-2xl"
            draggable={false}
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <div className="rounded-xl bg-zinc-950/60 px-4 py-2 text-sm text-white">正在加载贴图...</div>
        )}
      </div>
    </div>
  )
}
