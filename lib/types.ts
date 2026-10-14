export type Point = { x: number; y: number }
export type Terminal = Point & { layer: string; pcb_port_id?: string }
export type Obstacle = {
  // Core types declare rect, but its runtime also emits oval (conservatively bounded as a rectangle).
  type: "rect"
  shape?: "circle"
  center: Point
  width: number
  height: number
  layers: string[]
  connectedTo: string[]
  ccwRotationDegrees?: number
  isNonPlatedHole?: boolean
}
export type Connection = {
  name: string
  rootConnectionName?: string
  mergedConnectionNames?: string[]
  pointsToConnect: Terminal[]
  nominalTraceWidth?: number
  width?: number
}
/** Structural subset of tscircuit's SimpleRouteJson. Dimensions are in mm. */
export type SimpleRouteJson = {
  layerCount: number
  minTraceWidth: number
  nominalTraceWidth?: number
  defaultObstacleMargin?: number
  minTraceToPadEdgeClearance?: number
  minTraceToHoleEdgeClearance?: number
  minBoardEdgeClearance?: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  obstacles: Obstacle[]
  connections: Connection[]
  traces?: SimplifiedPcbTrace[]
  outline?: Point[]
}
export type SimplifiedPcbTrace = {
  type: "pcb_trace"
  pcb_trace_id: string
  connection_name: string
  route: (Point & { route_type: "wire"; width: number; layer: string })[]
}
export type RouterOptions = {
  gridSize?: number
  clearance?: number
  layer?: string
  maxAttempts?: number
  maxGridCells?: number
}
