import { expect } from "@test/harness"
import { createLanded } from "../interpreter/data-sync.js"

// The gateway sends every POST with resolution=ignore-duplicates, so a create
// whose key is taken answers 201 with no row, as a replay of the reader's own
// create does. Whose row the key names afterwards tells the two apart
// (PRONTO-103).
const me = "u-me", other = "u-other"

Deno.test("a create whose key names a row this reader cannot see is refused", () => {
  expect(createLanded(undefined, null, "owner", me)).toBe("taken")
  expect(createLanded(undefined, null, undefined, me)).toBe("taken")
})

Deno.test("a create whose key names someone else's row is refused, synced or read back", () => {
  expect(createLanded({ id: "g", owner: other }, undefined, "owner", me)).toBe("taken")
  expect(createLanded(undefined, { id: "g", owner: other }, "owner", me)).toBe("taken")
})

Deno.test("a create whose key names this reader's own row landed, as a replay does", () => {
  expect(createLanded({ id: "g", owner: me }, undefined, "owner", me)).toBe("own")
  expect(createLanded(undefined, { id: "g", owner: me }, "owner", me)).toBe("own")
})

Deno.test("a row without an owner column, or not yet stamped with one, is the reader's when it can see it", () => {
  expect(createLanded({ id: "g" }, undefined, undefined, me)).toBe("own")
  expect(createLanded({ id: "g", owner: null }, undefined, "owner", me)).toBe("own")
})

Deno.test("a create nobody asked about is undecided", () => {
  expect(createLanded(undefined, undefined, "owner", me)).toBe("unknown")
})
