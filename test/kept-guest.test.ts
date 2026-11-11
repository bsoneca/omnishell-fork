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

Deno.test("a minted guest is kept while the flag is on, with when it was kept", async () => {
  const store = memory()
  expect(await keepGuest(cfg, guest, store, flag(true), () => 1000)).toBe(true)
  expect(JSON.parse(store.map.get(KEPT_GUEST)!)).toEqual({ ...guest, keptAt: 1000 })
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

// A kept guest's token runs out a week after it was minted (PRONTO-272): one due a refresh (past half
// its life, or expired) is traded at the auth service for a new one of the same account first.
const DAY = 24 * 3600 * 1000
const T0 = Date.UTC(2026, 10, 1)
const tokenFor = (expMs: number) => `h.${btoa(JSON.stringify({ sub: "g1", guest: true, exp: Math.floor(expMs / 1000) })).replace(/=+$/, "")}.s`
const keptAt = (keptMs: number, expMs: number) => ({ token: tokenFor(expMs), user: guest.user, keptAt: keptMs })
const fresh = { token: tokenFor(T0 + 30 * DAY), user: { id: "g1", handle: "h", guest: true } }
// The flag on, and the refresh answering `status` (or failing to answer).
function service(status: number | "offline", flagValue = true) {
  const asked: { url: string; auth?: string }[] = []
  const fn = (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    asked.push({ url: u, auth: (init?.headers as Record<string, string> | undefined)?.authorization })
    if (u.startsWith("/ofrep/")) return Promise.resolve(new Response(JSON.stringify({ value: flagValue })))
    if (status === "offline") return Promise.reject(new TypeError("fetch failed"))
    return Promise.resolve(new Response(status === 200 ? JSON.stringify(fresh) : "{}", { status }))
  }
  return Object.assign(fn, { asked, refreshes: () => asked.filter((a) => a.url === "/auth/guest/refresh") })
}

Deno.test("a kept guest past half its token's life is refreshed and the new token kept", async () => {
  const kept = keptAt(T0, T0 + 7 * DAY)
  const store = memory({ [KEPT_GUEST]: JSON.stringify(kept) })
  const f = service(200)
  const now = T0 + 4 * DAY
  expect(await keptGuest(cfg, store, f, lives(true), () => now)).toEqual(fresh)
  expect(f.refreshes()).toEqual([{ url: "/auth/guest/refresh", auth: `Bearer ${kept.token}` }])
  expect(JSON.parse(store.map.get(KEPT_GUEST)!)).toEqual({ ...fresh, keptAt: now })
})

Deno.test("a kept guest whose token expired is refreshed, and comes back as itself", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(keptAt(T0, T0 + 7 * DAY)) })
  const f = service(200)
  // Asked whether its account lives with the dead token, it would be dropped: the refresh comes first.
  expect(await keptGuest(cfg, store, f, lives(false), () => T0 + 20 * DAY)).toEqual(fresh)
  expect(f.refreshes().length).toBe(1)
})

Deno.test("a kept guest early in its token's life is used as it is, unrefreshed", async () => {
  const kept = keptAt(T0, T0 + 7 * DAY)
  const store = memory({ [KEPT_GUEST]: JSON.stringify(kept) })
  const f = service(200)
  expect(await keptGuest(cfg, store, f, lives(true), () => T0 + 1 * DAY)).toEqual({ token: kept.token, user: kept.user })
  expect(f.refreshes().length).toBe(0)
})

Deno.test("a refresh the auth service refuses (401, 404, 409) drops the kept guest", async () => {
  for (const status of [401, 404, 409]) {
    const store = memory({ [KEPT_GUEST]: JSON.stringify(keptAt(T0, T0 + 7 * DAY)) })
    expect(await keptGuest(cfg, store, service(status), lives(true), () => T0 + 20 * DAY)).toBe(null)
    expect(store.map.has(KEPT_GUEST)).toBe(false)
  }
})

Deno.test("a refresh with no answer keeps the kept guest as it is (fail open)", async () => {
  for (const status of ["offline", 503] as const) {
    const kept = keptAt(T0, T0 + 7 * DAY)
    const store = memory({ [KEPT_GUEST]: JSON.stringify(kept) })
    expect(await keptGuest(cfg, store, service(status), lives(true), () => T0 + 5 * DAY)).toEqual({ token: kept.token, user: kept.user })
    expect(JSON.parse(store.map.get(KEPT_GUEST)!)).toEqual(kept)
  }
})

Deno.test("with the flag off no refresh is asked for", async () => {
  const store = memory({ [KEPT_GUEST]: JSON.stringify(keptAt(T0, T0 + 7 * DAY)) })
  const f = service(200, false)
  expect(await keptGuest(cfg, store, f, lives(true), () => T0 + 5 * DAY)).toBe(null)
  expect(f.refreshes().length).toBe(0)
})
