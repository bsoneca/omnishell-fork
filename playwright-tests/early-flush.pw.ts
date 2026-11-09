// The wake a fold asks for in the event's own task (screen.js, "the fold's
// writes have all landed") must not run before the event has reached every
// listener it has.
//
// A press on a card is two listeners of one pointerdown: the card's
// data-on-pointerdown, and, one level up, the table's machine. A real engine
// runs a microtask checkpoint between the two, so the card's fold can finish —
// and its flush wake the table's reduce — before the machine has written a
// thing. The reduce then reads half a press (a card held, a machine still
// idle), takes it for a press let go, and lets the card go: Solitaire's drag
// did nothing. linkedom dispatches synchronously with no checkpoint between
// listeners, so only a real engine, and a real mouse, can say.
//
// The store here keeps the one property that matters: a write queues a wake,
// the wake is delivered a task later, and flushNotifications delivers what is
// queued now.
import { describe, expect, it, type Page, withPage } from "./harness.ts"

const ORIGIN = "http://flush.test"
const INTERPRETER = new URL("../interpreter/", import.meta.url)

const MACHINE = JSON.stringify({
  field: "drag",
  initial: "idle",
  states: {
    idle: { on: { pointerdown: { target: "held" } } },
    held: { on: { pointerup: { target: "idle" } } },
  },
})

const SCREEN_HTML = `<section class="screen" data-screen="table">
  <div id="table" data-live="game" data-filter="id=eq.g" data-reads="card,game" data-empty="" data-on-mutation="guard" data-machine='${MACHINE}'>
    <div class="board" data-drag="{drag}">
      <div class="cards" data-live="card" data-order="id.asc" data-reads="card,game">
        <template data-item>
          <button type="button" class="card" data-card="{id}" data-held="{held}" data-on-pointerdown="press" data-on-click="tap">card</button>
        </template>
      </div>
    </div>
  </div>
</section>`

// A press holds the card it lands on.
const PRESS = `(state, event) => {
  if (event.type !== "pointerdown") return { updates: [] };
  return { updates: [{ op: "patch", entity: "card", id: event.id, row: { held: "yes" } }] };
}`

// The table's reduce, woken by every write to what it reads. At rest nothing
// stays held — which is right, and is what a wake between the card's write and
// the machine's mistakes the middle of a press for.
const GUARD = `(state, event) => {
  if (event.type !== "mutation") return { updates: [] };
  const game = state.items?.[0];
  if (game?.drag !== "idle") return { updates: [] };
  return { updates: state.rows.card.filter((c) => c.held === "yes").map((c) => ({ op: "patch", entity: "card", id: c.id, row: { held: "no" } })) };
}`

const TAP = `(state, event) => {
  if (event.type !== "click") return { updates: [] };
  return { updates: [{ op: "patch", entity: "card", id: event.id, row: { taps: 1 } }] };
}`

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>flush harness</title></head>
<body><div id="shell"></div>
<script type="module">
  import { interpretScreen } from "./screen.js"
  const rows = { game: [{ id: "g", drag: "idle" }], card: [{ id: "c1", held: "no", taps: 0 }] }
  const subs = []
  const queued = new Set()
  let flushes = 0
  const wake = async () => { for (const fn of subs) await fn() }
  // A write queues one wake, due a task later; a flush delivers what is queued.
  const queue = () => {
    const due = () => { if (queued.delete(due)) wake() }
    queued.add(due)
    setTimeout(due, 0)
  }
  const store = {
    query: async (table) => rows[table].map((r) => ({ ...r })),
    subscribe: (_t, fn) => { subs.push(fn); return () => {} },
    patch: async (table, list) => {
      for (const { key, changes } of list) Object.assign(rows[table].find((r) => String(r.id) === String(key)), changes)
      queue()
    },
    // A machine's transition is a put of the whole row.
    write: async (table, list) => {
      for (const { key, row } of list) {
        const at = rows[table].findIndex((r) => String(r.id) === String(key))
        rows[table][at] = { ...row }
      }
      queue()
    },
    drop: async () => {},
    flushNotifications: () => {
      flushes += 1
      const due = [...queued]
      for (const fn of due) fn()
      return due.length
    },
  }
  window.__state = () => ({ held: rows.card[0].held, drag: rows.game[0].drag, taps: rows.card[0].taps, flushes })
  await interpretScreen(document.getElementById("shell"), location.origin + "/", {
    screen: "table",
    files: { html: "screen.html", css: "screen.css", handlers: ["handlers/press.js", "handlers/guard.js", "handlers/tap.js"] },
    states: ["loading", "empty", "populated"],
  }, store, {})
  window.__ready = true
</script>
</body></html>`

// deno-lint-ignore no-explicit-any
type Any = any

const SERVED: Record<string, string> = {
  "/": PAGE,
  "/screen.html": SCREEN_HTML,
  "/handlers/press.js": PRESS,
  "/handlers/guard.js": GUARD,
  "/handlers/tap.js": TAP,
}

async function open(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    const served = SERVED[url.pathname]
    if (served !== undefined) {
      const type = url.pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8"
      return route.fulfill({ contentType: type, body: served })
    }
    if (url.pathname === "/screen.css") return route.fulfill({ contentType: "text/css", body: "" })
    if (/\.js$/.test(url.pathname)) {
      const body = await Deno.readTextFile(new URL(url.pathname.slice(1), INTERPRETER))
      return route.fulfill({ contentType: "text/javascript; charset=utf-8", body })
    }
    return route.abort()
  })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => (window as Any).__ready === true)
  await page.locator(".card").waitFor()
}

const state = (page: Page) => page.evaluate(() => (window as Any).__state())

describe("a wake asked for in the event's own task", () => {
  it("does not let a reduce read half a press: the held card stays held through the drag", () =>
    withPage(async (page) => {
      await open(page)
      const box = (await page.locator(".card").boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(300)
      expect(await state(page)).toMatchObject({ held: "yes", drag: "held" })
      await page.mouse.up()
      await page.waitForTimeout(300)
      // The press let go: the machine is idle again and the reduce lets the card go.
      expect(await state(page)).toMatchObject({ held: "no", drag: "idle" })
    }))

  it("is still asked for after a click nothing else listens to", () =>
    withPage(async (page) => {
      await open(page)
      await page.locator(".card").dispatchEvent("click")
      await page.waitForFunction(() => (window as Any).__state().taps === 1)
      expect((await state(page)).flushes).toBeGreaterThan(0)
    }))
})
