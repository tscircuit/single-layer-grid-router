import { expect, test } from "bun:test"
import { SingleLayerGridRouter } from "lib/index"
import { create74Hc00Board } from "./fixtures/74hc00-board"
import { expectValidRouting } from "./fixtures/expect-valid-routing"

test("74HC00 breakout routes entirely on one layer", async () => {
  const solver = new SingleLayerGridRouter(create74Hc00Board())
  solver.solve()
  expectValidRouting(solver)
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
