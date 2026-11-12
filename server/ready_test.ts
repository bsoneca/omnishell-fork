import assert from "node:assert/strict";
import { doorReadiness } from "./ready.ts";

Deno.test("a door slower than the bound is not ready, within the bound", async () => {
  const slow = ((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
  const ready = doorReadiness({ fetch: slow, url: "http://door/shell/shell.json", timeoutMs: 200 });
  const t = performance.now();
  assert.equal(await ready(), false);
  assert.ok(performance.now() - t < 1000, "answered within the bound");
});

Deno.test("a door that ignores the abort is still not ready on time", async () => {
  const stuck = (() => new Promise<Response>(() => {})) as typeof fetch;
  const ready = doorReadiness({ fetch: stuck, url: "http://door/x", timeoutMs: 100 });
  assert.equal(await ready(), false);
});

Deno.test("a door that answers 200 is ready, and one that answers 500 is not", async () => {
  let status = 200;
  const door = (() => Promise.resolve(new Response("{}", { status }))) as typeof fetch;
  assert.equal(await doorReadiness({ fetch: door, url: "http://door/x" })(), true);
  status = 500;
  assert.equal(await doorReadiness({ fetch: door, url: "http://door/x" })(), false);
});

Deno.test("the last answer is kept for the ttl, then the door is asked again", async () => {
  let calls = 0, t = 0;
  const door = (() => { calls++; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  const ready = doorReadiness({ fetch: door, url: "http://door/x", ttlMs: 3000, now: () => t });
  await Promise.all([ready(), ready(), ready()]);
  assert.equal(calls, 1, "concurrent probes share one read");
  t = 2999; await ready();
  assert.equal(calls, 1);
  t = 3000; await ready();
  assert.equal(calls, 2);
});
