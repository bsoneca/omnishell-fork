import { expect } from "@test/harness"
import { stoodInSessionLifecycle } from "../interpreter/shell.js"

// Where no session can exist yet, the lifecycle is a stand-in over the held session. An app with an auth service passes
// `load`, and its first ceremony builds the real lifecycle (the statechart is not in the first load); an app with no auth
// passes none and stays inert.
const guest = { token: "g.t.s", user: { id: "g1", handle: "h", guest: true } }

// A real lifecycle that has signed out: it holds no session.
function real() {
  let held: unknown = guest
  return {
    session: () => held,
    setSession: (s: unknown) => { held = s },
    posture: () => (held === null ? "anonymous" : "guest"),
    busy: () => false,
    commitGuest: async () => held,
    signOut: async () => { held = null; return { mode: "reload" } },
    signInPasskey: async () => ({ status: "ok" }),
    registerPasskey: async () => ({ status: "ok" }),
  }
}

Deno.test("a stand-in with load builds the real lifecycle once, for concurrent ceremonies, from the held session", async () => {
  const built: unknown[] = []
  const made = real()
  const stood = stoodInSessionLifecycle(guest, false, async (held: unknown) => { built.push(held); await Promise.resolve(); return made })
  expect(built.length).toBe(0)
  expect(stood.session()).toBe(guest)
  expect(stood.posture()).toBe("guest")
  const [out, passkey] = await Promise.all([stood.signOut(), stood.signInPasskey()])
  expect(out).toEqual({ mode: "reload" })
  expect(passkey).toEqual({ status: "ok" })
  expect(built).toEqual([guest])
})

Deno.test("once the real lifecycle exists the stand-in reflects it, a null session included", async () => {
  const stood = stoodInSessionLifecycle(guest, false, async () => real())
  await stood.signOut()
  expect(stood.session()).toBe(null)
  expect(stood.posture()).toBe("anonymous")
  expect(stood.busy()).toBe(false)
})

Deno.test("a stand-in without load stays inert", async () => {
  const stood = stoodInSessionLifecycle(guest, false)
  expect(await stood.signInPasskey()).toEqual({ status: "stopped" })
  expect(await stood.registerPasskey()).toEqual({ status: "stopped" })
  expect(await stood.commitGuest()).toBe(guest)
  expect(stood.session()).toBe(guest)
  stood.setSession(null)
  expect(stood.session()).toBe(null)
  expect(stood.posture()).toBe("anonymous")
})
