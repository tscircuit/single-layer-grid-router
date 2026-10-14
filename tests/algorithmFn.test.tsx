import { expect, test } from "bun:test"
import { render74Hc00Circuit } from "./fixtures/74hc00-circuit"

test("tscircuit routes the 74HC00 board using algorithmFn", async () => {
  const { solver, pcbSvg } = await render74Hc00Circuit()
  await expect(pcbSvg).toMatchSvgSnapshot(import.meta.path, "pcb")
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
