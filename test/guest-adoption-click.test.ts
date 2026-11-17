// deno-lint-ignore-file no-explicit-any
import { expect } from "@test/harness"
import { parseHTML } from "linkedom"
import { FIXTURE_CARRIERS } from "../interpreter/fixture-types.js"

// A provider's sign-in leaves the page, so the guest this tab holds is handed to the auth service first. The handoff
// is driven here through the shell's own click handlers: the strip's `.shell-provider` link and the document-level
// `[data-auth-provider]` control, each of which must finish the adopt POST before the page is left, and must hand
// over the guest as it stands at the click, a guest minted after the strip rendered included.
const config = JSON.stringify({
  carriers: FIXTURE_CARRIERS,
  app: "adopt",
  auth: { service: "/auth", providers: ["google"], adoptGuest: "adopt_flag" },
  tables: ["thing"],
  schema: { thing: { durability: "live", fields: [{ name: "id", type: "string" }] } },
  routes: [{ path: "/", screen: "home", nav: { label: "Home" }, files: { html: "shell/screens/home.html", css: "shell/screens/home.css", handlers: [] } }],
})
const home = `<section class="screen" data-screen="home"><button id="provider" data-auth-provider="google">Google</button><button id="out" data-auth-action="signout">Out</button></section>`
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

async function boot(mintDelay: Promise<void> | null, yaml = config) {
  const { document, Event } = parseHTML("<!doctype html><html><head></head><body><div id=shell></div></body></html>")
  const g = globalThis as any
  g.document = document
  g.window = globalThis
  g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0)
  g.addEventListener = () => {}
  g.scrollTo = () => {}
  Object.defineProperty(globalThis, "scrollY", { get: () => 0, configurable: true })
  g.navigation = { addEventListener: () => {} }
  const events: string[] = []
  const origin = "http://localhost:8091"
  Object.defineProperty(globalThis, "location", {
    value: {
      origin, pathname: "/", search: "", hash: "", reload: () => events.push("reload"),
      get href() { return `${origin}/` },
      set href(v: string) { events.push(`href ${v}`) },
      assign: (v: string) => events.push(`assign ${v}`),
    },
    configurable: true,
  })
  sessionStorage.clear()
  localStorage.clear()
  const adopted: string[] = []
  g.fetch = async (url: any, init: any = {}) => {
    const u = String(url)
    if (u.endsWith("shell.yaml")) return new Response(yaml)
    if (u.includes("/ofrep/")) return new Response(JSON.stringify({ value: true }))
    if (u.endsWith("/auth/guest")) {
      await mintDelay
      return new Response(JSON.stringify({ token: "g.t.s", user: { id: "g1", handle: "sunlit-fox", guest: true } }))
    }
    if (u.endsWith("/auth/oidc/adopt")) {
      await new Promise((r) => setTimeout(r, 40))
      adopted.push(init.headers.authorization)
      events.push("adopted")
      return new Response(null, { status: 204 })
    }
    if (u.includes("/messages/")) return new Response("{}", { status: 404 })
    if (u.endsWith(".html")) return new Response(home)
    if (u.endsWith(".css")) return new Response("")
    return Promise.reject(new Error(`unexpected fetch ${u}`))
  }
  const mount = document.getElementById("shell")
  const { createShell } = await import("../interpreter/shell.js")
  const booting = createShell({ config: "./shell.yaml", mount })
  booting.catch(() => {})
  return { document, Event, events, adopted, booting }
}
const click = (app: any, el: any) => {
  const event = new app.Event("click", { bubbles: true })
  Object.defineProperty(event, "button", { value: 0 })
  el.dispatchEvent(event)
}

Deno.test({
  name: "the strip's provider link hands the guest over, then leaves",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const app = await boot(null)
    await app.booting
    await settle()
    const link = app.document.querySelector(".shell-provider")
    expect(link).not.toBe(null)
    click(app, link)
    await settle(200)
    expect(app.adopted).toEqual(["Bearer g.t.s"])
    expect(app.events.filter((e) => e !== "reload")).toEqual(["adopted", `assign ${link.href}`])
  },
})

Deno.test({
  name: "a guest minted after the strip rendered is the one handed over by the strip's link",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let mint!: () => void
    const app = await boot(new Promise<void>((r) => (mint = r)))
    await settle()
    // The strip is up while the guest is still being minted: nothing to snapshot.
    const link = app.document.querySelector(".shell-provider")
    expect(link).not.toBe(null)
    mint()
    await settle()
    click(app, link)
    await settle(200)
    expect(app.adopted).toEqual(["Bearer g.t.s"])
    expect(app.events.filter((e) => e !== "reload")).toEqual(["adopted", `assign ${link.href}`])
  },
})

Deno.test({
  name: "the document's [data-auth-provider] control awaits the adoption before location.href",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const app = await boot(null)
    await app.booting
    await settle()
    click(app, app.document.getElementById("provider"))
    await settle(200)
    expect(app.adopted).toEqual(["Bearer g.t.s"])
    const events = app.events.filter((e) => e !== "reload")
    expect(events[0]).toBe("adopted")
    expect(events[1]).toBe("href /auth/oidc/google/start?return=%2F")
    expect(events.length).toBe(2)
  },
})

Deno.test({
  name: "a tables-only app mints a guest with no session lifecycle, and its sign-out is the reload",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const plain = JSON.stringify({ ...JSON.parse(config), auth: undefined })
    const app = await boot(null, plain)
    const shell = await app.booting
    await settle()
    expect(shell.sessionLifecycle).toBe(null)
    const out = app.document.getElementById("out")
    expect(out).not.toBe(null)
    expect(sessionStorage.getItem("pronto-token")).not.toBe(null)
    click(app, out)
    await settle(200)
    expect(app.events).toEqual(["reload"])
    expect(sessionStorage.getItem("pronto-token")).toBe(null)
  },
})
