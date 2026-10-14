import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { SingleLayerGridRouter } from "lib/index"
import { create74Hc00Board } from "tests/fixtures/74hc00-board"

export default (
  <GenericSolverDebugger
    createSolver={() => new SingleLayerGridRouter(create74Hc00Board())}
  />
)
