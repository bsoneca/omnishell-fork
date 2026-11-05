// What a list keeps per row is small: a row's ctx is one class's instance, a
// row that nests nothing shares one empty map of nested regions, and its
// attributes are read by name. None of that may show. A row that does nest
// keeps its own nested regions, apart from every other row's, and an
// attribute a binding emptied is bound again when its value comes back.
import { describe, expect, it } from "@test/harness"
import { mountScreen } from "./screen-harness.ts"

const ROUTE = { screen: "board", files: { html: "board.html", css: "board.css", handlers: [] } }

const FILES = {
  "board.html": `<section class="screen" data-screen="board">
    <ul data-live="card" data-order="pos.asc">
      <template data-item><li class="card">
        <a class="open" href="{url}" data-text="{title}"></a>
        <ol data-live="task" data-filter="card_id=eq.{id}" data-order="name.asc" data-empty="">
          <template data-item><li class="task" data-text="{name}"></li></template>
        </ol>
      </li></template>
    </ul>
  </section>`,
  "board.css": "",
}

const tables = () => ({
  card: [{ id: "c1", pos: 1, title: "one", url: "/one" }],
  task: [{ id: "t1", card_id: "c1", name: "a" }],
})

const tasksOf = (m: Awaited<ReturnType<typeof mountScreen>>, card: string) =>
  m.all(`.card:has(a[href="/${card}"]) .task`).map((el) => (el.textContent ?? "").trim())

describe("a list row's own state", () => {
  it("keeps each row's nested region apart from every other row's", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: tables(), seed: 1 })
    try {
      await m.settle()
      await m.store.create("card", { id: "c2", pos: 2, title: "two", url: "/two" })
      await m.store.create("card", { id: "c3", pos: 3, title: "three", url: "/three" })
      await m.settle()
      await m.store.create("task", { id: "t2", card_id: "c2", name: "b" })
      await m.store.create("task", { id: "t3", card_id: "c2", name: "c" })
      await m.settle()
      expect(tasksOf(m, "one")).toEqual(["a"])
      expect(tasksOf(m, "two")).toEqual(["b", "c"])
      expect(tasksOf(m, "three")).toEqual([])
      // A row going takes its nested region with it, and only its own.
      await m.store.remove("card", "c2")
      await m.settle()
      await m.store.create("task", { id: "t4", card_id: "c3", name: "d" })
      await m.settle()
      expect(tasksOf(m, "one")).toEqual(["a"])
      expect(tasksOf(m, "three")).toEqual(["d"])
    } finally { await m.stop() }
  })

  it("gives a row that comes to nest its own region, leaving the rows that nest nothing empty", async () => {
    const files = {
      "board.html": `<section class="screen" data-screen="board">
        <ul data-live="card" data-order="pos.asc">
          <template data-item data-when="kind=eq.box"><li class="card box" data-id-of="{id}">
            <ol data-live="task" data-filter="card_id=eq.{id}" data-order="name.asc" data-empty="">
              <template data-item><li class="task" data-text="{name}"></li></template>
            </ol>
          </li></template>
          <template data-item><li class="card plain" data-id-of="{id}"></li></template>
        </ul>
      </section>`,
      "board.css": "",
    }
    const m = await mountScreen({
      route: ROUTE,
      files,
      tables: {
        card: [
          { id: "p1", pos: 1, kind: "plain" },
          { id: "p2", pos: 2, kind: "plain" },
          { id: "b1", pos: 3, kind: "box" },
        ],
        task: [{ id: "t1", card_id: "b1", name: "a" }, { id: "t2", card_id: "p1", name: "b" }],
      },
      seed: 1,
    })
    const tasks = (id: string) => m.all(`[data-id-of="${id}"] .task`).map((el) => (el.textContent ?? "").trim())
    try {
      await m.settle()
      expect(tasks("b1")).toEqual(["a"])
      expect(m.all(".plain").length).toBe(2)
      // p1 turns into a box: its template now nests, and the region it gets
      // is its own, not one the rows that nest nothing would all hold.
      await m.store.update("card", "p1", { kind: "box" })
      await m.settle()
      await m.store.create("task", { id: "t3", card_id: "p2", name: "c" })
      await m.settle()
      expect(tasks("p1")).toEqual(["b"])
      expect(tasks("b1")).toEqual(["a"])
      expect(m.all(".plain").length).toBe(1)
      expect(tasks("p2")).toEqual([])
    } finally { await m.stop() }
  })

  it("binds an attribute again once the value it was emptied by comes back", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: tables(), seed: 1 })
    try {
      await m.settle()
      expect(m.one(".open").getAttribute("href")).toBe("/one")
      await m.store.update("card", "c1", { url: "" })
      await m.settle()
      expect(m.one(".open").getAttribute("href")).toBe(null)
      await m.store.update("card", "c1", { url: "/again" })
      await m.settle()
      expect(m.one(".open").getAttribute("href")).toBe("/again")
    } finally { await m.stop() }
  })
})
