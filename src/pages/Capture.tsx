import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Image as KonvaImage, Group, Circle, Text, Line, Arrow } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import { useLocation } from 'react-router-dom'
import { useEditorStore } from '@/modules/editor/store'
import type { Point, Shape, ToolType } from '@/modules/editor/types'
import { Check, X, Undo2, Redo2, Square, Circle as CircleIcon, ArrowUpRight, Pen, Type, BoxSelect, Download, Copy, ScanText, Minus, GripHorizontal, Pin as PinIcon } from 'lucide-react'
import Tesseract from 'tesseract.js'

type SelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

type FeedbackState = {
  tone: 'success' | 'error' | 'info' | 'actionable'
  message: string
  actionLabel?: string
  onAction?: () => void
}

type CaptureErrorState = {
  title: string
  detail: string
}

type TextRect = {
  x: number
  y: number
  width: number
  height: number
}

type TextInteractionState = {
  shapeId: string
  mode: 'move' | 'resize'
  startX: number
  startY: number
  rect: TextRect
}

type SelectionInteractionState = {
  startX: number
  startY: number
  origin: SelectionRect
  shapesSnapshot: typeof useEditorStore extends { getState: () => infer S }
    ? S extends { shapes: infer T }
      ? T
      : never
    : never
}

type SelectionResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

type SelectionResizeInteractionState = {
  startX: number
  startY: number
  origin: SelectionRect
  handle: SelectionResizeHandle
}

type ShapeInteractionState = {
  shapeId: string
  startX: number
  startY: number
  points: Point[]
}

type ShapeResizeInteractionState = {
  shapeId: string
  startX: number
  startY: number
  handle: SelectionResizeHandle
  originBounds: SelectionRect
  originPoints: Point[]
}

type ToolbarDragState = {
  startX: number
  startY: number
  originLeft: number
  originTop: number
}

type CaptureWindowCandidate = {
  id: number
  ownerName: string
  name: string
  displayId: string
  bounds: SelectionRect
}

type WindowHoverMode = 'candidate' | 'drag-select'

type CaptureAppSettings = {
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

type DesktopVideoTrackConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
  }
}

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
] as const

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#5856d6', '#ff2d55', '#111827']

const TOOL_LABELS: Record<ToolType, string> = {
  rect: '矩形',
  circle: '圆形',
  line: '直线',
  arrow: '箭头',
  pen: '画笔',
  text: '文字',
  mosaic: '马赛克',
}

const DEFAULT_CAPTURE_SETTINGS: CaptureAppSettings = {
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

export default function Capture() {
  const [bgImage, setBgImage] = useState<HTMLImageElement | HTMLCanvasElement | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredWindow, setHoveredWindow] = useState<CaptureWindowCandidate | null>(null)
  const [windowCandidates, setWindowCandidates] = useState<CaptureWindowCandidate[]>([])
  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [captureError, setCaptureError] = useState<CaptureErrorState | null>(null)
  const [isActionPending, setIsActionPending] = useState(false)
  const [appSettings, setAppSettings] = useState<CaptureAppSettings>(DEFAULT_CAPTURE_SETTINGS)
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const initialSourceLang = searchParams.get('sourceLang') === 'zh' || searchParams.get('sourceLang') === 'en'
    ? (searchParams.get('sourceLang') as 'zh' | 'en')
    : 'auto'
  const initialTargetLang = searchParams.get('targetLang') === 'en' ? 'en' : 'zh'
  const [ocrResult, setOcrResult] = useState('')
  const [translatedResult, setTranslatedResult] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationSourceLang, setTranslationSourceLang] = useState<'auto' | 'zh' | 'en'>(initialSourceLang)
  const [translationTarget, setTranslationTarget] = useState<'zh' | 'en'>(initialTargetLang)
  const stageRef = useRef<KonvaStage | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const captureIntent = searchParams.get('intent') === 'translate'
    ? 'translate'
    : searchParams.get('intent') === 'ocr'
      ? 'ocr'
      : 'default'
  const isQuickOcrMode = captureIntent === 'ocr'
  const isQuickTranslateMode = captureIntent === 'translate'

  const feedbackTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const shapeInteractionMovedRef = useRef(false)
  const suppressNextCanvasPointerRef = useRef(false)
  const autoOcrPendingRef = useRef(false)
  const autoTranslatePendingRef = useRef(false)
  const desktopStreamRef = useRef<MediaStream | null>(null)
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const {
    shapes, activeTool, color, strokeWidth, fontSize,
    setActiveTool, setColor, setStrokeWidth, setFontSize,
    addShape, updateShape, updateShapePoints, duplicateShape, removeShape, commitHistory, undo, redo, clear
  } = useEditorStore()

  const [isDrawing, setIsDrawing] = useState(false)
  const [currentShapeId, setCurrentShapeId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
  const [resizingTextId, setResizingTextId] = useState<string | null>(null)
  const [textInteraction, setTextInteraction] = useState<TextInteractionState | null>(null)
  const [shapeInteraction, setShapeInteraction] = useState<ShapeInteractionState | null>(null)
  const [shapeResizeInteraction, setShapeResizeInteraction] = useState<ShapeResizeInteractionState | null>(null)
  const [selectionInteraction, setSelectionInteraction] = useState<SelectionInteractionState | null>(null)
  const [selectionResizeInteraction, setSelectionResizeInteraction] = useState<SelectionResizeInteractionState | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null)
  const [toolbarDrag, setToolbarDrag] = useState<ToolbarDragState | null>(null)
  const [windowHoverMode, setWindowHoverMode] = useState<WindowHoverMode>('candidate')
  const [lastExportedFilePath, setLastExportedFilePath] = useState('')

  const hasValidSelection = Boolean(selection && selection.width > 0 && selection.height > 0)
  const toolbarTop = selection
    ? Math.min(
      window.innerHeight - 68,
      selection.y + selection.height + 12 > window.innerHeight - 56
        ? Math.max(12, selection.y - 56)
        : selection.y + selection.height + 12,
    )
    : 12
  const toolbarLeft = selection
    ? Math.min(
      Math.max(12, window.innerWidth - 420),
      Math.max(12, selection.x + selection.width - 392),
    )
    : 12
  const resolvedToolbarLeft = toolbarPosition
    ? Math.min(Math.max(12, toolbarPosition.left), Math.max(12, window.innerWidth - 420))
    : toolbarLeft
  const resolvedToolbarTop = toolbarPosition
    ? Math.min(Math.max(12, toolbarPosition.top), Math.max(12, window.innerHeight - 68))
    : toolbarTop

  const getTextRect = useCallback((points: { x: number; y: number }[]) => {
    const start = points[0]
    const end = points[points.length - 1] ?? start
    const minWidth = 120
    const minHeight = 40
    const width = Math.max(Math.abs(end.x - start.x), minWidth)
    const height = Math.max(Math.abs(end.y - start.y), minHeight)

    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width,
      height,
    } satisfies TextRect
  }, [])

  const activeEditingShape = editingTextId ? shapes.find((shape) => shape.id === editingTextId && shape.type === 'text') : null
  const selectedTextShape = selectedTextId ? shapes.find((shape) => shape.id === selectedTextId && shape.type === 'text') : null
  const selectedShape = selectedShapeId ? shapes.find((shape) => shape.id === selectedShapeId && shape.type !== 'text') : null
  const selectedAnnotatingShape = selectedTextShape ?? selectedShape
  const editingTextRect = activeEditingShape ? getTextRect(activeEditingShape.points) : null
  const visibleStyleTool: ToolType | null =
    activeTool
    ?? (activeEditingShape ? 'text' : null)
    ?? (selectedTextShape ? 'text' : null)
    ?? (selectedShape?.type ?? null)
  const shouldShowColorOptions = visibleStyleTool !== 'mosaic' && visibleStyleTool !== null
  const shouldShowStrokeWidthOptions = visibleStyleTool !== null && visibleStyleTool !== 'text'
  const shouldShowFontSizeOptions = visibleStyleTool === 'text'

  const getShapeBounds = useCallback((shape: Shape): SelectionRect | null => {
    if (shape.points.length === 0) {
      return null
    }

    if (shape.type === 'text') {
      return getTextRect(shape.points)
    }

    if (shape.type === 'circle') {
      const start = shape.points[0]
      const end = shape.points[shape.points.length - 1] ?? start
      const rx = Math.abs(end.x - start.x) / 2
      const ry = Math.abs(end.y - start.y) / 2
      const radius = Math.max(rx, ry)
      const centerX = Math.min(start.x, end.x) + rx
      const centerY = Math.min(start.y, end.y) + ry
      return {
        x: centerX - radius - 6,
        y: centerY - radius - 6,
        width: radius * 2 + 12,
        height: radius * 2 + 12,
      }
    }

    const xs = shape.points.map((point) => point.x)
    const ys = shape.points.map((point) => point.y)
    const padding = Math.max(6, shape.strokeWidth + 4)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(maxX - minX + padding * 2, 16),
      height: Math.max(maxY - minY + padding * 2, 16),
    }
  }, [getTextRect])

  const getResizedBounds = useCallback((
    origin: SelectionRect,
    handle: SelectionResizeHandle,
    dx: number,
    dy: number,
    minWidth = 24,
    minHeight = 24,
  ) => {
    let nextX = origin.x
    let nextY = origin.y
    let nextWidth = origin.width
    let nextHeight = origin.height

    if (handle.includes('left')) {
      nextX = Math.min(origin.x + origin.width - minWidth, origin.x + dx)
      nextWidth = origin.x + origin.width - nextX
    }

    if (handle.includes('right')) {
      nextWidth = Math.max(minWidth, origin.width + dx)
    }

    if (handle.includes('top')) {
      nextY = Math.min(origin.y + origin.height - minHeight, origin.y + dy)
      nextHeight = origin.y + origin.height - nextY
    }

    if (handle.includes('bottom')) {
      nextHeight = Math.max(minHeight, origin.height + dy)
    }

    return {
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    } satisfies SelectionRect
  }, [])

  const scalePointsToBounds = useCallback((points: Point[], originBounds: SelectionRect, nextBounds: SelectionRect) => {
    const scaleX = originBounds.width === 0 ? 1 : nextBounds.width / originBounds.width
    const scaleY = originBounds.height === 0 ? 1 : nextBounds.height / originBounds.height

    return points.map((point) => ({
      x: nextBounds.x + (point.x - originBounds.x) * scaleX,
      y: nextBounds.y + (point.y - originBounds.y) * scaleY,
    }))
  }, [])

  const showFeedback = (
    tone: FeedbackState['tone'],
    message: string,
    actionLabel?: string,
    onAction?: () => void,
  ) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    setFeedback({ tone, message, actionLabel, onAction })
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null)
    }, tone === 'actionable' ? 3200 : 1800)
  }

  const scheduleCloseCapture = (delay = 500) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
    }

    closeTimerRef.current = window.setTimeout(() => {
      window.electronAPI.closeCapture()
    }, delay)
  }

  const scheduleCloseIfNeeded = useCallback((shouldClose: boolean, delay = 500) => {
    if (shouldClose) {
      scheduleCloseCapture(delay)
    }
  }, [])

  const drawCurrentDesktopFrame = useCallback(() => {
    const video = desktopVideoRef.current
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null
    }

    let canvas = backgroundCanvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      backgroundCanvasRef.current = canvas
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setBgImage(canvas)
    return canvas
  }, [])

  const getPointerColorHex = useCallback((point: { x: number; y: number } | null) => {
    const canvas = backgroundCanvasRef.current
    if (!canvas || !point) {
      return '#000000'
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return '#000000'
    }

    const pixel = context.getImageData(Math.max(0, Math.floor(point.x)), Math.max(0, Math.floor(point.y)), 1, 1).data
    return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }, [])

  const loadWindowCandidates = useCallback(async (displayId?: string | null) => {
    try {
      const visibleWindows = await window.electronAPI.getVisibleWindows(displayId ?? undefined)
      setWindowCandidates(visibleWindows)
    } catch (error) {
      console.error('Failed to load visible windows', error)
      setWindowCandidates([])
    }
  }, [])

  const finishTextEditing = useCallback((shapeId?: string | null) => {
    const targetId = shapeId ?? editingTextId
    if (!targetId) {
      return
    }

    const targetShape = useEditorStore.getState().shapes.find((shape) => shape.id === targetId && shape.type === 'text')
    if (!targetShape) {
      setEditingTextId(null)
      setSelectedTextId(null)
      return
    }

    if (!targetShape.text?.trim()) {
      removeShape(targetId)
      setEditingTextId(null)
      setSelectedTextId(null)
      return
    }

    setEditingTextId(null)
    setSelectedTextId(targetId)
    commitHistory()
  }, [commitHistory, editingTextId, removeShape])

  const startTextEditing = useCallback((shapeId: string) => {
    setEditingTextId(shapeId)
    setSelectedTextId(shapeId)
  }, [])

  const toggleTool = useCallback((tool: typeof activeTool) => {
    if (editingTextId) {
      finishTextEditing(editingTextId)
    }

    if (activeTool === tool) {
      setActiveTool(null)
      if (tool === 'text') {
        setSelectedTextId(null)
      }
      return
    }

    setSelectedShapeId(null)
    if (tool !== 'text') {
      setSelectedTextId(null)
    }
    setActiveTool(tool)
  }, [activeTool, editingTextId, finishTextEditing, setActiveTool])

  const clearSelectionState = useCallback(() => {
    setSelection(null)
    setStartPoint(null)
    setIsSelecting(false)
    setHoveredWindow(null)
    setIsDrawing(false)
    setCurrentShapeId(null)
    setEditingTextId(null)
    setSelectedTextId(null)
    setSelectedShapeId(null)
    setResizingTextId(null)
    setTextInteraction(null)
    setShapeInteraction(null)
    setShapeResizeInteraction(null)
    setSelectionInteraction(null)
    setSelectionResizeInteraction(null)
    setToolbarPosition(null)
    setToolbarDrag(null)
    setWindowHoverMode('candidate')
    setOcrResult('')
    setLastExportedFilePath('')
    clear()
  }, [clear])

  useEffect(() => {
    const initCapture = async () => {
      const params = new URLSearchParams(location.search)
      const displayId = params.get('displayId')
      
      try {
        const settings = await window.electronAPI.getShortcutSettings()
        setAppSettings({
          translationSourceLang: settings.translationSourceLang,
          translationTargetLang: settings.translationTargetLang,
          defaultExportFormat: settings.defaultExportFormat,
          closeAfterCopy: settings.closeAfterCopy,
          closeAfterSave: settings.closeAfterSave,
          closeAfterPin: settings.closeAfterPin,
          ocrLanguages: settings.ocrLanguages,
          pinWindowShadow: settings.pinWindowShadow,
          pinWindowOpacity: settings.pinWindowOpacity,
        })
        const sources = await window.electronAPI.getDesktopSources()
        await loadWindowCandidates(displayId)
        if (sources.length === 0) {
          setCaptureError({
            title: '无法获取可截图的屏幕源',
            detail: '请检查系统是否已授予屏幕录制权限，然后重试。',
          })
          return
        }
        
        // desktopCapturer 的 source id 格式一般为 "screen:display_id:0"
        // 尝试匹配 display_id，如果匹配不到就退回拿第一个
        let source = sources.find(s => s.display_id === displayId)
        if (!source) {
           source = sources[0]
        }
        
        if (source) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: source.id,
              }
            } as DesktopVideoTrackConstraints
          })
          desktopStreamRef.current = stream
          
          const video = document.createElement('video')
          video.muted = true
          video.playsInline = true
          video.srcObject = stream
          desktopVideoRef.current = video
          video.onloadedmetadata = () => {
            void video.play()
            // 等待视频开始播放并且有实际帧数据
            const captureFrame = () => {
              if (video.readyState < 2) {
                requestAnimationFrame(captureFrame)
                return
              }
              drawCurrentDesktopFrame()
            }
            
            // 为了确保视频流有画面，稍微延迟一点或等待事件
            video.onplaying = () => {
              // 确保有实际内容，延迟一两帧
              requestAnimationFrame(() => {
                requestAnimationFrame(captureFrame)
              })
            }
          }
        }
      } catch (err) {
        console.error('Capture failed', err)
        setCaptureError({
          title: '截图初始化失败',
          detail: err instanceof Error ? err.message : '未知错误，请重试。',
        })
      }
    }
    
    initCapture()

    window.electronAPI.onClearSelection(() => {
      clearSelectionState()
    })

    return () => {
      desktopStreamRef.current?.getTracks().forEach((track) => track.stop())
      desktopStreamRef.current = null
      desktopVideoRef.current = null
    }
  }, [clearSelectionState, drawCurrentDesktopFrame, loadWindowCandidates, location.search])

  useEffect(() => {
    window.electronAPI.updateSelectionState(hasValidSelection)
  }, [hasValidSelection])

  useEffect(() => {
    if (editingTextId && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [editingTextId])

  useEffect(() => {
    if (!editingTextId) {
      return
    }

    const handlePointerDownOutside = (event: MouseEvent) => {
      const textarea = textareaRef.current
      const target = event.target as Node | null
      if (!textarea || !target) {
        return
      }

      if (textarea.contains(target)) {
        return
      }

      suppressNextCanvasPointerRef.current = true
      finishTextEditing(editingTextId)
    }

    window.addEventListener('mousedown', handlePointerDownOutside, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDownOutside, true)
    }
  }, [editingTextId, finishTextEditing])

  useEffect(() => {
    if (
      !pointerPos
      || selection
      || isSelecting
      || isDrawing
      || activeTool
      || editingTextId
      || selectedTextId
      || selectedShapeId
      || windowHoverMode !== 'candidate'
    ) {
      setHoveredWindow(null)
      return
    }

    const matchedWindow = windowCandidates.find((candidate) => (
      pointerPos.x >= candidate.bounds.x &&
      pointerPos.x <= candidate.bounds.x + candidate.bounds.width &&
      pointerPos.y >= candidate.bounds.y &&
      pointerPos.y <= candidate.bounds.y + candidate.bounds.height
    )) ?? null
    setHoveredWindow(matchedWindow)
  }, [activeTool, editingTextId, isDrawing, isSelecting, pointerPos, selectedShapeId, selectedTextId, selection, windowCandidates, windowHoverMode])

  useEffect(() => {
    if (selection || isSelecting || isDrawing || activeTool || editingTextId || selectedShapeId || selectedTextId) {
      return
    }

    const params = new URLSearchParams(location.search)
    void loadWindowCandidates(params.get('displayId'))
  }, [activeTool, editingTextId, isDrawing, isSelecting, loadWindowCandidates, location.search, selectedShapeId, selectedTextId, selection])

  useEffect(() => {
    const styleShape = activeEditingShape ?? selectedTextShape ?? selectedShape
    if (!styleShape) {
      return
    }

    setColor(styleShape.color)
    setStrokeWidth(styleShape.strokeWidth)
    if (styleShape.type === 'text' && styleShape.fontSize) {
      setFontSize(styleShape.fontSize)
    }
  }, [activeEditingShape, selectedShape, selectedTextShape, setColor, setFontSize, setStrokeWidth])

  useEffect(() => {
    if (selectedShapeId && !selectedShape) {
      setSelectedShapeId(null)
    }
  }, [selectedShape, selectedShapeId])

  useEffect(() => {
    if (selectedTextId && !selectedTextShape) {
      setSelectedTextId(null)
    }
  }, [selectedTextId, selectedTextShape])

  useEffect(() => {
    if (!textInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.clientX - textInteraction.startX
      const dy = event.clientY - textInteraction.startY

      if (textInteraction.mode === 'move') {
        updateShape(textInteraction.shapeId, {
          points: [
            { x: textInteraction.rect.x + dx, y: textInteraction.rect.y + dy },
            { x: textInteraction.rect.x + textInteraction.rect.width + dx, y: textInteraction.rect.y + textInteraction.rect.height + dy },
          ],
        })
        return
      }

      updateShape(textInteraction.shapeId, {
        points: [
          { x: textInteraction.rect.x, y: textInteraction.rect.y },
          {
            x: Math.max(textInteraction.rect.x + 120, textInteraction.rect.x + textInteraction.rect.width + dx),
            y: Math.max(textInteraction.rect.y + 40, textInteraction.rect.y + textInteraction.rect.height + dy),
          },
        ],
      })
    }

    const handlePointerUp = () => {
      setResizingTextId(null)
      setTextInteraction(null)
      commitHistory()
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [commitHistory, textInteraction, updateShape])

  useEffect(() => {
    if (!toolbarDrag) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const nextLeft = toolbarDrag.originLeft + (event.clientX - toolbarDrag.startX)
      const nextTop = toolbarDrag.originTop + (event.clientY - toolbarDrag.startY)
      setToolbarPosition({
        left: Math.min(Math.max(12, nextLeft), Math.max(12, window.innerWidth - 420)),
        top: Math.min(Math.max(12, nextTop), Math.max(12, window.innerHeight - 68)),
      })
    }

    const handlePointerUp = () => {
      setToolbarDrag(null)
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [toolbarDrag])

  const handleDuplicateSelectedShape = useCallback(() => {
    if (!selectedAnnotatingShape) {
      return
    }

    const duplicateId = duplicateShape(selectedAnnotatingShape.id)
    if (!duplicateId) {
      return
    }

    setActiveTool(null)
    if (selectedAnnotatingShape.type === 'text') {
      setSelectedTextId(duplicateId)
      setSelectedShapeId(null)
    } else {
      setSelectedShapeId(duplicateId)
      setSelectedTextId(null)
    }
    showFeedback('success', '已复制当前标注')
  }, [duplicateShape, selectedAnnotatingShape, setActiveTool])

  const handleDeleteSelectedShape = useCallback(() => {
    if (!selectedAnnotatingShape) {
      return
    }

    removeShape(selectedAnnotatingShape.id)
    setSelectedTextId(null)
    setSelectedShapeId(null)
    setActiveTool(null)
  }, [removeShape, selectedAnnotatingShape, setActiveTool])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editingTextId) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedAnnotatingShape) {
        event.preventDefault()
        handleDuplicateSelectedShape()
        return
      }

      if (!selectedAnnotatingShape) {
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }

      event.preventDefault()
      handleDeleteSelectedShape()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editingTextId, handleDeleteSelectedShape, handleDuplicateSelectedShape, selectedAnnotatingShape])

  useEffect(() => {
    if (!shapeInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.clientX - shapeInteraction.startX
      const dy = event.clientY - shapeInteraction.startY
      if (dx !== 0 || dy !== 0) {
        shapeInteractionMovedRef.current = true
      }

      updateShape(shapeInteraction.shapeId, {
        points: shapeInteraction.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      })
    }

    const handlePointerUp = () => {
      if (shapeInteractionMovedRef.current) {
        commitHistory()
      }
      shapeInteractionMovedRef.current = false
      setShapeInteraction(null)
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [commitHistory, shapeInteraction, updateShape])

  useEffect(() => {
    if (!shapeResizeInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.clientX - shapeResizeInteraction.startX
      const dy = event.clientY - shapeResizeInteraction.startY
      const nextBounds = getResizedBounds(shapeResizeInteraction.originBounds, shapeResizeInteraction.handle, dx, dy, 16, 16)
      const nextPoints = scalePointsToBounds(shapeResizeInteraction.originPoints, shapeResizeInteraction.originBounds, nextBounds)
      updateShapePoints(shapeResizeInteraction.shapeId, nextPoints)
    }

    const handlePointerUp = () => {
      setShapeResizeInteraction(null)
      commitHistory()
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [commitHistory, getResizedBounds, scalePointsToBounds, shapeResizeInteraction, updateShapePoints])

  useEffect(() => {
    if (!selectionInteraction || !selection) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.clientX - selectionInteraction.startX
      const dy = event.clientY - selectionInteraction.startY

      setSelection({
        x: selectionInteraction.origin.x + dx,
        y: selectionInteraction.origin.y + dy,
        width: selectionInteraction.origin.width,
        height: selectionInteraction.origin.height,
      })

      useEditorStore.setState(() => ({
        shapes: selectionInteraction.shapesSnapshot.map((shape) => ({
          ...shape,
          points: shape.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          })),
        })),
      }))
    }

    const handlePointerUp = () => {
      setSelectionInteraction(null)
      if (shapes.length > 0) {
        commitHistory()
      }
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [commitHistory, selection, selectionInteraction, shapes.length])

  useEffect(() => {
    if (!selectionResizeInteraction) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const dx = event.clientX - selectionResizeInteraction.startX
      const dy = event.clientY - selectionResizeInteraction.startY
      setSelection(getResizedBounds(selectionResizeInteraction.origin, selectionResizeInteraction.handle, dx, dy))
    }

    const handlePointerUp = () => {
      setSelectionResizeInteraction(null)
    }

    window.addEventListener('mousemove', handlePointerMove, true)
    window.addEventListener('mouseup', handlePointerUp, true)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true)
      window.removeEventListener('mouseup', handlePointerUp, true)
    }
  }, [getResizedBounds, selectionResizeInteraction])

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current)
      }
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
      desktopStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return

    if (editingTextId) {
      finishTextEditing(editingTextId)
      return
    }

    if (resizingTextId) {
      return
    }

    if (selection && selection.width > 0 && !isSelecting) {
      const inSelection =
        pos.x >= selection.x && pos.x <= selection.x + selection.width &&
        pos.y >= selection.y && pos.y <= selection.y + selection.height

      if (inSelection) {
        if (!activeTool) {
          if (selectedTextId || selectedShapeId) {
            setSelectedTextId(null)
            setSelectedShapeId(null)
            return
          }
          setSelectedShapeId(null)
          setSelectedTextId(null)
          setSelectionInteraction({
            startX: e.evt.clientX,
            startY: e.evt.clientY,
            origin: selection,
            shapesSnapshot: shapes.map((shape) => ({
              ...shape,
              points: shape.points.map((point) => ({ ...point })),
            })),
          })
          return
        }
        setIsDrawing(true)
        const id = Date.now().toString()
        setCurrentShapeId(id)
        setSelectedShapeId(null)
        setSelectedTextId(null)
        addShape({
          id,
          type: activeTool,
          points: activeTool === 'text' ? [pos, { x: pos.x + 180, y: pos.y + 56 }] : [pos, pos],
          color,
          strokeWidth,
          text: activeTool === 'text' ? '输入文字' : undefined,
          fontSize: activeTool === 'text' ? fontSize : undefined,
        })
        return
      }

      setSelectedTextId(null)
      setSelectedShapeId(null)
      setActiveTool(null)
      return
    }

    setStartPoint(pos)
    setWindowHoverMode('candidate')
  }

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return
    setPointerPos(pos)

    if (resizingTextId || textInteraction) {
      return
    }

    if (selectionInteraction) {
      return
    }

    if (isDrawing && currentShapeId && activeTool) {
      const currentShape = shapes.find(s => s.id === currentShapeId)
      if (currentShape) {
        if (activeTool === 'pen' || activeTool === 'mosaic') {
          updateShape(currentShapeId, { points: [...currentShape.points, pos] })
        } else {
          updateShape(currentShapeId, { points: [currentShape.points[0], pos] })
        }
      }
      return
    }

    if (!startPoint) {
      return
    }

    const nextSelection = {
      x: Math.min(startPoint.x, pos.x),
      y: Math.min(startPoint.y, pos.y),
      width: Math.abs(pos.x - startPoint.x),
      height: Math.abs(pos.y - startPoint.y),
    }

    if (!isSelecting) {
      if (nextSelection.width < 6 && nextSelection.height < 6) {
        return
      }

      window.electronAPI.notifySelectionStart()
      setWindowHoverMode('drag-select')
      setHoveredWindow(null)
      setOcrResult('')
      setIsSelecting(true)
      clear()
    }

    setSelection(nextSelection)
  }

  const handleMouseUp = () => {
    if (selectionInteraction) {
      setSelectionInteraction(null)
      if (shapes.length > 0) {
        commitHistory()
      }
      return
    }

    if (isDrawing) {
      if (activeTool === 'text' && currentShapeId) {
        const currentShape = shapes.find((shape) => shape.id === currentShapeId && shape.type === 'text')
        if (currentShape) {
          const rect = getTextRect(currentShape.points)
          updateShape(currentShapeId, {
            points: [
              { x: rect.x, y: rect.y },
              { x: rect.x + rect.width, y: rect.y + rect.height },
            ],
          })
          startTextEditing(currentShapeId)
          // Exit "add text" mode after creating one text box, but keep editing enabled.
          setActiveTool(null)
        }
      }
      setIsDrawing(false)
      setCurrentShapeId(null)
      if (activeTool !== 'text') {
        commitHistory()
      }
      return
    }

    if (isSelecting) {
      if (!selection || selection.width === 0 || selection.height === 0) {
        clearSelectionState()
        return
      }

      setIsSelecting(false)
      setStartPoint(null)
      if (isQuickOcrMode) {
        autoOcrPendingRef.current = true
      }
      if (isQuickTranslateMode) {
        autoOcrPendingRef.current = true
        autoTranslatePendingRef.current = true
      }
      return
    }

    if (!selection && startPoint) {
      if (hoveredWindow) {
        window.electronAPI.notifySelectionStart()
        clear()
        setSelection({ ...hoveredWindow.bounds })
        setHoveredWindow(null)
        setWindowHoverMode('candidate')
        if (isQuickOcrMode) {
          autoOcrPendingRef.current = true
        }
        if (isQuickTranslateMode) {
          autoOcrPendingRef.current = true
          autoTranslatePendingRef.current = true
        }
      }
      setStartPoint(null)
    }
  }

  const [isExporting, setIsExporting] = useState(false)

  const exportSelection = useCallback(async () => {
    if (!selection || selection.width <= 0 || selection.height <= 0 || !stageRef.current) return null
    setIsExporting(true)

    try {
      await new Promise(resolve => setTimeout(resolve, 50))

      return stageRef.current.toDataURL({
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
        pixelRatio: 1
      })
    } finally {
      setIsExporting(false)
    }
  }, [selection])

  const shouldShowMagnifier = Boolean(
    !isExporting
    && pointerPos
    && (!selection || isSelecting || Boolean(selectionResizeInteraction))
    && !toolbarDrag
    && !editingTextId,
  )
  const magnifierLeft = pointerPos
    ? (pointerPos.x + 24 > window.innerWidth - 156 ? pointerPos.x - 172 : pointerPos.x + 24)
    : 0
  const magnifierTop = pointerPos
    ? (pointerPos.y + 24 > window.innerHeight - 188 ? pointerPos.y - 204 : pointerPos.y + 24)
    : 0
  const pointerColorHex = getPointerColorHex(pointerPos)

  const handleRevealFile = useCallback(async (filePath: string) => {
    if (!filePath) {
      return
    }

    const result = await window.electronAPI.revealFileInFinder(filePath)
    if (result.status === 'error') {
      showFeedback('error', result.message)
    }
  }, [])

  const recordHistory = useCallback(async (dataURL: string, action: 'copy' | 'save' | 'pin', format: 'png' | 'jpg') => {
    const result = await window.electronAPI.recordCaptureHistory({ dataURL, action, format })
    if (result.status === 'error') {
      console.warn('Failed to record capture history', result.message)
    }
  }, [])

  const handleExport = async (type: 'copy' | 'save') => {
    setIsActionPending(true)
    try {
      const dataURL = await exportSelection()
      if (!dataURL) {
        showFeedback('error', '当前没有可导出的有效选区')
        return
      }

      if (type === 'copy') {
        const blob = await (await fetch(dataURL)).blob()
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ])
        setLastExportedFilePath('')
        await recordHistory(dataURL, 'copy', 'png')
        showFeedback('success', appSettings.closeAfterCopy ? '截图已复制到剪贴板，正在关闭截图' : '截图已复制，可继续标注或按 Esc 退出')
        scheduleCloseIfNeeded(appSettings.closeAfterCopy)
        return
      }

      const result = await window.electronAPI.saveScreenshot({
        dataURL,
        format: appSettings.defaultExportFormat,
        quality: 92,
      })

      if (result.status === 'success') {
        setLastExportedFilePath(result.filePath)
        await recordHistory(dataURL, 'save', result.format)
        showFeedback(
          'actionable',
          `截图已保存到 ${result.filePath}`,
          '在 Finder 中显示',
          () => { void handleRevealFile(result.filePath) },
        )
        scheduleCloseIfNeeded(appSettings.closeAfterSave, 800)
        return
      }

      if (result.status === 'cancelled') {
        showFeedback('info', '已取消保存截图')
        return
      }

      showFeedback('error', result.message || '保存失败，请重试')
    } catch (err) {
      console.error(`Failed to ${type}`, err)
      showFeedback('error', type === 'copy' ? '复制失败，请重试' : '保存失败，请重试')
    } finally {
      setIsActionPending(false)
    }
  }

  const handlePin = async () => {
    setIsActionPending(true)
    try {
      const dataURL = await exportSelection()
      if (!dataURL) {
        showFeedback('error', '当前没有可贴图的有效选区')
        return
      }

      const result = await window.electronAPI.createPinWindow({ dataURL })
      if (result.status === 'error') {
        showFeedback('error', result.message)
        return
      }

      await recordHistory(dataURL, 'pin', 'png')
      showFeedback('success', appSettings.closeAfterPin ? '贴图窗口已创建，正在关闭截图' : '贴图窗口已创建，可继续编辑当前截图')
      scheduleCloseIfNeeded(appSettings.closeAfterPin)
    } catch (error) {
      console.error('Failed to create pin window', error)
      showFeedback('error', '创建贴图窗口失败，请重试')
    } finally {
      setIsActionPending(false)
    }
  }

  const handleOCR = useCallback(async () => {
    setIsActionPending(true)
    try {
      const dataURL = await exportSelection()
      if (!dataURL) {
        showFeedback('error', '当前没有可识别的有效选区')
        return
      }

      const { data: { text } } = await Tesseract.recognize(dataURL, appSettings.ocrLanguages, {
        logger: m => console.log(m)
      })

      if (text.trim()) {
        setOcrResult(text.trim())
        setTranslatedResult('')
        showFeedback('success', 'OCR 识别完成')
      } else {
        setOcrResult('')
        setTranslatedResult('')
        showFeedback('error', 'OCR 未识别到可复制文本')
      }
    } catch (err) {
      console.error('OCR failed', err)
      setOcrResult('')
      setTranslatedResult('')
      showFeedback('error', 'OCR 识别失败，当前选区已保留')
    } finally {
      setIsActionPending(false)
    }
  }, [appSettings.ocrLanguages, exportSelection])

  useEffect(() => {
    if (!autoOcrPendingRef.current || !hasValidSelection || isSelecting || isActionPending) {
      return
    }

    autoOcrPendingRef.current = false
    void handleOCR()
  }, [handleOCR, hasValidSelection, isActionPending, isSelecting])

  const handleCopyOCRResult = async () => {
    if (!ocrResult.trim()) {
      showFeedback('error', '当前没有可复制的 OCR 结果')
      return
    }

    try {
      await navigator.clipboard.writeText(ocrResult)
      showFeedback('success', 'OCR 结果已复制到剪贴板')
    } catch (err) {
      console.error('Failed to copy OCR result', err)
      showFeedback('error', '复制 OCR 结果失败，请重试')
    }
  }

  const handleTranslateResult = useCallback(async (targetLang: 'zh' | 'en') => {
    if (!ocrResult.trim()) {
      showFeedback('error', '当前没有可翻译的 OCR 结果')
      return
    }

    setIsTranslating(true)
    setTranslationTarget(targetLang)
    try {
      const result = await window.electronAPI.translateText({
        text: ocrResult,
        sourceLang: translationSourceLang,
        targetLang,
      })

      if (result.status === 'error') {
        showFeedback('error', result.message)
        return
      }

      setTranslatedResult(result.text)
      showFeedback('success', targetLang === 'zh' ? '已翻译为中文' : '已翻译为英文')
    } catch (error) {
      console.error('Failed to translate OCR result', error)
      showFeedback('error', '翻译失败，请稍后重试')
    } finally {
      setIsTranslating(false)
    }
  }, [ocrResult, translationSourceLang])

  useEffect(() => {
    if (!autoTranslatePendingRef.current || !ocrResult.trim() || isTranslating || isActionPending) {
      return
    }

    autoTranslatePendingRef.current = false
    void handleTranslateResult(translationTarget)
  }, [handleTranslateResult, isActionPending, isTranslating, ocrResult, translationTarget])

  const handleCopyTranslatedResult = async () => {
    if (!translatedResult.trim()) {
      showFeedback('error', '当前没有可复制的翻译结果')
      return
    }

    try {
      await navigator.clipboard.writeText(translatedResult)
      showFeedback('success', '翻译结果已复制到剪贴板')
    } catch (error) {
      console.error('Failed to copy translated result', error)
      showFeedback('error', '复制翻译结果失败，请重试')
    }
  }

  const handleRememberTranslationDefaults = async () => {
    try {
      const settings = await window.electronAPI.getShortcutSettings()
      const result = await window.electronAPI.updateShortcutSettings({
        ...settings,
        translationSourceLang,
        translationTargetLang: translationTarget,
      })
      if (result.status === 'error') {
        showFeedback('error', result.message)
        return
      }

      setAppSettings((current) => ({
        ...current,
        translationSourceLang,
        translationTargetLang: translationTarget,
      }))
      showFeedback('success', '已将当前翻译语言保存为默认值')
    } catch (error) {
      console.error('Failed to persist translation defaults', error)
      showFeedback('error', '保存默认翻译语言失败，请重试')
    }
  }

  const handleTextChange = (value: string) => {
    if (!editingTextId) {
      return
    }

    updateShape(editingTextId, { text: value })
  }

  const handleColorChange = (nextColor: string) => {
    setColor(nextColor)

    if (editingTextId) {
      updateShape(editingTextId, { color: nextColor })
      commitHistory()
      return
    }

    if (selectedTextId) {
      updateShape(selectedTextId, { color: nextColor })
      commitHistory()
      return
    }

    if (selectedShapeId) {
      updateShape(selectedShapeId, { color: nextColor })
      commitHistory()
    }
  }

  const handleStrokeWidthChange = (nextWidth: number) => {
    setStrokeWidth(nextWidth)

    if (selectedShapeId) {
      updateShape(selectedShapeId, { strokeWidth: nextWidth })
      commitHistory()
    }
  }

  const handleFontSizeChange = (nextFontSize: number) => {
    setFontSize(nextFontSize)

    if (editingTextId) {
      updateShape(editingTextId, { fontSize: nextFontSize })
      commitHistory()
      return
    }

    if (selectedTextId) {
      updateShape(selectedTextId, { fontSize: nextFontSize })
      commitHistory()
    }
  }

  const beginTextEditing = (shapeId: string) => {
    setSelectedTextId(shapeId)
    setSelectedShapeId(null)
    window.requestAnimationFrame(() => {
      startTextEditing(shapeId)
    })
  }

  const consumeSuppressedCanvasPointer = () => {
    if (!suppressNextCanvasPointerRef.current) {
      return false
    }

    suppressNextCanvasPointerRef.current = false
    return true
  }

  const exitTextMode = useCallback(() => {
    if (editingTextId) {
      finishTextEditing(editingTextId)
    }
    setEditingTextId(null)
    setSelectedTextId(null)
    setActiveTool(null)
  }, [editingTextId, finishTextEditing, setActiveTool])

  const handleShapeSelect = (shape: Shape, event: React.MouseEvent<HTMLDivElement>) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setEditingTextId(null)
    setSelectedTextId(null)
    setSelectedShapeId(shape.id)
    setActiveTool(null)
    shapeInteractionMovedRef.current = false
    setShapeInteraction({
      shapeId: shape.id,
      startX: event.clientX,
      startY: event.clientY,
      points: shape.points.map((point) => ({ ...point })),
    })
  }

  const handleShapeResizeStart = (
    shape: Shape,
    bounds: SelectionRect,
    handle: SelectionResizeHandle,
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setEditingTextId(null)
    setSelectedTextId(null)
    setSelectedShapeId(shape.id)
    setActiveTool(null)
    setShapeInteraction(null)
    setShapeResizeInteraction({
      shapeId: shape.id,
      startX: event.clientX,
      startY: event.clientY,
      handle,
      originBounds: bounds,
      originPoints: shape.points.map((point) => ({ ...point })),
    })
  }

  const resetSelectionForReselect = () => {
    setSelection(null)
    setStartPoint(null)
    setIsSelecting(false)
    setIsDrawing(false)
    setCurrentShapeId(null)
    setEditingTextId(null)
    setSelectedTextId(null)
    setSelectedShapeId(null)
    setResizingTextId(null)
    setTextInteraction(null)
    setShapeInteraction(null)
    setSelectionInteraction(null)
    setSelectionResizeInteraction(null)
    setToolbarPosition(null)
    setToolbarDrag(null)
    setActiveTool(null)
    clear()
  }

  const handleSelectionMoveStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    if (!selection || activeTool) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setSelectedShapeId(null)
    setSelectedTextId(null)
    setShapeInteraction(null)
    setSelectionInteraction({
      startX: event.clientX,
      startY: event.clientY,
      origin: selection,
      shapesSnapshot: shapes.map((shape) => ({
        ...shape,
        points: shape.points.map((point) => ({ ...point })),
      })),
    })
  }

  const handleSelectionResizeStart = (
    handle: SelectionResizeHandle,
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    if (!selection) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setSelectionResizeInteraction({
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: selection,
    })
  }

  const handleTextKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finishTextEditing(editingTextId)
      setActiveTool(null)
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      finishTextEditing(editingTextId)
      setActiveTool(null)
    }
  }

  const handleTextMoveStart = (shapeId: string, event: React.MouseEvent<HTMLDivElement>, rect: TextRect) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setSelectedTextId(shapeId)
    setEditingTextId(null)
    setActiveTool(null)
    setTextInteraction({
      shapeId,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      rect,
    })
  }

  const handleTextResizeStart = (shapeId: string, event: React.MouseEvent<HTMLDivElement>, rect: TextRect) => {
    if (consumeSuppressedCanvasPointer()) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    setResizingTextId(shapeId)
    setSelectedTextId(shapeId)
    setEditingTextId(null)
    setActiveTool(null)
    setTextInteraction({
      shapeId,
      mode: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      rect,
    })
  }

  const handleCloseCapture = () => {
    window.electronAPI.closeCapture()
  }

  const stopToolbarPointerEvent = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
  }

  const handleToolbarDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    setToolbarDrag({
      startX: event.clientX,
      startY: event.clientY,
      originLeft: resolvedToolbarLeft,
      originTop: resolvedToolbarTop,
    })
  }

  const handleTextToolClick = () => {
    if (activeTool === 'text' || editingTextId || selectedTextId) {
      exitTextMode()
      return
    }

    toggleTool('text')
  }

  const renderToolConfigPanel = (tool: ToolType) => {
    if (visibleStyleTool !== tool) {
      return null
    }

    return (
      <div
        className="absolute left-1/2 top-full z-10 mt-2 flex min-w-[220px] -translate-x-1/2 flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700 shadow-xl"
        onMouseDown={stopToolbarPointerEvent}
        onMouseUp={stopToolbarPointerEvent}
        onClick={stopToolbarPointerEvent}
      >
        <div className="font-medium text-zinc-900">{TOOL_LABELS[tool]}设置</div>

        {shouldShowColorOptions && (
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-zinc-500">颜色</span>
            <div className="flex flex-1 items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {PRESET_COLORS.map((presetColor) => {
                  const isActive = color.toLowerCase() === presetColor.toLowerCase()
                  return (
                    <button
                      key={presetColor}
                      type="button"
                      aria-label={`选择颜色 ${presetColor}`}
                      className={`h-6 w-6 rounded-full border transition ${isActive ? 'scale-110 border-zinc-900 shadow-sm' : 'border-zinc-200 hover:border-zinc-400'}`}
                      style={{ backgroundColor: presetColor }}
                      onMouseDown={stopToolbarPointerEvent}
                      onClick={() => handleColorChange(presetColor)}
                    />
                  )
                })}
              </div>
              <input
                type="color"
                value={color}
                disabled={isActionPending}
                className="h-7 w-9 cursor-pointer rounded border border-zinc-200 bg-transparent p-0"
                onMouseDown={stopToolbarPointerEvent}
                onClick={stopToolbarPointerEvent}
                onChange={(event) => handleColorChange(event.target.value)}
              />
            </div>
          </div>
        )}

        {shouldShowStrokeWidthOptions && (
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-zinc-500">粗细</span>
            <div className="flex flex-wrap gap-1">
              {[2, 4, 6, 8, 12].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`rounded-md border px-2 py-1 ${strokeWidth === size ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50'}`}
                  onMouseDown={stopToolbarPointerEvent}
                  onClick={() => handleStrokeWidthChange(size)}
                >
                  {size}px
                </button>
              ))}
            </div>
          </div>
        )}

        {shouldShowFontSizeOptions && (
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-zinc-500">字号</span>
            <div className="flex flex-wrap gap-1">
              {[14, 18, 20, 24, 28, 32].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`rounded-md border px-2 py-1 ${fontSize === size ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50'}`}
                  onMouseDown={stopToolbarPointerEvent}
                  onClick={() => handleFontSizeChange(size)}
                >
                  {size}px
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (captureError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black/70 text-white">
        <div className="max-w-md rounded-lg bg-zinc-900/90 p-6 shadow-xl">
          <div className="text-lg font-semibold">{captureError.title}</div>
          <div className="mt-2 text-sm text-zinc-300">{captureError.detail}</div>
          <button
            type="button"
            className="mt-4 rounded bg-white px-4 py-2 text-sm text-zinc-900"
            onClick={handleCloseCapture}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  if (!bgImage) return null

  return (
    <div className="w-screen h-screen overflow-hidden bg-black/50 cursor-crosshair">
      <Stage 
        width={window.innerWidth} 
        height={window.innerHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        ref={stageRef}
      >
        <Layer>
          <KonvaImage image={bgImage} width={window.innerWidth} height={window.innerHeight} />
          
          {/* Dark Overlay */}
          {!isExporting && (
            <Rect
              x={0}
              y={0}
              width={window.innerWidth}
              height={window.innerHeight}
              fill="rgba(0,0,0,0.4)"
              globalCompositeOperation="source-over"
            />
          )}
          
          {/* Clear Hole for Selection */}
          {!isExporting && selection && (
            <Rect
              x={selection.x}
              y={selection.y}
              width={selection.width}
              height={selection.height}
              fill="black"
              globalCompositeOperation="destination-out"
            />
          )}
          
          {/* Shapes (only render inside selection) */}
          {selection && selection.width > 0 && (
            <Group
              clipX={selection.x}
              clipY={selection.y}
              clipWidth={selection.width}
              clipHeight={selection.height}
            >
              {shapes.map(shape => {
                if (shape.points.length < 2) return null
                const [start, end] = [shape.points[0], shape.points[shape.points.length - 1]]
                
                if (shape.type === 'rect') {
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Rect
                        x={Math.min(start.x, end.x)}
                        y={Math.min(start.y, end.y)}
                        width={Math.abs(end.x - start.x)}
                        height={Math.abs(end.y - start.y)}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'circle') {
                  const rx = Math.abs(end.x - start.x) / 2
                  const ry = Math.abs(end.y - start.y) / 2
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Circle
                        x={Math.min(start.x, end.x) + rx}
                        y={Math.min(start.y, end.y) + ry}
                        radius={Math.max(rx, ry)} // Simplified circle drawing
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'line') {
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Line
                        points={[start.x, start.y, end.x, end.y]}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                        lineCap="round"
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'arrow') {
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Arrow
                        points={[start.x, start.y, end.x, end.y]}
                        stroke={shape.color}
                        fill={shape.color}
                        strokeWidth={shape.strokeWidth}
                        pointerLength={10}
                        pointerWidth={10}
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'pen') {
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Line
                        points={shape.points.flatMap(p => [p.x, p.y])}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                        tension={0.5}
                        lineCap="round"
                        lineJoin="round"
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'text') {
                  const textRect = getTextRect(shape.points)
                  const isSelected = selectedTextId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Rect
                        x={textRect.x}
                        y={textRect.y}
                        width={textRect.width}
                        height={textRect.height}
                        fill={isSelected ? 'rgba(24,144,255,0.08)' : 'transparent'}
                        stroke={isSelected ? '#1890ff' : 'transparent'}
                        dash={isSelected ? [4, 4] : undefined}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      <Text
                        x={textRect.x + 6}
                        y={textRect.y + 6}
                        width={Math.max(40, textRect.width - 12)}
                        height={Math.max(24, textRect.height - 12)}
                        text={shape.text || ''}
                        fontSize={shape.fontSize || 20}
                        fill={shape.color}
                      />
                      {isSelected && (
                        <>
                          <Circle x={textRect.x} y={textRect.y} radius={4} fill="#1890ff" />
                          <Circle x={textRect.x + textRect.width} y={textRect.y} radius={4} fill="#1890ff" />
                          <Circle x={textRect.x} y={textRect.y + textRect.height} radius={4} fill="#1890ff" />
                          <Circle
                            x={textRect.x + textRect.width}
                            y={textRect.y + textRect.height}
                            radius={6}
                            fill="#1890ff"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                        </>
                      )}
                    </Group>
                  )
                }
                if (shape.type === 'mosaic') {
                  // For mosaic in MVP, we can just draw a thick semi-transparent line or use a custom filter.
                  // Konva supports filters, but for simplicity we draw a thick blurry line.
                  const bounds = getShapeBounds(shape)
                  const isSelected = selectedShapeId === shape.id
                  return (
                    <Group key={shape.id}>
                      <Line
                        points={shape.points.flatMap(p => [p.x, p.y])}
                        stroke="rgba(0,0,0,0.5)"
                        strokeWidth={20}
                        tension={0.5}
                        lineCap="round"
                        lineJoin="round"
                        // A real mosaic would use Konva.Filters.Pixelate on an image clone
                      />
                      {isSelected && bounds && (
                        <Rect
                          x={bounds.x}
                          y={bounds.y}
                          width={bounds.width}
                          height={bounds.height}
                          stroke="#1890ff"
                          strokeWidth={1.5}
                          dash={[4, 4]}
                        />
                      )}
                    </Group>
                  )
                }
                return null
              })}
            </Group>
          )}

          {!isExporting && !selection && hoveredWindow && (
            <Group>
              <Rect
                x={hoveredWindow.bounds.x}
                y={hoveredWindow.bounds.y}
                width={hoveredWindow.bounds.width}
                height={hoveredWindow.bounds.height}
                fill="rgba(24, 144, 255, 0.16)"
                stroke="#1890ff"
                strokeWidth={2.5}
                dash={[6, 4]}
              />
              <Rect
                x={hoveredWindow.bounds.x}
                y={hoveredWindow.bounds.y}
                width={hoveredWindow.bounds.width}
                height={hoveredWindow.bounds.height}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1}
              />
              <Rect
                x={hoveredWindow.bounds.x}
                y={Math.max(8, hoveredWindow.bounds.y - 30)}
                width={Math.min(280, Math.max(120, hoveredWindow.bounds.width))}
                height={24}
                fill="rgba(24, 144, 255, 0.95)"
                cornerRadius={6}
              />
              <Text
                x={hoveredWindow.bounds.x + 8}
                y={Math.max(12, hoveredWindow.bounds.y - 26)}
                text={hoveredWindow.name ? `${hoveredWindow.ownerName} · ${hoveredWindow.name}` : hoveredWindow.ownerName}
                fontSize={12}
                fill="#ffffff"
                width={Math.min(264, Math.max(104, hoveredWindow.bounds.width - 16))}
                ellipsis
              />
            </Group>
          )}

          {/* Selection Border */}
          {!isExporting && selection && (
            <Rect
              x={selection.x}
              y={selection.y}
              width={selection.width}
              height={selection.height}
              stroke="#1890ff"
              strokeWidth={2}
            />
          )}

          {/* Magnifier */}
          {shouldShowMagnifier && pointerPos && (
            <Group
              x={magnifierLeft + 66}
              y={magnifierTop + 66}
              clipFunc={(ctx) => {
                ctx.arc(0, 0, 60, 0, Math.PI * 2, false);
              }}
            >
              <Circle radius={60} stroke="#fff" strokeWidth={2} />
              <KonvaImage
                image={bgImage}
                x={-pointerPos.x * 4}
                y={-pointerPos.y * 4}
                width={window.innerWidth * 4}
                height={window.innerHeight * 4}
              />
              <Rect x={-60} y={-1} width={120} height={2} fill="rgba(24, 144, 255, 0.5)" />
              <Rect x={-1} y={-60} width={2} height={120} fill="rgba(24, 144, 255, 0.5)" />
            </Group>
          )}
        </Layer>
      </Stage>

      {feedback && (
        <div
          className={`absolute left-1/2 top-20 z-50 flex items-center gap-3 -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg ${
            feedback.tone === 'success'
              ? 'bg-zinc-900 text-white'
              : feedback.tone === 'actionable'
                ? 'bg-blue-600 text-white'
              : feedback.tone === 'info'
                ? 'bg-zinc-700 text-white'
                : 'bg-red-600 text-white'
          }`}
        >
          <span>{feedback.message}</span>
          {feedback.actionLabel && feedback.onAction && (
            <button
              type="button"
              className="rounded-md bg-white/15 px-2 py-1 text-xs text-white hover:bg-white/25"
              onClick={feedback.onAction}
            >
              {feedback.actionLabel}
            </button>
          )}
        </div>
      )}

      {shouldShowMagnifier && pointerPos && (
        <div
          className="pointer-events-none absolute z-50 w-36 rounded-xl border border-white/60 bg-zinc-950/80 p-2 text-[11px] text-white shadow-xl backdrop-blur"
          style={{
            left: Math.max(12, Math.min(window.innerWidth - 156, magnifierLeft)),
            top: Math.max(12, Math.min(window.innerHeight - 188, magnifierTop)),
          }}
        >
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-300">
            <span>4x 放大镜</span>
            <span>{pointerColorHex}</span>
          </div>
          <div className="text-xs text-white">{`X: ${Math.round(pointerPos.x)}  Y: ${Math.round(pointerPos.y)}`}</div>
          {selection && (
            <div className="mt-1 text-xs text-zinc-300">
              {`W: ${Math.round(selection.width)}  H: ${Math.round(selection.height)}`}
            </div>
          )}
        </div>
      )}

      {selection && selection.width > 0 && selection.height > 0 && (
        <div
          className="absolute rounded bg-zinc-900/80 px-2 py-1 text-xs text-white pointer-events-none"
          style={{
            left: Math.max(12, selection.x),
            top: Math.max(12, selection.y - 28),
          }}
        >
          {Math.round(selection.width)} x {Math.round(selection.height)}
        </div>
      )}

      {selection && selection.width > 0 && selection.height > 0 && !isSelecting && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="pointer-events-none absolute"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          >
            <div
              className={`absolute inset-0 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-move'}`}
              onMouseDown={handleSelectionMoveStart}
            />
            <div
              className={`absolute left-2 right-2 top-[-4px] h-2 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-ns-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('top', event)}
            />
            <div
              className={`absolute bottom-[-4px] left-2 right-2 h-2 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-ns-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('bottom', event)}
            />
            <div
              className={`absolute bottom-2 left-[-4px] top-2 w-2 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-ew-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('left', event)}
            />
            <div
              className={`absolute bottom-2 right-[-4px] top-2 w-2 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-ew-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('right', event)}
            />
            <div
              className={`absolute left-[-6px] top-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-nwse-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('top-left', event)}
            />
            <div
              className={`absolute right-[-6px] top-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-nesw-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('top-right', event)}
            />
            <div
              className={`absolute bottom-[-6px] left-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-nesw-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('bottom-left', event)}
            />
            <div
              className={`absolute bottom-[-6px] right-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 ${activeTool ? 'pointer-events-none' : 'pointer-events-auto cursor-nwse-resize'}`}
              onMouseDown={(event) => handleSelectionResizeStart('bottom-right', event)}
            />
          </div>
        </div>
      )}

      {selection && selection.width > 0 && !isSelecting && (
        <div className="pointer-events-none absolute inset-0 z-[25]">
          {!activeTool && shapes
            .filter((shape) => shape.type !== 'text')
            .map((shape) => {
              const bounds = getShapeBounds(shape)
              if (!bounds) {
                return null
              }

              return (
                <div
                  key={`shape-overlay-${shape.id}`}
                  className="pointer-events-none absolute"
                  style={{
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  }}
                >
                  <div
                    className={`absolute inset-0 pointer-events-auto rounded ${selectedShapeId === shape.id ? 'border border-dashed border-blue-500 bg-blue-500/5' : ''}`}
                    onMouseDown={(event) => handleShapeSelect(shape, event)}
                  />
                  {selectedShapeId === shape.id && (
                    <>
                      <div
                        className="pointer-events-auto absolute left-2 right-2 top-[-4px] h-2 cursor-ns-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'top', event)}
                      />
                      <div
                        className="pointer-events-auto absolute bottom-[-4px] left-2 right-2 h-2 cursor-ns-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'bottom', event)}
                      />
                      <div
                        className="pointer-events-auto absolute bottom-2 left-[-4px] top-2 w-2 cursor-ew-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'left', event)}
                      />
                      <div
                        className="pointer-events-auto absolute bottom-2 right-[-4px] top-2 w-2 cursor-ew-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'right', event)}
                      />
                      <div
                        className="pointer-events-auto absolute left-[-6px] top-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 cursor-nwse-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'top-left', event)}
                      />
                      <div
                        className="pointer-events-auto absolute right-[-6px] top-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 cursor-nesw-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'top-right', event)}
                      />
                      <div
                        className="pointer-events-auto absolute bottom-[-6px] left-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 cursor-nesw-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'bottom-left', event)}
                      />
                      <div
                        className="pointer-events-auto absolute bottom-[-6px] right-[-6px] h-3 w-3 rounded-full border border-white bg-blue-500 cursor-nwse-resize"
                        onMouseDown={(event) => handleShapeResizeStart(shape, bounds, 'bottom-right', event)}
                      />
                    </>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {selection && selection.width > 0 && !isSelecting && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {shapes
            .filter((shape) => shape.type === 'text')
            .map((shape) => {
              const rect = getTextRect(shape.points)
              const isSelected = selectedTextId === shape.id
              const isEditing = editingTextId === shape.id

              return (
                <div
                  key={`text-overlay-${shape.id}`}
                  className="pointer-events-auto absolute"
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                  }}
                >
                  <div
                    className={`absolute inset-0 rounded ${isSelected ? 'border-2 border-dashed border-blue-500 bg-blue-500/10' : 'border border-transparent'}`}
                    onMouseDown={(event) => handleTextMoveStart(shape.id, event, rect)}
                  />
                  <div
                    className="absolute inset-[6px] cursor-text overflow-hidden whitespace-pre-wrap break-words text-transparent"
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      event.preventDefault()
                      setSelectedShapeId(null)
                      setSelectedTextId(shape.id)
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      beginTextEditing(shape.id)
                    }}
                  >
                    {shape.text || ''}
                  </div>
                  {isSelected && !isEditing && (
                    <>
                      <div className="absolute left-[-4px] top-[-4px] h-2 w-2 rounded-full bg-blue-500" />
                      <div className="absolute right-[-4px] top-[-4px] h-2 w-2 rounded-full bg-blue-500" />
                      <div className="absolute bottom-[-4px] left-[-4px] h-2 w-2 rounded-full bg-blue-500" />
                      <div
                        className="absolute bottom-[-6px] right-[-6px] h-3 w-3 cursor-se-resize rounded-full border border-white bg-blue-500"
                        onMouseDown={(event) => handleTextResizeStart(shape.id, event, rect)}
                      />
                    </>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {editingTextRect && activeEditingShape && (
        <textarea
          ref={textareaRef}
          value={activeEditingShape.text ?? ''}
          onChange={(event) => handleTextChange(event.target.value)}
          onBlur={() => finishTextEditing(editingTextId)}
          onKeyDown={handleTextKeyDown}
          onMouseDown={(event) => event.stopPropagation()}
          autoFocus
          className="absolute z-40 resize-none overflow-hidden rounded border border-blue-500 bg-white/95 px-2 py-1 text-zinc-900 shadow-lg outline-none"
          style={{
            left: editingTextRect.x,
            top: editingTextRect.y,
            width: editingTextRect.width,
            height: editingTextRect.height,
            color: activeEditingShape.color,
            fontSize: activeEditingShape.fontSize || 20,
            lineHeight: 1.4,
          }}
        />
      )}

      {ocrResult && selection && selection.width > 0 && !isSelecting && (
        <div
          className="absolute z-50 w-[min(420px,calc(100vw-24px))] rounded-xl border border-zinc-200 bg-white/95 p-3 text-zinc-800 shadow-xl backdrop-blur pointer-events-auto"
          style={{
            left: Math.min(window.innerWidth - 432, Math.max(12, resolvedToolbarLeft)),
            top: Math.min(window.innerHeight - 420, resolvedToolbarTop + 60),
          }}
          onMouseDown={stopToolbarPointerEvent}
          onMouseUp={stopToolbarPointerEvent}
          onClick={stopToolbarPointerEvent}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-900">OCR 结果</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                onMouseDown={stopToolbarPointerEvent}
                onClick={handleCopyOCRResult}
              >
                复制
              </button>
              <button
                type="button"
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                onMouseDown={stopToolbarPointerEvent}
                onClick={() => {
                  setOcrResult('')
                  setTranslatedResult('')
                }}
              >
                关闭
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-500">识别结果</div>
              <textarea
                readOnly
                value={ocrResult}
                className="h-32 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-800 outline-none"
              />
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-zinc-500">翻译结果</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={translationSourceLang}
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 outline-none"
                    onMouseDown={stopToolbarPointerEvent}
                    onChange={(event) => {
                      setTranslationSourceLang(event.target.value as 'auto' | 'zh' | 'en')
                      setTranslatedResult('')
                    }}
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{`源语言: ${option.label}`}</option>
                    ))}
                  </select>
                  <select
                    value={translationTarget}
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 outline-none"
                    onMouseDown={stopToolbarPointerEvent}
                    onChange={(event) => {
                      setTranslationTarget(event.target.value as 'zh' | 'en')
                      setTranslatedResult('')
                    }}
                  >
                    {LANGUAGE_OPTIONS.filter((option) => option.value !== 'auto').map((option) => (
                      <option key={option.value} value={option.value}>{`目标语言: ${option.label}`}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isTranslating}
                    onMouseDown={stopToolbarPointerEvent}
                    onClick={() => void handleTranslateResult('zh')}
                  >
                    翻译成中文
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isTranslating}
                    onMouseDown={stopToolbarPointerEvent}
                    onClick={() => void handleTranslateResult('en')}
                  >
                    翻译成英文
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!translatedResult.trim() || isTranslating}
                    onMouseDown={stopToolbarPointerEvent}
                    onClick={handleCopyTranslatedResult}
                  >
                    复制翻译
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-white"
                    onMouseDown={stopToolbarPointerEvent}
                    onClick={() => void handleRememberTranslationDefaults()}
                  >
                    记为默认
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={isTranslating ? `正在从${translationSourceLang === 'auto' ? '自动检测' : translationSourceLang === 'zh' ? '中文' : '英文'}翻译为${translationTarget === 'zh' ? '中文' : '英文'}...` : translatedResult}
                placeholder="点击上方按钮开始翻译"
                className="h-28 w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-800 outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {selection && selection.width > 0 && !isSelecting && !isDrawing && (
        <div
          className="absolute z-50 flex max-w-[min(92vw,980px)] flex-wrap select-none items-center gap-2 rounded-md bg-white p-2 text-zinc-700 shadow-lg pointer-events-auto"
          style={{
            left: resolvedToolbarLeft,
            top: resolvedToolbarTop,
          }}
          onMouseDown={stopToolbarPointerEvent}
          onMouseUp={stopToolbarPointerEvent}
          onClick={stopToolbarPointerEvent}
        >
          <div
            className="flex cursor-move items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100"
            onMouseDown={handleToolbarDragStart}
          >
            <GripHorizontal size={14} />
            拖动
          </div>
          <div className="h-5 w-px bg-zinc-300" />
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'rect' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('rect')}><Square size={18} /></button>
            {renderToolConfigPanel('rect')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'circle' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('circle')}><CircleIcon size={18} /></button>
            {renderToolConfigPanel('circle')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'line' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('line')}><Minus size={18} /></button>
            {renderToolConfigPanel('line')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'arrow' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('arrow')}><ArrowUpRight size={18} /></button>
            {renderToolConfigPanel('arrow')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'pen' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('pen')}><Pen size={18} /></button>
            {renderToolConfigPanel('pen')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'text' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={handleTextToolClick}><Type size={18} /></button>
            {renderToolConfigPanel('text')}
          </div>
          <div className="relative">
            <button type="button" className={`rounded p-1.5 hover:bg-zinc-100 ${visibleStyleTool === 'mosaic' ? 'bg-zinc-200' : ''}`} disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => toggleTool('mosaic')}><BoxSelect size={18} /></button>
            {renderToolConfigPanel('mosaic')}
          </div>
          {selectedAnnotatingShape && !editingTextId && (
            <>
              <div className="w-px h-5 bg-zinc-300 mx-1" />
              <button
                type="button"
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isActionPending}
                onMouseDown={stopToolbarPointerEvent}
                onClick={handleDuplicateSelectedShape}
              >
                复制标注
              </button>
              <button
                type="button"
                className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isActionPending}
                onMouseDown={stopToolbarPointerEvent}
                onClick={handleDeleteSelectedShape}
              >
                删除标注
              </button>
            </>
          )}
          <div className="w-px h-5 bg-zinc-300 mx-1" />
          <button type="button" className="rounded p-1.5 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={undo}><Undo2 size={18} /></button>
          <button type="button" className="rounded p-1.5 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={redo}><Redo2 size={18} /></button>
          <div className="w-px h-5 bg-zinc-300 mx-1" />
          <button type="button" className="rounded p-1.5 text-blue-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => handleExport('copy')}><Copy size={18} /></button>
          <button type="button" className="rounded p-1.5 text-green-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => handleExport('save')}><Download size={18} /></button>
          <button type="button" className="rounded p-1.5 text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={() => void handlePin()}><PinIcon size={18} /></button>
          <button type="button" className="rounded p-1.5 text-purple-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={handleOCR}><ScanText size={18} /></button>
          {lastExportedFilePath && (
            <button
              type="button"
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              disabled={isActionPending}
              onMouseDown={stopToolbarPointerEvent}
              onClick={() => void handleRevealFile(lastExportedFilePath)}
            >
              显示文件
            </button>
          )}
          <div className="w-px h-5 bg-zinc-300 mx-1" />
          <button type="button" className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={resetSelectionForReselect}><X size={18} /></button>
          <button type="button" className="rounded p-1.5 text-green-600 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isActionPending} onMouseDown={stopToolbarPointerEvent} onClick={handleCloseCapture}><Check size={18} /></button>
        </div>
      )}
    </div>
  )
}
