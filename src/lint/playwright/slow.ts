/**
 * A slow reader's page, as the release gate's is: it drives a Cloud Run preview from Cloud
 * Build, where a page boots and answers seconds later than at hand, so what an app draws
 * after an answer (a banner a flag shows, a price a broker names) shifts the layout there
 * and not on the fast line a local stack gives. SLOW slows every page the lint opens, with
 * the same meaning the apps' scenario runners give it (apps/brawl-chess/tests/slow.ts):
 * SLOW=1 is the CPU 4 times slower and each request 300 ms later on a 10 Mbit/s line;
 * SLOW=<cpu>,<latency ms> names its own. Unset or 0, pages run as fast as they can.
 */

type CDP = { send(method: string, params?: unknown): Promise<unknown> }

/** The CPU rate and the added latency SLOW asks for, `[0, 0]` for none. */
export function slowness(asked: string | undefined = Deno.env.get("SLOW")): [number, number] {
  if (asked === undefined || asked === "" || asked === "0") return [0, 0]
  const [cpu, latency] = asked === "1" ? [4, 300] : asked.split(",").map(Number)
  if (!(cpu >= 1 && latency >= 0)) throw new Error(`SLOW is 1 or <cpu>,<latency ms>, not ${asked}`)
  return [cpu, latency]
}

/**
 * Slow the page behind `cdp`. Called before the navigation it measures: the request that
 * carries the late answer is made during the load.
 */
export async function slowDown(cdp: CDP, asked?: string): Promise<void> {
  const [cpu, latency] = slowness(asked)
  if (!cpu) return
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu })
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: 1_250_000,
    uploadThroughput: 1_250_000,
  })
}
