import { RootCircuit, type GenericLocalAutorouter } from "@tscircuit/core"
import { Fragment } from "react"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { expect } from "bun:test"
import { algorithmFn, type SingleLayerGridAutorouter } from "lib/index"
import { create74Hc00Board } from "./74hc00-board"
import { expectValidRouting } from "./expect-valid-routing"

export async function render74Hc00Circuit() {
  const fixture = create74Hc00Board()
  let router: SingleLayerGridAutorouter | undefined
  const circuit = new RootCircuit()
  const uPads = fixture.obstacles.slice(0, 14)
  const cPads = fixture.obstacles.slice(-2)
  const headers = fixture.obstacles.slice(14, -2)
  const selector = (id: string) =>
    id.includes(".")
      ? `.${id.split(".")[0]} > .pin${id.split(".")[1]}`
      : `.${id} > .pin1`
  circuit.add(
    <board
      width={18.4}
      height={18.4}
      layers={1}
      minTraceWidth={0.2}
      routingDisabled={false}
      autorouter={{
        groupMode: "subcircuit",
        algorithmFn: async (input) => {
          router = await algorithmFn(input)
          const compatible: GenericLocalAutorouter = router
          return compatible
        },
      }}
    >
      <chip
        name="U1"
        pinLabels={Object.fromEntries(
          Array.from({ length: 14 }, (_, i) => [`pin${i + 1}`, `P${i + 1}`]),
        )}
        footprint={
          <footprint>
            {uPads.map((p) => (
              <Fragment key={p.connectedTo[0]}>
                <smtpad
                  portHints={[`pin${p.connectedTo[0]!.split(".")[1]}`]}
                  pcbX={p.center.x}
                  pcbY={p.center.y}
                  width={p.width}
                  height={p.height}
                  shape="rect"
                />
              </Fragment>
            ))}
            <silkscreenrect
              pcbX={0}
              pcbY={0}
              width={3.8}
              height={9}
              strokeWidth={0.1}
            />
          </footprint>
        }
      />
      <capacitor
        name="C1"
        capacitance="100nF"
        pcbX={2}
        pcbY={6.2}
        footprint={
          <footprint>
            {cPads.map((p) => (
              <Fragment key={p.connectedTo[0]}>
                <smtpad
                  portHints={[`pin${p.connectedTo[0]!.split(".")[1]}`]}
                  pcbX={p.center.x - 2}
                  pcbY={0}
                  width={p.width}
                  height={p.height}
                  shape="rect"
                />
              </Fragment>
            ))}
          </footprint>
        }
      />
      {headers.map((p) => (
        <chip
          key={p.connectedTo[0]}
          name={p.connectedTo[0]!}
          pcbX={p.center.x}
          pcbY={p.center.y}
          pinLabels={{ pin1: "PAD" }}
          footprint={
            <footprint>
              <platedhole
                portHints={["pin1"]}
                shape="circle"
                outerDiameter={1.6}
                holeDiameter={0.7}
              />
            </footprint>
          }
        />
      ))}
      {fixture.connections.flatMap((c) =>
        c.pointsToConnect.slice(1).map((p) => (
          <Fragment key={`${c.name}-${p.pcb_port_id}`}>
            <trace
              from={selector(c.pointsToConnect[0]!.pcb_port_id!)}
              to={selector(p.pcb_port_id!)}
            />
          </Fragment>
        )),
      )}
    </board>,
  )
  await circuit.renderUntilSettled()
  expect(router).toBeDefined()
  expectValidRouting(router!.solver)
  expect(circuit.db.pcb_trace.list()).toHaveLength(20)
  expect(circuit.db.pcb_via.list()).toHaveLength(0)
  const errors = circuit
    .getCircuitJson()
    .filter((e) => e.type.includes("error"))
  expect(errors).toEqual([])
  return {
    solver: router!.solver,
    pcbSvg: convertCircuitJsonToPcbSvg(circuit.getCircuitJson()),
  }
}
