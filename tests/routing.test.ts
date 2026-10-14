import { expect, test } from "bun:test"
import { routingCases, solveRoutingCase } from "./fixtures/routing-cases"

for (const name of routingCases) {
  test(name, async () => {
    const solver = solveRoutingCase(name)
    await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
      svgName: name,
    })
  })
}
