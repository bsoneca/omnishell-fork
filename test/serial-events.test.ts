// A reduce concludes from the rows it is given, so two of its runs at once
// each conclude from a world missing the other's writes. Taps fire faster than
// a run reads, reduces and writes: four quick taps on a count that each add
// one must leave four, and the last must see the three before it. A reduce's
// runs take turns, in the order their events fired, screen-wide — a tap in one
// region and a tap in another that name the same reduce share its world.
import { describe, expect, it } from "@test/harness"
import { mountScreen } from "./screen-harness.ts"

const REDUCE = `(state, event) => {
  const n = Number(state.rows.tally?.[0]?.n ?? 0);
  return { updates: [{ op: "patch", entity: "tally", id: "t", row: { n: n + 1, last: event.from ?? "" } }] };
}`

const ROUTE = {
  screen: "count",
  files: { html: "count.html", css: "count.css", handlers: ["shell/handlers/add.js"] },
  states: ["loading", "empty", "populated"],
}

const FILES = {
  "count.html": `<section class="screen" data-screen="count">
    <div class="a" data-live="tally" data-filter="id=eq.t" data-reads="tally">
      <template data-item>
        <div class="row"><p class="n" data-text="{n}"></p><button type="button" id="here" class="add" data-on-click="add">add</button></div>
      </template>
    </div>
    <div class="b" data-live="tally" data-filter="id=eq.t" data-reads="tally">
      <template data-item>
        <button type="button" id="there" class="add-too" data-on-click="add">add</button>
      </template>
    </div>
  </section>`,
  "count.css": "",
  "shell/handlers/add.js": REDUCE,
}

describe("a reduce's runs", () => {
  it("take turns: four quick taps add four", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: { tally: [{ id: "t", n: 0, last: "" }] }, seed: 1 })
    await m.settle()
    for (let i = 0; i < 4; i++) m.fire(".a .add")
    await m.settle()
    expect(Number(m.rows("tally")[0].n)).toBe(4)
    await m.stop()
  })

  it("take turns across regions, in the order the taps fired", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: { tally: [{ id: "t", n: 0, last: "" }] }, seed: 1 })
    await m.settle()
    m.fire(".a .add")
    m.fire(".b .add-too")
    m.fire(".a .add")
    m.fire(".b .add-too")
    await m.settle()
    expect(Number(m.rows("tally")[0].n)).toBe(4)
    expect(m.rows("tally")[0].last).toBe("there")
    await m.stop()
  })
})
