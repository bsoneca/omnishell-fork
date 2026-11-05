// A form's write is drawn in the submit's own task. Left to the store's turn,
// the wake that places the new row runs after the event, which in a browser is
// inside the next frame, and the paint waits on it (C2, form submit to new row
// visible). These tests watch from a task queued before the submit: it runs
// after the submit's own task and before any wake the store scheduled.
import { describe, expect, it } from "@test/harness"
import { mountScreen } from "./screen-harness.ts"

const ROUTE = {
  screen: "notes",
  files: { html: "notes.html", css: "notes.css", handlers: [] },
}

const FILES = {
  "notes.html": `<section class="screen" data-screen="notes">
    <ul id="list" data-live="note" data-order="label.asc">
      <template data-item><li class="label" data-text="{label}"></li></template>
    </ul>
    <form data-form="add" data-entity="note" data-action="create">
      <input name="label" id="label">
      <button type="submit">add</button>
    </form>
  </section>`,
  "notes.css": "",
}

/** What the list shows from a task queued before the submit. */
const seenAfterSubmit = async (m: Awaited<ReturnType<typeof mountScreen>>, label: string) => {
  m.set("#label", "value", label)
  const seen = new Promise<string[]>((resolve) => setTimeout(() => resolve(m.texts(".label")), 0))
  m.fire("form[data-form=add]", "submit")
  return await seen
}

describe("a form's write", () => {
  it("is drawn in the submit's own task", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: { note: [{ id: "n1", label: "a" }] }, seed: 1 })
    try {
      await m.settle()
      // The bound on a prompt write is a few milliseconds, which a cold path,
      // or a loaded machine, can spend on its own, and such a submit is left
      // to the store's turn by design. So: some submit of a handful is drawn
      // in its task. Without the in-task wake none ever is.
      const labels = ["a"]
      let drawn = false
      for (const label of ["b", "c", "d", "e", "f"]) {
        labels.push(label)
        drawn = JSON.stringify(await seenAfterSubmit(m, label)) === JSON.stringify(labels)
        await m.settle()
        if (drawn) break
      }
      expect(drawn).toBe(true)
    } finally { await m.stop() }
  })

  it("leaves the wake to the store's turn while another write is in flight", async () => {
    const m = await mountScreen({ route: ROUTE, files: FILES, tables: { note: [{ id: "n1", label: "a" }] }, seed: 1 })
    try {
      await m.settle()
      await seenAfterSubmit(m, "b")
      await m.settle()
      // A write that never answers holds the store's in-flight count, so the
      // submit's wake is not delivered from inside its task.
      const add = m.store.add.bind(m.store)
      let release = () => {}
      m.store.add = (table, rows) => {
        m.store.add = add
        return new Promise<void>((r) => (release = r)).then(() => add(table, rows))
      }
      m.set("#label", "value", "stuck")
      m.fire("form[data-form=add]", "submit")
      expect(await seenAfterSubmit(m, "c")).toEqual(["a", "b"])
      release()
      await m.settle()
      expect(m.texts(".label")).toEqual(["a", "b", "c", "stuck"])
    } finally { await m.stop() }
  })
})
