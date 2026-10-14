import { expect } from "bun:test"
import { SingleLayerGridRouter, type SimpleRouteJson } from "lib/index"
import retryBoard from "./retry-board.json"
import { expectValidRouting } from "./expect-valid-routing"

export const routingCases = [
  "off-grid-bottom",
  "rotated-obstacles",
  "blocked",
  "mixed-layers",
  "existing-copper",
  "merged-net",
  "rip-up-retry",
] as const
export type RoutingCase = (typeof routingCases)[number]

export function solveRoutingCase(name: RoutingCase) {
  let input: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3.93, y: -0.03, layer: "top" },
          { x: 3.93, y: 0.03, layer: "top" },
        ],
      },
    ],
  }
  if (name === "off-grid-bottom")
    for (const p of input.connections[0]!.pointsToConnect) p.layer = "bottom"
  if (name === "mixed-layers")
    input.connections[0]!.pointsToConnect[1]!.layer = "bottom"
  if (name === "blocked")
    input.obstacles.push({
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 8,
      layers: ["top"],
      connectedTo: [],
    })
  if (name === "rotated-obstacles")
    input.obstacles.push(
      {
        type: "rect",
        center: { x: -1, y: 0 },
        width: 1,
        height: 2.5,
        ccwRotationDegrees: 35,
        layers: ["top"],
        connectedTo: [],
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 1, y: 0 },
        width: 1.5,
        height: 1.5,
        layers: ["bottom"],
        connectedTo: [],
        isNonPlatedHole: true,
      },
    )
  if (name === "existing-copper")
    input.traces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "other",
        route: [
          { route_type: "wire", x: 0, y: -2, layer: "top", width: 0.6 },
          { route_type: "wire", x: 0, y: 2, layer: "top", width: 0.6 },
        ],
      },
    ]
  if (name === "merged-net") {
    input.connections = [
      {
        name: "branch1",
        rootConnectionName: "power",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 0, y: 2, layer: "top" },
        ],
      },
      {
        name: "branch2",
        rootConnectionName: "power",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: 0, y: 2, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ]
  }
  if (name === "rip-up-retry") input = retryBoard
  const options =
    name === "rip-up-retry"
      ? { gridSize: 0.2, maxAttempts: 4 }
      : { maxAttempts: 2 }
  const before = JSON.stringify(input)
  const solver = new SingleLayerGridRouter(input, options)
  solver.solve()
  expect(JSON.stringify(input)).toBe(before)
  if (name === "blocked" || name === "mixed-layers") {
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toBeString()
    expect(() => solver.getOutput()).toThrow()
  } else {
    expectValidRouting(solver)
    const repeated = new SingleLayerGridRouter(input, options)
    repeated.solve()
    expect(repeated.getOutput()).toEqual(solver.getOutput())
    if (name === "rip-up-retry") expect(solver.stats.attempt).toBeGreaterThan(1)
    if (name === "existing-copper") {
      // Fixed vertical copper remains at least 0.55mm from the new trace.
      for (const t of solver.getOutput())
        for (const p of t.route) {
          if (Math.abs(p.y) <= 2)
            expect(Math.abs(p.x)).toBeGreaterThanOrEqual(0.55)
        }
    }
    if (name === "merged-net")
      for (const t of solver.getOutput())
        for (const p of t.route) expect(p.width).toBe(0.4)
  }
  return solver
}
