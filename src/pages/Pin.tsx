import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Plus, X } from 'lucide-react'

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.1
const WINDOW_PADDING_X = 32
const WINDOW_PADDING_Y = 32
const MIN_WINDOW_WIDTH = 160
const MIN_WINDOW_HEIGHT = 120
const TOOLBAR_HOTZONE_HEIGHT = 56
const CORNER_HOTZONE_SIZE = 28

type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type ResizeInteraction = {
  handle: ResizeHandle
  startX: number
  startY: number
  startBounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

type DragInteraction = {
  startScreenX: number
  startScreenY: number
  startWindowX: number
  startWindowY: number
}

export default function Pin() {
  const location = useLocation()
  const pinId = useMemo(() => new URLSearchParams(location.search).get('id') ?? '', [location.search])
  const [dataURL, setDataURL] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [isToolbarVisible, setIsToolbarVisible] = useState(false)
  const [activeCornerHandle, setActiveCornerHandle] = useState<ResizeHandle | null>(null)
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [resizeInteraction, setResizeInteraction] = useState<ResizeInteraction | null>(null)
  const [dragInteraction, setDragInteraction] = useState<DragInteraction | null>(null)
  const scaleRef = useRef(1)
  const imageNaturalSizeRef = useRef<{ width: number; height: number } | null>(null)
  const pendingBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null)
  const boundsFrameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null)
  const toolbarVisibleRef = useRef(false)
  const activeCornerHandleRef = useRef<ResizeHandle | null>(null)

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    imageNaturalSizeRef.current = imageNaturalSize
  }, [imageNaturalSize])

  const scheduleWindowBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    pendingBoundsRef.current = bounds
    if (boundsFrameRef.current !== null) {
      return
    }

    boundsFrameRef.current = window.requestAnimationFrame(() => {
      boundsFrameRef.current = null
      const nextBounds = pendingBoundsRef.current
      pendingBoundsRef.current = null
      if (!nextBounds) {
        return
      }

      void window.electronAPI.setCurrentWindowBounds(nextBounds)
    })
  }, [])

  const scheduleWindowResize = useCallback((size: { width: number; height: number }) => {
    pendingResizeRef.current = size
    if (resizeFrameRef.current !== null) {
      return
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const nextSize = pendingResizeRef.current
      pendingResizeRef.current = null
      if (!nextSize) {
        return
      }

      void window.electronAPI.resizeCurrentWindow(nextSize)
    })
  }, [])

  const scheduleWindowMove = useCallback((position: { x: number; y: number }) => {
    pendingMoveRef.current = position
    if (moveFrameRef.current !== null) {
      return
    }

    moveFrameRef.current = window.requestAnimationFrame(() => {
      moveFrameRef.current = null
      const nextPosition = pendingMoveRef.current
      pendingMoveRef.current = null
      if (!nextPosition) {
        return
      }

      void window.electronAPI.moveCurrentWindow(nextPosition)
    })
  }, [])

  const updateScaleFromBounds = useCallback((width: number, height: number, baseSize?: { width: number; height: number } | null) => {
    const size = baseSize ?? imageNaturalSize
    if (!size) {
      return
    }

    const contentWidth = Math.max(1, width - WINDOW_PADDING_X)
    const contentHeight = Math.max(1, height - WINDOW_PADDING_Y)
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(contentWidth / size.width, contentHeight / size.height)),
    )
    const normalizedScale = Number(nextScale.toFixed(2))
    if (Math.abs(normalizedScale - scaleRef.current) >= 0.01) {
      scaleRef.current = normalizedScale
      setScale(normalizedScale)
    }
  }, [imageNaturalSize])

  const applyScale = useCallback(async (nextScale: number, baseSize?: { width: number; height: number } | null) => {
    const normalizedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(nextScale.toFixed(2))))
    if (Math.abs(normalizedScale - scaleRef.current) >= 0.01) {
      scaleRef.current = normalizedScale
      setScale(normalizedScale)
    }

    const size = baseSize ?? imageNaturalSizeRef.current
    if (!size) {
      return
    }

    scheduleWindowResize({
      width: size.width * normalizedScale + WINDOW_PADDING_X,
      height: size.height * normalizedScale + WINDOW_PADDING_Y,
    })
  }, [scheduleWindowResize])

  useEffect(() => {
    if (!resizeInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.screenX - resizeInteraction.startX
      const dy = event.screenY - resizeInteraction.startY
      const { startBounds, handle } = resizeInteraction

      let nextX = startBounds.x
      let nextY = startBounds.y
      let nextWidth = startBounds.width
      let nextHeight = startBounds.height

      if (handle.includes('left')) {
        nextX = startBounds.x + dx
        nextWidth = startBounds.width - dx
        if (nextWidth < MIN_WINDOW_WIDTH) {
          nextX -= MIN_WINDOW_WIDTH - nextWidth
          nextWidth = MIN_WINDOW_WIDTH
        }
      }

      if (handle.includes('right')) {
        nextWidth = Math.max(MIN_WINDOW_WIDTH, startBounds.width + dx)
      }

      if (handle.includes('top')) {
        nextY = startBounds.y + dy
        nextHeight = startBounds.height - dy
        if (nextHeight < MIN_WINDOW_HEIGHT) {
          nextY -= MIN_WINDOW_HEIGHT - nextHeight
          nextHeight = MIN_WINDOW_HEIGHT
        }
      }

      if (handle.includes('bottom')) {
        nextHeight = Math.max(MIN_WINDOW_HEIGHT, startBounds.height + dy)
      }

      updateScaleFromBounds(nextWidth, nextHeight, imageNaturalSizeRef.current)
      scheduleWindowBounds({
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      })
    }

    const handlePointerUp = () => {
      setResizeInteraction(null)
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)

    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [resizeInteraction, scheduleWindowBounds, updateScaleFromBounds])

  useEffect(() => {
    if (!dragInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.screenX - dragInteraction.startScreenX
      const dy = event.screenY - dragInteraction.startScreenY
      scheduleWindowMove({
        x: dragInteraction.startWindowX + dx,
        y: dragInteraction.startWindowY + dy,
      })
    }

    const handlePointerUp = () => {
      setDragInteraction(null)
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)

    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [dragInteraction, scheduleWindowMove])

  useEffect(() => {
    return () => {
      if (boundsFrameRef.current !== null) {
        window.cancelAnimationFrame(boundsFrameRef.current)
      }
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current)
      }
    }
  }, [])

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
        return
      }

      if ((event.metaKey || event.ctrlKey) && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        void applyScale(scale + SCALE_STEP)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault()
        void applyScale(scale - SCALE_STEP)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault()
        void applyScale(1)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [applyScale])

  const handleWheelZoom = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!imageNaturalSizeRef.current) {
      return
    }

    event.preventDefault()
    const delta = event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP
    void applyScale(scaleRef.current + delta)
  }, [applyScale])

  const handleResizeStart = useCallback((handle: ResizeHandle, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!toolbarVisibleRef.current) {
      toolbarVisibleRef.current = true
      setIsToolbarVisible(true)
    }
    setResizeInteraction({
      handle,
      startX: event.screenX,
      startY: event.screenY,
      startBounds: {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      },
    })
  }, [])

  const handleRootPointerMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY, currentTarget } = event
    const rect = currentTarget.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    const nearTop = localY <= TOOLBAR_HOTZONE_HEIGHT
    const nearLeft = localX <= CORNER_HOTZONE_SIZE
    const nearRight = rect.width - localX <= CORNER_HOTZONE_SIZE
    const nearBottom = rect.height - localY <= CORNER_HOTZONE_SIZE
    const nextToolbarVisible = Boolean(nearTop || resizeInteraction)
    if (toolbarVisibleRef.current !== nextToolbarVisible) {
      toolbarVisibleRef.current = nextToolbarVisible
      setIsToolbarVisible(nextToolbarVisible)
    }

    if (nearTop && nearLeft) {
      if (activeCornerHandleRef.current !== 'top-left') {
        activeCornerHandleRef.current = 'top-left'
        setActiveCornerHandle('top-left')
      }
      return
    }
    if (nearTop && nearRight) {
      if (activeCornerHandleRef.current !== 'top-right') {
        activeCornerHandleRef.current = 'top-right'
        setActiveCornerHandle('top-right')
      }
      return
    }
    if (nearBottom && nearLeft) {
      if (activeCornerHandleRef.current !== 'bottom-left') {
        activeCornerHandleRef.current = 'bottom-left'
        setActiveCornerHandle('bottom-left')
      }
      return
    }
    if (nearBottom && nearRight) {
      if (activeCornerHandleRef.current !== 'bottom-right') {
        activeCornerHandleRef.current = 'bottom-right'
        setActiveCornerHandle('bottom-right')
      }
      return
    }
    const fallbackHandle = resizeInteraction?.handle ?? null
    if (activeCornerHandleRef.current !== fallbackHandle) {
      activeCornerHandleRef.current = fallbackHandle
      setActiveCornerHandle(fallbackHandle)
    }
  }, [resizeInteraction])

  const handleRootPointerLeave = useCallback(() => {
    if (!resizeInteraction && !dragInteraction) {
      if (toolbarVisibleRef.current) {
        toolbarVisibleRef.current = false
        setIsToolbarVisible(false)
      }
      if (activeCornerHandleRef.current !== null) {
        activeCornerHandleRef.current = null
        setActiveCornerHandle(null)
      }
    }
  }, [dragInteraction, resizeInteraction])

  const handleContentDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeInteraction) {
      return
    }

    setDragInteraction({
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
    })
  }, [resizeInteraction])

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
      className="relative h-screen w-screen overflow-hidden bg-transparent"
      onDoubleClick={() => void window.electronAPI.closeCurrentWindow()}
      onMouseMove={handleRootPointerMove}
      onMouseLeave={handleRootPointerLeave}
    >
      <div
        className={`absolute inset-x-2 top-2 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 px-3.5 py-2.5 text-xs text-white shadow-[0_16px_36px_rgba(15,23,42,0.28)] backdrop-blur transition-all ${
          isToolbarVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 truncate">
          <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.7)]" />
          <span className="font-medium tracking-[0.02em]">贴图窗口</span>
        </div>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/10 px-1.5 py-1">
            <button
              type="button"
              className="rounded-lg p-1.5 transition hover:bg-white/15 disabled:opacity-40"
              disabled={scale <= MIN_SCALE}
              onClick={() => void applyScale(scale - SCALE_STEP)}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="min-w-14 rounded-lg px-2 py-1.5 text-[11px] font-medium hover:bg-white/10"
              onClick={() => void applyScale(1)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 transition hover:bg-white/15 disabled:opacity-40"
              disabled={scale >= MAX_SCALE}
              onClick={() => void applyScale(scale + SCALE_STEP)}
            >
              <Plus size={14} />
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-zinc-200">透明度</span>
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
            className="rounded-xl border border-white/10 bg-white/5 p-2 transition hover:bg-white/15"
            onClick={() => void window.electronAPI.closeCurrentWindow()}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div
        className={`flex h-full w-full items-center justify-center ${dragInteraction ? 'cursor-grabbing' : 'cursor-grab'}`}
        onWheel={handleWheelZoom}
        onMouseDown={handleContentDragStart}
      >
        {dataURL ? (
          <img
            src={dataURL}
            alt="Pinned screenshot"
            className="block"
            draggable={false}
            style={{
              pointerEvents: 'none',
              width: imageNaturalSize ? imageNaturalSize.width * scale : undefined,
              height: imageNaturalSize ? imageNaturalSize.height * scale : undefined,
              maxWidth: 'none',
              maxHeight: 'none',
              willChange: resizeInteraction ? 'width, height' : 'auto',
            }}
            onLoad={(event) => {
              const target = event.currentTarget
              const naturalWidth = target.naturalWidth || target.width
              const naturalHeight = target.naturalHeight || target.height
              const nextSize = { width: naturalWidth, height: naturalHeight }
              setImageNaturalSize(nextSize)
              void applyScale(scale, nextSize)
            }}
          />
        ) : (
          <div className="rounded-xl bg-zinc-950/60 px-4 py-2 text-sm text-white">正在加载贴图...</div>
        )}
      </div>

      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as ResizeHandle[]).map((handle) => {
        const positionClassName = handle === 'top-left'
          ? 'left-0 top-0 cursor-nwse-resize'
          : handle === 'top-right'
            ? 'right-0 top-0 cursor-nesw-resize'
            : handle === 'bottom-left'
              ? 'bottom-0 left-0 cursor-nesw-resize'
              : 'bottom-0 right-0 cursor-nwse-resize'

        return (
          <button
            key={handle}
            type="button"
            aria-label={`resize-${handle}`}
            className={`absolute z-30 h-4 w-4 rounded-full border border-white/70 bg-zinc-950/70 shadow-[0_8px_18px_rgba(15,23,42,0.35)] transition-all ${
              positionClassName
            } ${(activeCornerHandle === handle || Boolean(resizeInteraction)) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseDown={(event) => handleResizeStart(handle, event)}
          />
        )
      })}
    </div>
  )
}
