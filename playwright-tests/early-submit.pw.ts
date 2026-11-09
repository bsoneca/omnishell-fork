// A form is on the page before the shell wires it: interpretScreen connects
// the screen, then loads its handlers' modules, then wires its forms. On a slow
// host (Studio's rc preview, 2026-11-09) a reader's Join landed in that gap and
// the browser submitted the form itself: a navigation to the page's own address
// with the fields in its query, a reload that lost the write. The submit is
// held instead, and made once the form is the shell's.
import { describe, expect, it, type Page, withPage } from "./harness.ts"

const ORIGIN = "http://early-submit.test"
const INTERPRETER = new URL("../interpreter/", import.meta.url)

const SCREEN_HTML = `<section class="screen" data-screen="join">
  <form data-entity="member" data-action="create">
    <input id="name" name="name" required aria-label="Name">
    <button type="submit">Join</button>
  </form>
  <button type="button" data-on-click="nudge">nudge</button>
</section>`

const NUDGE = `(state, event) => ({ updates: [] })`

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>early submit harness</title></head>
<body><div id="shell"></div>
<script type="module">
  import { interpretScreen } from "./screen.js"
  // A create mints its key, and this harness's origin is not a secure context.
  if (!crypto.randomUUID) crypto.randomUUID = () => "m-" + Math.random().toString(16).slice(2)
  const rows = { member: [] }
  const subs = []
  const wake = async () => { for (const fn of subs) await fn() }
  const store = {
    query: async (table) => (rows[table] ?? []).map((r) => ({ ...r })),
    subscribe: (_t, fn) => { subs.push(fn); return () => {} },
    add: async (table, list) => { rows[table].push(...list); await wake() },
    create: async () => {},
    upsert: async () => {},
    put: async () => {},
    patch: async () => {},
    remove: async () => {},
    removeWhere: async () => {},
    drop: async () => {},
  }
  window.__members = () => rows.member.map((r) => r.name)
  window.__booted = (window.__booted ?? 0) + 1
  await interpretScreen(document.getElementById("shell"), location.origin + "/", {
    screen: "join",
    files: { html: "screen.html", css: "screen.css", handlers: ["handlers/nudge.js"] },
    states: ["loading", "empty", "populated"],
  }, store, {})
  window.__ready = true
</script>
</body></html>`

// deno-lint-ignore no-explicit-any
type Any = any

// The handler's module answers only once released: the gap a slow host opens.
async function open(page: Page): Promise<() => void> {
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE })
    if (url.pathname === "/screen.html") return route.fulfill({ contentType: "text/html; charset=utf-8", body: SCREEN_HTML })
    if (url.pathname === "/screen.css") return route.fulfill({ contentType: "text/css", body: "" })
    if (url.pathname === "/handlers/nudge.js") {
      await released
      return route.fulfill({ contentType: "text/javascript", body: NUDGE })
    }
    if (/\.js$/.test(url.pathname)) {
      const body = await Deno.readTextFile(new URL(url.pathname.slice(1), INTERPRETER))
      return route.fulfill({ contentType: "text/javascript; charset=utf-8", body })
    }
    return route.abort()
  })
  await page.goto(`${ORIGIN}/`)
  await page.locator("#name").waitFor()
  return release
}

describe("a form submitted before the shell wires it", () => {
  it("is not the browser's: the page stays, and the write is made once the form is wired", () =>
    withPage(async (page) => {
      const documents: string[] = []
      page.on("request", (r) => { if (r.resourceType() === "document") documents.push(new URL(r.url()).search) })
      const release = await open(page)
      expect(await page.evaluate(() => (window as Any).__ready === true)).toBe(false)
      await page.locator("#name").fill("Ana")
      await page.locator("button[type=submit]").click()
      release()
      await page.waitForFunction(() => (window as Any).__ready === true)
      await page.waitForFunction(() => (window as Any).__members().length === 1)
      expect(await page.evaluate(() => (window as Any).__members())).toEqual(["Ana"])
      expect(await page.evaluate(() => (window as Any).__booted)).toBe(1)
      expect(documents).toEqual([""])
    }))
})
