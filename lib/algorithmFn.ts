import { SingleLayerGridRouter } from "./SingleLayerGridRouter"
import type {
  RouterOptions,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "./types"

type Events = {
  complete: { type: "complete"; traces: SimplifiedPcbTrace[] }
  error: { type: "error"; error: Error }
  progress: { type: "progress"; steps: number; progress: number; phase: string }
}

/** Event adapter implementing tscircuit's GenericLocalAutorouter contract. */
export class SingleLayerGridAutorouter {
  readonly solver: SingleLayerGridRouter
  isRouting = false
  private generation = 0
  private handlers: { [K in keyof Events]: ((event: Events[K]) => void)[] } = {
    complete: [],
    error: [],
    progress: [],
  }
  constructor(
    readonly input: SimpleRouteJson,
    options: RouterOptions = {},
  ) {
    this.solver = new SingleLayerGridRouter(input, options)
  }
  on<K extends keyof Events>(event: K, handler: (value: Events[K]) => void) {
    this.handlers[event].push(handler)
  }
  private emit<K extends keyof Events>(event: K, value: Events[K]) {
    for (const handler of this.handlers[event]) handler(value)
  }
  start(): void {
    if (this.isRouting) return
    this.isRouting = true
    const generation = ++this.generation
    const tick = () => {
      if (!this.isRouting || generation !== this.generation) return
      try {
        this.solver.step()
        if (this.solver.failed)
          throw new Error(this.solver.error ?? "Single-layer routing failed")
        this.emit("progress", {
          type: "progress",
          steps: this.solver.iterations,
          progress: this.solver.progress,
          phase: "single-layer-grid",
        })
        if (!this.isRouting || generation !== this.generation) return
        if (this.solver.solved) {
          this.isRouting = false
          this.emit("complete", {
            type: "complete",
            traces: this.solver.getOutput(),
          })
        } else setTimeout(tick, 0)
      } catch (error) {
        this.isRouting = false
        this.emit("error", {
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
    setTimeout(tick, 0)
  }
  stop(): void {
    this.isRouting = false
    this.generation++
  }
  solveSync(): SimplifiedPcbTrace[] {
    this.solver.solve()
    return this.solver.getOutput()
  }
}

export function createSingleLayerGridAlgorithmFn(options: RouterOptions = {}) {
  return async (input: SimpleRouteJson) =>
    new SingleLayerGridAutorouter(input, options)
}
export const algorithmFn = createSingleLayerGridAlgorithmFn()
