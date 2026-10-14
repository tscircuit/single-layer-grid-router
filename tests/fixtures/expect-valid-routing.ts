import { expect } from "bun:test"
import type { SingleLayerGridRouter } from "lib/index"
import type { Obstacle, Point } from "lib/types"

// Independent continuous geometry checks, not the router's rasterization.
function pointToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  )
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const x = cross(a, b, c)
  const y = cross(a, b, d)
  const z = cross(c, d, a)
  const w = cross(c, d, b)
  if (
    ((x < 0 && y > 0) || (x > 0 && y < 0)) &&
    ((z < 0 && w > 0) || (z > 0 && w < 0))
  )
    return 0
  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  )
}
function segmentToObstacle(a: Point, b: Point, o: Obstacle) {
  if (o.shape === "circle")
    return Math.max(
      0,
      pointToSegment(o.center, a, b) - Math.max(o.width, o.height) / 2,
    )
  const angle = (-(o.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const local = (p: Point) => ({
    x:
      (p.x - o.center.x) * Math.cos(angle) -
      (p.y - o.center.y) * Math.sin(angle),
    y:
      (p.x - o.center.x) * Math.sin(angle) +
      (p.y - o.center.y) * Math.cos(angle),
  })
  a = local(a)
  b = local(b)
  if (
    [a, b].some(
      (p) => Math.abs(p.x) <= o.width / 2 && Math.abs(p.y) <= o.height / 2,
    )
  )
    return 0
  const corners = [
    { x: -o.width / 2, y: -o.height / 2 },
    { x: o.width / 2, y: -o.height / 2 },
    { x: o.width / 2, y: o.height / 2 },
    { x: -o.width / 2, y: o.height / 2 },
  ]
  return Math.min(
    ...corners.map((p, i) => segmentDistance(a, b, p, corners[(i + 1) % 4]!)),
  )
}
const key = (p: Point) => `${p.x.toFixed(8)},${p.y.toFixed(8)}`

export function expectValidRouting(solver: SingleLayerGridRouter) {
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutput()
  // Reconstruct electrical groups independently from shared terminals.
  const groups: (typeof solver.input.connections)[] = []
  for (const c of solver.input.connections) {
    let group = [c]
    for (let i = groups.length - 1; i >= 0; i--) {
      if (
        groups[i]!.some((a) =>
          group.some(
            (b) =>
              (a.rootConnectionName &&
                a.rootConnectionName === b.rootConnectionName) ||
              a.pointsToConnect.some((p) =>
                b.pointsToConnect.some(
                  (q) => p.layer === q.layer && key(p) === key(q),
                ),
              ),
          ),
        )
      )
        group = [...groups.splice(i, 1)[0]!, ...group]
    }
    groups.push(group)
  }
  const nets = new Map(
    groups.map((connections) => [
      connections.find((c) => c.rootConnectionName)?.rootConnectionName ??
        connections[0]!.name,
      connections,
    ]),
  )
  for (const [name, connections] of nets) {
    const points = connections.flatMap((c) => c.pointsToConnect)
    if (points.length < 2) continue
    const graph = new Map<string, Set<string>>()
    for (const t of traces.filter((t) => t.connection_name === name)) {
      const a = key(t.route[0]!)
      const b = key(t.route.at(-1)!)
      graph.set(a, new Set([...(graph.get(a) ?? []), b]))
      graph.set(b, new Set([...(graph.get(b) ?? []), a]))
    }
    const visited = new Set<string>()
    const queue = [key(points[0]!)]
    while (queue.length) {
      const next = queue.pop()!
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(...(graph.get(next) ?? []))
    }
    for (const p of points) expect(visited.has(key(p))).toBe(true)
  }
  const segments = traces.flatMap((t) =>
    t.route
      .slice(1)
      .map((b, i) => ({ a: t.route[i]!, b, name: t.connection_name })),
  )
  for (const t of traces)
    for (const p of t.route) {
      expect(p.route_type).toBe("wire")
      expect(p.layer).toBe(solver.layer)
      const edge =
        p.width / 2 +
        (solver.input.minBoardEdgeClearance ?? solver.clearance) -
        1e-7
      expect(p.x).toBeGreaterThanOrEqual(solver.input.bounds.minX + edge)
      expect(p.x).toBeLessThanOrEqual(solver.input.bounds.maxX - edge)
      expect(p.y).toBeGreaterThanOrEqual(solver.input.bounds.minY + edge)
      expect(p.y).toBeLessThanOrEqual(solver.input.bounds.maxY - edge)
    }
  for (const s of segments) {
    const aliases = nets
      .get(s.name)!
      .flatMap((c) => [
        s.name,
        c.name,
        ...(c.mergedConnectionNames ?? []),
        ...c.pointsToConnect.map((p) => p.pcb_port_id ?? ""),
      ])
    for (const o of solver.input.obstacles) {
      if (
        !o.isNonPlatedHole &&
        (!o.layers.includes(solver.layer) ||
          o.connectedTo.some((a) => aliases.includes(a)))
      )
        continue
      expect(segmentToObstacle(s.a, s.b, o)).toBeGreaterThanOrEqual(
        s.a.width / 2 + solver.clearance - 1e-7,
      )
    }
  }
  for (const s of segments)
    for (const t of solver.input.traces ?? []) {
      if (
        nets
          .get(s.name)!
          .some((c) =>
            [
              c.name,
              c.rootConnectionName,
              ...(c.mergedConnectionNames ?? []),
            ].includes(t.connection_name),
          )
      )
        continue
      for (let i = 1; i < t.route.length; i++) {
        const a = t.route[i - 1]!
        const b = t.route[i]!
        expect(segmentDistance(s.a, s.b, a, b)).toBeGreaterThanOrEqual(
          (s.a.width + Math.max(a.width, b.width)) / 2 +
            solver.clearance -
            1e-7,
        )
      }
    }
  for (const [i, s] of segments.entries())
    for (const t of segments.slice(i + 1)) {
      if (s.name === t.name) continue
      expect(segmentDistance(s.a, s.b, t.a, t.b)).toBeGreaterThanOrEqual(
        (s.a.width + t.a.width) / 2 + solver.clearance - 1e-7,
      )
    }
}
