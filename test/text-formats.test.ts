import { describe, expect, it } from "@test/harness"
import { TEXT_FORMATS } from "../interpreter/screen.js"

// What data-text-format names without the app declaring anything is stated
// once, in terminal.cue's "text-formats", the catalogue an app and its checks
// read. The interpreter has no build step to load it from, so it keeps its own
// set, and this holds the two to each other: a format the runtime renders that
// the catalogue does not publish, or one published that nothing renders, fails
// here. The suite runs under -A, as design-tokens.test.ts runs cue.

// Deno.Command takes a file URL as its cwd.
const ROOT = new URL("../", import.meta.url)

describe("text-formats", () => {
  it("are the catalogue's, no more and no fewer", async () => {
    const { success, stdout, stderr } = await new Deno.Command("cue", {
      args: ["export", ".:terminal", "-e", '#Terminal.capabilities."text-formats"', "--out", "json"],
      cwd: ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output()
    expect(new TextDecoder().decode(stderr)).toBe("")
    expect(success).toBe(true)
    const published = Object.keys(JSON.parse(new TextDecoder().decode(stdout))).sort()
    expect([...TEXT_FORMATS].sort()).toEqual(published)
  })
})
