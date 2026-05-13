export type ToolType = 'rect' | 'circle' | 'line' | 'arrow' | 'pen' | 'text' | 'mosaic'

export interface Point {
  x: number
  y: number
}

export interface ShapeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShapeMeta {
  kind?: 'freehand' | 'primitive'
}

export interface Shape {
  id: string
  type: ToolType
  points: Point[]
  color: string
  strokeWidth: number
  text?: string
  fontSize?: number
  bounds?: ShapeBounds
  meta?: ShapeMeta
}
