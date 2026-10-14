import { expect, test } from "bun:test"
import { exerciseAdapter } from "./fixtures/adapter-cases"

for (const name of ["stop-restart", "error"] as const) {
  test(name, async () => {
    const solver = await exerciseAdapter(name)
    await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
      svgName: `adapter-${name}`,
    })
  })
}
