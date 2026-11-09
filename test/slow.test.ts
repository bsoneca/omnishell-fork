import { describe, expect, it } from "@test/harness"
import { slowDown, slowness } from "../src/lint/playwright/slow.ts"

// SLOW slows the lint's pages as the release gate's are, with the meaning the apps'
// scenario runners give it.
describe("SLOW slows the lint's pages", () => {
  it("is off when unset, empty or 0", () => {
    expect(slowness(undefined)).toEqual([0, 0])
    expect(slowness("")).toEqual([0, 0])
    expect(slowness("0")).toEqual([0, 0])
  })

  it("is the CPU 4 times slower and 300 ms a request for 1, or what it names", () => {
    expect(slowness("1")).toEqual([4, 300])
    expect(slowness("6,150")).toEqual([6, 150])
  })

  it("refuses what it does not read", () => {
    expect(() => slowness("fast")).toThrow()
    expect(() => slowness("0.5,10")).toThrow()
  })

  it("throttles the CPU and the network of the page it is given, and nothing when off", async () => {
    const sent: [string, unknown][] = []
    const cdp = { send: (m: string, p?: unknown) => (sent.push([m, p]), Promise.resolve()) }
    await slowDown(cdp, "0")
    expect(sent).toEqual([])
    await slowDown(cdp, "1")
    expect(sent.map(([m]) => m)).toEqual(["Emulation.setCPUThrottlingRate", "Network.enable", "Network.emulateNetworkConditions"])
    expect(sent[0][1]).toEqual({ rate: 4 })
    expect((sent[2][1] as { latency: number }).latency).toBe(300)
  })
})
