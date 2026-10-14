import type { Connection, Obstacle, SimpleRouteJson, Terminal } from "lib/types"

/** Screenshot reconstruction: dimensions estimated, topology preserved.
 * 18.4mm board, SOIC-14 1.27mm pitch, 2mm edge-header pitch.
 * Silkscreen NAND symbols are not copper obstacles; no body keepout under U1.
 */
export function create74Hc00Board(): SimpleRouteJson {
  const pads = new Map<string, Terminal>()
  const obstacles: Obstacle[] = []
  const pad = (id: string, x: number, y: number, width = 1.6, height = 1.6) => {
    pads.set(id, { x, y, layer: "top", pcb_port_id: id })
    obstacles.push({
      type: "rect",
      center: { x, y },
      width,
      height,
      layers: ["top"],
      connectedTo: [id],
    })
  }
  for (let i = 1; i <= 7; i++) {
    pad(`U1.${i}`, -2.5, (4 - i) * 1.27, 1.9, 0.6)
    pad(`U1.${15 - i}`, 2.5, (4 - i) * 1.27, 1.9, 0.6)
  }
  for (let i = 0; i < 6; i++) {
    pad(`MC${6 - i}`, -8, 5 - 2 * i)
    pad(`MC${8 + i}`, 8, 5 - 2 * i)
  }
  pad("MP2", -8, 8)
  pad("MP3", 8, 8)
  pad("MC7", 0, 8)
  pad("MP1", -8, -8)
  pad("MP4", 8, -8)
  pad("MC14", 0, -8)
  pad("C1.1", 1.5, 6.2, 0.6, 0.8)
  pad("C1.2", 2.5, 6.2, 0.6, 0.8)
  const connections: Connection[] = []
  const net = (name: string, ids: string[]) => {
    connections.push({ name, pointsToConnect: ids.map((id) => pads.get(id)!) })
    for (const o of obstacles)
      if (o.connectedTo.some((id) => ids.includes(id))) o.connectedTo.push(name)
  }
  for (const [i, name] of ["1A", "1B", "1Y", "2A", "2B", "2Y"].entries())
    net(name, [`U1.${i + 1}`, `MC${6 - i}`])
  for (const [i, name] of ["4B", "4A", "4Y", "3B", "3A", "3Y"].entries())
    net(name, [`U1.${13 - i}`, `MC${8 + i}`])
  net("VCC", ["U1.14", "C1.2", "MC7", "MP2", "MP3"])
  net("GND", ["U1.7", "C1.1", "MC14", "MP1", "MP4"])
  return {
    layerCount: 1,
    minTraceWidth: 0.2,
    bounds: { minX: -9.2, maxX: 9.2, minY: -9.2, maxY: 9.2 },
    obstacles,
    connections,
  }
}
