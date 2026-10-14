import type { Connection } from "./types"

/** Core often emits one connection per trace, even when they share a port.
 * Join shared electrical terminals and explicit root aliases transitively.
 */
export function groupConnections(connections: Connection[]): Connection[][] {
  const parent = connections.map((_, i) => i)
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]!))
  const identities = new Map<string, number>()
  for (const [i, c] of connections.entries()) {
    const keys = [
      c.name,
      c.rootConnectionName,
      ...(c.mergedConnectionNames ?? []),
      ...c.pointsToConnect.flatMap((p) => [
        p.pcb_port_id,
        `terminal:${p.layer}:${p.x}:${p.y}`,
      ]),
    ].filter((key): key is string => key !== undefined)
    for (const key of keys) {
      const previous = identities.get(key)
      if (previous !== undefined) parent[root(i)] = root(previous)
      else identities.set(key, i)
    }
  }
  const groups = new Map<number, Connection[]>()
  for (const [i, c] of connections.entries()) {
    const id = root(i)
    groups.set(id, [...(groups.get(id) ?? []), c])
  }
  return [...groups.values()]
}
