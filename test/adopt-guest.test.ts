import { expect } from "@test/harness"
import { adoptGuest } from "../interpreter/shell.js"

// A provider's sign-in leaves the page, so the account it makes is a new one. Where the app's auth names a flag in
// adoptGuest and it is on, the guest this tab holds is handed to the auth service first, which keeps it for the
// sign-in's callback (PRONTO-209).
const cfg = { auth: { required: false, service: "/auth", adoptGuest: "google_adopts_guest" } }
const guest = { token: "g.t.s", user: { id: "g1", handle: "h", guest: true } }

// A fetch that answers the flag service as `on` says and the adopt route with `status`, noting what it was asked.
function service(on: unknown, status = 204) {
  const asked: { url: string; init?: RequestInit }[] = []
  const fn = (url: RequestInfo | URL, init?: RequestInit) => {
    asked.push({ url: String(url), init })
    if (String(url).startsWith("/ofrep/")) return Promise.resolve(new Response(JSON.stringify({ key: "google_adopts_guest", value: on })))
    return Promise.resolve(new Response(null, { status }))
  }
  return Object.assign(fn, { asked })
}

Deno.test("a guest is handed over with its bearer, from this origin, while the flag is on", async () => {
  const f = service(true)
  expect(await adoptGuest(cfg, guest, f)).toBe(true)
  expect(f.asked.map((a) => a.url)).toEqual(["/ofrep/v1/evaluate/flags/google_adopts_guest", "/auth/oidc/adopt"])
  const init = f.asked[1].init!
  expect(init.method).toBe("POST")
  expect(init.credentials).toBe("same-origin")
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer g.t.s")
})

Deno.test("nothing is handed over with the flag off, with no flag named, or for an account", async () => {
  for (const [c, s, f] of [
    [cfg, guest, service(false)],
    [{ auth: { required: false, service: "/auth" } }, guest, service(true)],
    [cfg, { token: "a.t.s", user: { id: "a1", guest: false } }, service(true)],
    [cfg, null, service(true)],
  ] as const) {
    expect(await adoptGuest(c, s, f)).toBe(false)
    expect(f.asked.some((a) => a.url === "/auth/oidc/adopt")).toBe(false)
  }
})

Deno.test("a refusal or a failure from the auth service is the sign-in as it always was", async () => {
  expect(await adoptGuest(cfg, guest, service(true, 401))).toBe(false)
  const down = (url: RequestInfo | URL) =>
    String(url).startsWith("/ofrep/")
      ? Promise.resolve(new Response(JSON.stringify({ value: true })))
      : Promise.reject(new TypeError("fetch failed"))
  expect(await adoptGuest(cfg, guest, down as typeof fetch)).toBe(false)
})
