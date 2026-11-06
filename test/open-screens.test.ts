// A screen an app behind a sign-in opens to visitors: its route's access is
// "public" (pronto's #Screen.access), and the boot shows it with a guest
// session rather than the login gate. Everywhere else in that app the gate
// stands, and an app with nothing to sign in to has no gate to open.
import { describe, expect, it } from "@test/harness"
import { routeAt } from "../interpreter/shell.js"
import { opensToVisitors } from "../interpreter/fragment.js"

const routes = [
  { path: "/", screen: "home" },
  { path: "/play/:slug", screen: "store", access: "public" },
  { path: "/settings", screen: "settings" },
]
const WALLED = { auth: { required: true, service: "/auth" }, routes }
const OPEN = { auth: { required: false, service: "/auth" }, routes }

describe("a screen open to visitors", () => {
  it("is the public route of an app behind a sign-in", () => {
    expect(opensToVisitors(WALLED, routeAt(WALLED, "/play/mine-finder", "", ["en"]))).toBe(true)
  })
  it("leaves every other route of that app behind the sign-in", () => {
    expect(opensToVisitors(WALLED, routeAt(WALLED, "/", "", ["en"]))).toBe(false)
    expect(opensToVisitors(WALLED, routeAt(WALLED, "/settings", "", ["en"]))).toBe(false)
  })
  it("is no address at all where the address names no screen", () => {
    expect(opensToVisitors(WALLED, routeAt(WALLED, "/nowhere/at/all", "", ["en"]))).toBe(false)
  })
  it("opens nothing in an app that requires no sign-in", () => {
    expect(opensToVisitors(OPEN, routeAt(OPEN, "/play/mine-finder", "", ["en"]))).toBe(false)
  })
})
