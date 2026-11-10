import { expect } from "@test/harness"
import { flagOn, keepGuest, keptGuest, KEPT_GUEST } from "../interpreter/shell.js"

// A guest's session lives in the tab, so every visit minted a new, empty
// guest. Where the app's auth names a flag in keepGuest and it is on, the
// guest is kept in the browser and the next visit is the same guest
// (PRONTO-208).
const cfg = { auth: { required: false, service: "/auth", keepGuest: "keep_guest" } }
const guest = { token: "g.t.s", user: { id: "g1", handle: "h", guest: true } }

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  return Object.assign(storage as unknown as Storage, { map })
}
const flag = (value: unknown, status = 200) => {
  const asked: string[] = []
  const fn = (url: RequestInfo | URL) => {
    asked.push(String(url))
    return Promise.resolve(new Response(JSON.stringify({ key: "keep_guest", value }), { status }))
  }
  return Object.assign(fn, { asked })
}
const lives = (alive: boolean) => () => Promise.resolve(alive)

Deno.test("the flag is asked by name over OFREP, and only true is on", async () => {
  const on = flag(true)
  expect(await flagOn("keep_guest", on)).toBe(true)
  expect(on.asked).toEqual(["/ofrep/v1/evaluate/flags/keep_guest"])
  expect(await flagOn("keep_guest", flag(false))).toBe(false)
  expect(await flagOn("keep_guest", flag("true"))).toBe(false)
})

Deno.test("no answer from the flag service is off", async () => {
  expect(await flagOn("keep_guest", flag(true, 404))).toBe(false)
  expect(await flagOn("keep_guest", () => Promise.reject(new TypeError("fetch failed")))).toBe(false)
})

Deno.test("a minted guest is kept while the flag is on", async () => {
  const store = memory()
  expect(await keepGuest(cfg, guest, store, flag(true))).toBe(true)
  expect(JSON.parse(store.map.get(KEPT_GUEST)!)).toEqual(guest)
})

Deno.test("nothing is kept with the flag off, with no flag named, or for an account", async () => {
  for (const [c, s, f] of [
    [cfg, guest, flag(false)],
    [{ auth: { required: false, service: "/auth" } }, guest, flag(true)],
    [cfg, { token: "a.t.s", user: { id: "a1", guest: false } }, flag(true)],
  ] as const) {
    const store = memory()
    expect(await keepGuest(c, s, store, f)).toBe(false)
    expect(store.map.size).toBe(0)
  }
})

Deno.test("the next visit is the kept guest while the flag is on and its account lives", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(guest) })
  expect(await keptGuest(cfg, store, flag(true), lives(true))).toEqual(guest)
})

Deno.test("with the flag off the kept guest is not used, but stays for when it is on", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(guest) })
  expect(await keptGuest(cfg, store, flag(false), lives(true))).toBe(null)
  expect(store.map.has(KEPT_GUEST)).toBe(true)
})

Deno.test("a kept guest whose account is gone, or whose token expired, is dropped", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(guest) })
  expect(await keptGuest(cfg, store, flag(true), lives(false))).toBe(null)
  expect(store.map.has(KEPT_GUEST)).toBe(false)
})

Deno.test("a kept value that is no guest session is dropped unasked", async () => {
  for (const bad of ["{", JSON.stringify({ token: "a.t.s", user: { guest: false } }), JSON.stringify({ user: { guest: true } })]) {
    const store = memory({ [KEPT_GUEST]: bad })
    const f = flag(true)
    expect(await keptGuest(cfg, store, f, lives(true))).toBe(null)
    expect(store.map.has(KEPT_GUEST)).toBe(false)
    expect(f.asked.length).toBe(0)
  }
})

Deno.test("an app that names no flag, or a browser without storage, keeps nothing", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(guest) })
  expect(await keptGuest({ auth: { required: false, service: "/auth" } }, store, flag(true), lives(true))).toBe(null)
  expect(await keptGuest(cfg, null, flag(true), lives(true))).toBe(null)
  expect(await keepGuest(cfg, guest, null, flag(true))).toBe(false)
})
