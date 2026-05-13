import { create } from 'zustand'
import { Point, Shape, ToolType } from './types'

interface EditorState {
  shapes: Shape[]
  history: Shape[][]
  historyStep: number
  activeTool: ToolType | null
  color: string
  strokeWidth: number
  fontSize: number
  
  setActiveTool: (tool: ToolType | null) => void
  setColor: (color: string) => void
  setStrokeWidth: (width: number) => void
  setFontSize: (size: number) => void
  
  addShape: (shape: Shape) => void
  updateShape: (id: string, shape: Partial<Shape>) => void
  updateShapePoints: (id: string, points: Point[]) => void
  replaceShapes: (shapes: Shape[]) => void
  duplicateShape: (id: string) => string | null
  removeShape: (id: string) => void
  commitHistory: () => void
  undo: () => void
  redo: () => void
  clear: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  shapes: [],
  history: [[]],
  historyStep: 0,
  activeTool: null,
  color: '#ff0000',
  strokeWidth: 4,
  fontSize: 20,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setFontSize: (fontSize) => set({ fontSize }),

  addShape: (shape) => {
    const { shapes, history, historyStep } = get()
    const newShapes = [...shapes, shape]
    const newHistory = history.slice(0, historyStep + 1)
    newHistory.push(newShapes)
    set({ shapes: newShapes, history: newHistory, historyStep: newHistory.length - 1 })
  },

  updateShape: (id, newProps) => {
    const { shapes } = get()
    const newShapes = shapes.map(s => s.id === id ? { ...s, ...newProps } : s)
    set({ shapes: newShapes })
  },

  updateShapePoints: (id, points) => {
    const { shapes } = get()
    set({
      shapes: shapes.map((shape) => shape.id === id ? { ...shape, points } : shape),
    })
  },

  replaceShapes: (shapes) => {
    set({ shapes })
  },

  duplicateShape: (id) => {
    const { shapes, history, historyStep } = get()
    const target = shapes.find((shape) => shape.id === id)
    if (!target) {
      return null
    }

    const duplicateId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const offset = 16
    const duplicatedShape: Shape = {
      ...target,
      id: duplicateId,
      points: target.points.map((point) => ({
        x: point.x + offset,
        y: point.y + offset,
      })),
    }
    const newShapes = [...shapes, duplicatedShape]
    const newHistory = history.slice(0, historyStep + 1)
    newHistory.push(newShapes)
    set({ shapes: newShapes, history: newHistory, historyStep: newHistory.length - 1 })
    return duplicateId
  },

  removeShape: (id) => {
    const { shapes, history, historyStep } = get()
    const newShapes = shapes.filter(s => s.id !== id)
    const newHistory = history.slice(0, historyStep + 1)
    newHistory.push(newShapes)
    set({ shapes: newShapes, history: newHistory, historyStep: newHistory.length - 1 })
  },

  commitHistory: () => {
    const { shapes, history, historyStep } = get()
    const newHistory = history.slice(0, historyStep + 1)
    newHistory.push([...shapes])
    set({ history: newHistory, historyStep: newHistory.length - 1 })
  },

  undo: () => {
    const { historyStep, history } = get()
    if (historyStep > 0) {
      set({ historyStep: historyStep - 1, shapes: history[historyStep - 1] })
    }
  },

  redo: () => {
    const { historyStep, history } = get()
    if (historyStep < history.length - 1) {
      set({ historyStep: historyStep + 1, shapes: history[historyStep + 1] })
    }
  },

  clear: () => set({ shapes: [], history: [[]], historyStep: 0 })
}))
