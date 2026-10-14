# Working on this solver

- Follow tscircuit/handbook's bootstrapping guide. Use Bun, github-vanilla-style TypeScript exports, @tscircuit/solver-utils, and React Cosmos.
- Organize routing logic as step-based solvers under lib/. Preserve BaseSolver's lifecycle, reproducible constructor parameters, useful stats, and visualize().
- Every test must include a visual SVG snapshot, including failure and integration tests. Await visual matchers and commit snapshots. Never accept snapshots without inspecting them.
- Keep test files extremely simple. Put board definitions, setup, geometry checks, and other complexity in tests/fixtures/*.
- Single-layer means every route stays on one copper layer, with no vias or jumpers. Failure must be explicit; never return partial routing as success.
- Run bun test, bun run typecheck, bun run format:check, and bun run build:site before submitting changes.
