import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { obstacleDistance, pointSegmentDistance, simplify } from "./geometry"
import { groupConnections } from "./group-connections"
import { MinHeap } from "./min-heap"
import type {
  Connection,
  Point,
  RouterOptions,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  Terminal,
} from "./types"

type Net = {
  name: string
  aliases: Set<string>
  points: Terminal[]
  width: number
}
type Job = { net: Net; from: Terminal; to: Terminal }

/** Conservative 4-neighbor A*, with whole-board rip-up and reordered retries. */
export class SingleLayerGridRouter extends BaseSolver {
  readonly gridSize: number
  readonly clearance: number
  readonly layer: string
  private nx = 0
  private ny = 0
  private nets: Net[] = []
  private jobs: Job[] = []
  private jobIndex = 0
  private attempt = 0
  private traces: SimplifiedPcbTrace[] = []
  private fixedTraces: SimplifiedPcbTrace[] = []

  constructor(
    readonly input: SimpleRouteJson,
    readonly options: RouterOptions = {},
  ) {
    super()
    this.gridSize = options.gridSize ?? 0.1
    this.clearance =
      options.clearance ??
      Math.max(
        input.defaultObstacleMargin ?? 0.15,
        input.minTraceToPadEdgeClearance ?? 0,
        input.minTraceToHoleEdgeClearance ?? 0,
      )
    this.layer =
      options.layer ??
      input.connections.flatMap((c) => c.pointsToConnect)[0]?.layer ??
      "top"
    this.MAX_ITERATIONS = 100_000
  }

  private fail(message: string) {
    this.failed = true
    this.error = message
  }

  override _setup() {
    const b = this.input.bounds
    if (
      !Number.isFinite(this.gridSize) ||
      this.gridSize <= 0 ||
      !Number.isFinite(this.clearance) ||
      this.clearance < 0 ||
      !Number.isFinite(this.input.minTraceWidth) ||
      this.input.minTraceWidth <= 0 ||
      !Object.values(b).every(Number.isFinite) ||
      b.maxX <= b.minX ||
      b.maxY <= b.minY ||
      (this.options.maxAttempts ?? 16) < 1
    ) {
      this.fail("Invalid grid, bounds, width, clearance, or retry limit")
      return
    }
    if (this.input.outline?.length) {
      this.fail("Polygon outlines are unsupported; supply rectangular bounds")
      return
    }
    this.nx = Math.floor((b.maxX - b.minX) / this.gridSize + 1e-9) + 1
    this.ny = Math.floor((b.maxY - b.minY) / this.gridSize + 1e-9) + 1
    if (this.nx * this.ny > (this.options.maxGridCells ?? 1_000_000)) {
      this.fail("Grid exceeds maxGridCells; increase gridSize")
      return
    }
    for (const o of this.input.obstacles) {
      if (
        !["rect", "oval"].includes(o.type) ||
        !Number.isFinite(o.width) ||
        !Number.isFinite(o.height) ||
        o.width <= 0 ||
        o.height <= 0 ||
        !Number.isFinite(o.center.x) ||
        !Number.isFinite(o.center.y) ||
        !Number.isFinite(o.ccwRotationDegrees ?? 0)
      ) {
        this.fail("Invalid obstacle geometry")
        return
      }
    }
    for (const group of groupConnections(this.input.connections)) {
      const name =
        group.find((c) => c.rootConnectionName)?.rootConnectionName ??
        group[0]!.name
      const net: Net = {
        name,
        aliases: new Set<string>(),
        points: [],
        width: this.input.minTraceWidth,
      }
      for (const c of group) {
        for (const alias of [name, c.name, ...(c.mergedConnectionNames ?? [])])
          net.aliases.add(alias)
        net.width = Math.max(
          net.width,
          c.nominalTraceWidth ??
            c.width ??
            this.input.nominalTraceWidth ??
            this.input.minTraceWidth,
        )
        if (!Number.isFinite(net.width)) {
          this.fail(`Invalid width for ${name}`)
          return
        }
        for (const p of c.pointsToConnect) {
          if (
            p.layer !== this.layer ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < b.minX ||
            p.x > b.maxX ||
            p.y < b.minY ||
            p.y > b.maxY
          ) {
            this.fail(
              `Terminal for ${name} must be inside bounds on ${this.layer}`,
            )
            return
          }
          if (p.pcb_port_id) net.aliases.add(p.pcb_port_id)
          if (!net.points.some((q) => q.x === p.x && q.y === p.y))
            net.points.push(p)
        }
      }
      this.nets.push(net)
    }
    this.fixedTraces = this.input.traces ?? []
    if (
      this.fixedTraces.some(
        (t) =>
          t.route.length < 2 ||
          t.route.some(
            (p) =>
              p.route_type !== "wire" ||
              p.layer !== this.layer ||
              !Number.isFinite(p.x) ||
              !Number.isFinite(p.y) ||
              !Number.isFinite(p.width) ||
              p.width <= 0,
          ),
      )
    ) {
      this.fail("Existing traces must be finite single-layer wires")
      return
    }
    this.createJobs()
  }

  private createJobs() {
    const nets = [...this.nets].sort(
      (a, b) => this.span(a) - this.span(b) || a.name.localeCompare(b.name),
    )
    // Alternate forward/reverse orders, then rotate deterministically.
    if (this.attempt % 2) nets.reverse()
    const offset = Math.floor(this.attempt / 2) % (nets.length || 1)
    nets.push(...nets.splice(0, offset))
    this.jobs = []
    for (const net of nets) {
      const connected = net.points.slice(0, 1)
      const remaining = net.points.slice(1)
      while (remaining.length) {
        let best:
          | { from: Terminal; to: Terminal; i: number; distance: number }
          | undefined
        for (const from of connected) {
          for (const [i, to] of remaining.entries()) {
            const distance = Math.hypot(from.x - to.x, from.y - to.y)
            if (!best || distance < best.distance)
              best = { from, to, i, distance }
          }
        }
        this.jobs.push({ net, from: best!.from, to: best!.to })
        connected.push(best!.to)
        remaining.splice(best!.i, 1)
      }
    }
    this.jobIndex = 0
    this.traces = []
  }

  private span(net: Net) {
    if (net.points.length < 2) return 0
    return (
      Math.max(...net.points.map((p) => p.x)) -
      Math.min(...net.points.map((p) => p.x)) +
      Math.max(...net.points.map((p) => p.y)) -
      Math.min(...net.points.map((p) => p.y))
    )
  }

  private point(id: number): Point {
    return {
      x: this.input.bounds.minX + (id % this.nx) * this.gridSize,
      y: this.input.bounds.minY + Math.floor(id / this.nx) * this.gridSize,
    }
  }

  private cell(p: Point) {
    const x = Math.round((p.x - this.input.bounds.minX) / this.gridSize)
    const y = Math.round((p.y - this.input.bounds.minY) / this.gridSize)
    if (x < 0 || y < 0 || x >= this.nx || y >= this.ny) return -1
    return y * this.nx + x
  }

  private blockedCells(net: Net): Uint8Array {
    const blocked = new Uint8Array(this.nx * this.ny)
    const b = this.input.bounds
    // Every edge lies within half a grid diagonal of a tested node, including
    // the exact-terminal-to-grid connector. Inflating covers entire segments.
    const padding = this.gridSize / Math.SQRT2 + 1e-8
    const margin = net.width / 2 + this.clearance + padding
    const edge =
      net.width / 2 +
      (this.input.minBoardEdgeClearance ?? this.clearance) +
      padding
    for (let id = 0; id < blocked.length; id++) {
      const p = this.point(id)
      if (
        p.x < b.minX + edge ||
        p.x > b.maxX - edge ||
        p.y < b.minY + edge ||
        p.y > b.maxY - edge
      )
        blocked[id] = 1
    }
    const paint = (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      inside: (p: Point) => boolean,
    ) => {
      const x0 = Math.max(0, Math.floor((minX - b.minX) / this.gridSize))
      const x1 = Math.min(
        this.nx - 1,
        Math.ceil((maxX - b.minX) / this.gridSize),
      )
      const y0 = Math.max(0, Math.floor((minY - b.minY) / this.gridSize))
      const y1 = Math.min(
        this.ny - 1,
        Math.ceil((maxY - b.minY) / this.gridSize),
      )
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const id = y * this.nx + x
          if (inside(this.point(id))) blocked[id] = 1
        }
    }
    for (const o of this.input.obstacles) {
      if (
        (!o.isNonPlatedHole && !o.layers.includes(this.layer)) ||
        (!o.isNonPlatedHole && o.connectedTo.some((id) => net.aliases.has(id)))
      )
        continue
      const radius = Math.hypot(o.width, o.height) / 2 + margin
      paint(
        o.center.x - radius,
        o.center.x + radius,
        o.center.y - radius,
        o.center.y + radius,
        (p) => obstacleDistance(p, o) < margin,
      )
    }
    for (const t of [...this.fixedTraces, ...this.traces]) {
      if (net.aliases.has(t.connection_name)) continue
      for (let i = 1; i < t.route.length; i++) {
        const a = t.route[i - 1]!
        const z = t.route[i]!
        const radius = margin + Math.max(a.width, z.width) / 2
        paint(
          Math.min(a.x, z.x) - radius,
          Math.max(a.x, z.x) + radius,
          Math.min(a.y, z.y) - radius,
          Math.max(a.y, z.y) + radius,
          (p) => pointSegmentDistance(p, a, z) < radius,
        )
      }
    }
    return blocked
  }

  private route(job: Job): Point[] | null {
    const blocked = this.blockedCells(job.net)
    const start = this.cell(job.from)
    const end = this.cell(job.to)
    if (
      start < 0 ||
      end < 0 ||
      start >= blocked.length ||
      end >= blocked.length ||
      blocked[start] ||
      blocked[end]
    )
      return null
    const costs = new Float64Array(blocked.length).fill(Infinity)
    const previous = new Int32Array(blocked.length).fill(-1)
    const heap = new MinHeap()
    const heuristic = (id: number) =>
      Math.abs((id % this.nx) - (end % this.nx)) +
      Math.abs(Math.floor(id / this.nx) - Math.floor(end / this.nx))
    costs[start] = 0
    heap.push({ id: start, cost: 0, score: heuristic(start) })
    let expanded = 0
    while (heap.length) {
      const current = heap.pop()
      if (current.cost !== costs[current.id]) continue
      if (current.id === end) {
        const path: Point[] = []
        for (let id = end; id !== -1; id = previous[id]!)
          path.push(this.point(id))
        path.reverse()
        this.stats.expandedCells = expanded
        const points = [job.from, ...path, job.to].filter(
          (p, i, all) =>
            i === 0 ||
            Math.hypot(p.x - all[i - 1]!.x, p.y - all[i - 1]!.y) > 1e-9,
        )
        return simplify(points)
      }
      expanded++
      const id = current.id
      const neighbors: number[] = []
      if (id % this.nx > 0) neighbors.push(id - 1)
      if (id % this.nx < this.nx - 1) neighbors.push(id + 1)
      if (id >= this.nx) neighbors.push(id - this.nx)
      if (id + this.nx < blocked.length) neighbors.push(id + this.nx)
      for (const next of neighbors) {
        const cost = current.cost + 1
        if (blocked[next] || cost >= costs[next]!) continue
        costs[next] = cost
        previous[next] = id
        heap.push({ id: next, cost, score: cost + heuristic(next) })
      }
    }
    this.stats.expandedCells = expanded
    return null
  }

  override _step() {
    if (this.failed) return
    if (this.jobIndex === this.jobs.length) {
      this.solved = true
      return
    }
    const job = this.jobs[this.jobIndex]!
    const path = this.route(job)
    if (!path) {
      this.attempt++
      if (this.attempt >= (this.options.maxAttempts ?? 16)) {
        this.fail(
          `Unable to route ${job.net.name} on ${this.layer} after ${this.attempt} attempts`,
        )
      } else this.createJobs()
    } else {
      this.traces.push({
        type: "pcb_trace",
        pcb_trace_id: `single_layer_trace_${this.jobIndex}`,
        connection_name: job.net.name,
        route: path.map((p) => ({
          x: p.x,
          y: p.y,
          route_type: "wire",
          width: job.net.width,
          layer: this.layer,
        })),
      })
      this.jobIndex++
      if (this.jobIndex === this.jobs.length) this.solved = true
    }
    this.stats = {
      ...this.stats,
      attempt: this.attempt + 1,
      routedBranches: this.jobIndex,
      totalBranches: this.jobs.length,
      gridCells: this.nx * this.ny,
    }
  }

  computeProgress() {
    return this.solved ? 1 : this.jobIndex / (this.jobs.length || 1)
  }
  override getConstructorParams() {
    return [this.input, this.options]
  }
  override getOutput(): SimplifiedPcbTrace[] {
    if (!this.solved) throw new Error(this.error ?? "Router has not solved")
    return this.traces
  }

  override visualize(): GraphicsObject {
    const b = this.input.bounds
    const colors = [
      "#e53935",
      "#1e88e5",
      "#43a047",
      "#8e24aa",
      "#fb8c00",
      "#00acc1",
    ]
    return {
      title: `Single-layer grid router (${this.layer})`,
      rects: [
        {
          center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
          width: b.maxX - b.minX,
          height: b.maxY - b.minY,
          stroke: "#777",
          fill: "transparent",
        },
        ...this.input.obstacles
          .filter((o) => o.layers.includes(this.layer) || o.isNonPlatedHole)
          .map((o) => ({
            center: o.center,
            width: o.width,
            height: o.height,
            ccwRotationDegrees: o.ccwRotationDegrees,
            fill: "#999999",
            stroke: "#444",
          })),
      ],
      lines: [...this.fixedTraces, ...this.traces].map((t) => ({
        points: t.route.map(({ x, y }) => ({ x, y })),
        strokeWidth: t.route[0]?.width ?? this.input.minTraceWidth,
        strokeColor:
          colors[
            this.nets.findIndex((n) => n.name === t.connection_name) %
              colors.length
          ] ?? "#333",
        label: t.connection_name,
      })),
      points: this.input.connections.flatMap((c: Connection) =>
        c.pointsToConnect.map((p) => ({
          x: p.x,
          y: p.y,
          color: "#222",
          label: p.pcb_port_id,
        })),
      ),
    }
  }
}
