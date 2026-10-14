import { expect } from "bun:test"
import { algorithmFn } from "lib/index"
import { create74Hc00Board } from "./74hc00-board"
import { expectValidRouting } from "./expect-valid-routing"

export async function exerciseAdapter(name: "stop-restart" | "error") {
  const input = create74Hc00Board()
  if (name === "error")
    input.connections[0]!.pointsToConnect[1]!.layer = "bottom"
  const router = await algorithmFn(input)
  let completions = 0
  let stopped = false
  const events: number[] = []
  const outcome = new Promise<"complete" | "error">((resolve) => {
    router.on("progress", (e) => {
      events.push(e.progress)
      if (name === "stop-restart" && !stopped) {
        stopped = true
        router.stop()
        expect(router.isRouting).toBe(false)
        setTimeout(() => router.start(), 0)
      }
    })
    router.on("complete", () => {
      completions++
      resolve("complete")
    })
    router.on("error", (e) => {
      expect(e.error).toBeInstanceOf(Error)
      resolve("error")
    })
  })
  router.start()
  router.start() // A duplicate start must not schedule another solve.
  expect(await outcome).toBe(name === "error" ? "error" : "complete")
  expect(router.isRouting).toBe(false)
  expect(completions).toBe(name === "error" ? 0 : 1)
  if (name === "stop-restart") {
    expect(stopped).toBe(true)
    expect(events.at(-1)).toBe(1)
    expectValidRouting(router.solver)
    expect(router.solveSync()).toEqual(router.solver.getOutput())
  }
  return router.solver
}
