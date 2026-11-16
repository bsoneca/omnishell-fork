// boot.js's own service-worker registration (navigator.serviceWorker.register),
// run against the real file: a registration the browser refuses must reach
// console.warn, never the page as an unhandled rejection — which, before the
// shell has installed its own banner listener, is boot.js's only listener and
// so becomes the boot-failure banner (see boot.js's comment).
import { describe, expect, it, withPage } from "./harness.ts";

const root = new URL("../", import.meta.url);

function serve() {
  const stop = new AbortController();
  const server = Deno.serve({ port: 0, signal: stop.signal, onListen() {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/") {
      return new Response(
        `<!doctype html><html><body><div id="app"></div><script type="module" src="/boot.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path === "/boot.js") return new Response(await Deno.readTextFile(new URL("boot.js", root)), { headers: { "content-type": "text/javascript" } });
    if (path === "/omnishell/interpreter/script-url.js") return new Response(await Deno.readTextFile(new URL("interpreter/script-url.js", root)), { headers: { "content-type": "text/javascript" } });
    // createShell itself is not under test here: a stub keeps this test to
    // boot.js's own registration path, not the shell's boot sequence.
    if (path === "/omnishell/interpreter/shell.js") return new Response(`export function createShell() { return Promise.resolve({}); }`, { headers: { "content-type": "text/javascript" } });
    // 404: the browser refuses a service worker fetched from a script that
    // doesn't exist, which is what makes register()'s promise reject.
    if (path === "/offline-first-sw.js") return new Response("not found", { status: 404 });
    return new Response("not found", { status: 404 });
  });
  return { base: `http://localhost:${server.addr.port}`, close: async () => { stop.abort(); await server.finished; } };
}

describe("boot's service worker registration", () => {
  it("a registration the browser refuses is logged, not left for the page as an unhandled rejection", async () => {
    const server = serve();
    try {
      await withPage(async (page) => {
        await page.addInitScript(() => {
          (window as unknown as { __rejections: string[] }).__rejections = [];
          (window as unknown as { __warnings: string[] }).__warnings = [];
          addEventListener("unhandledrejection", (e) => {
            (window as unknown as { __rejections: string[] }).__rejections.push(String((e as PromiseRejectionEvent).reason));
          });
          const warn = console.warn.bind(console);
          console.warn = (...args: unknown[]) => {
            (window as unknown as { __warnings: string[] }).__warnings.push(args.map(String).join(" "));
            warn(...args);
          };
        });
        await page.goto(`${server.base}/`);
        await page.waitForFunction(() => {
          const w = window as unknown as { __rejections: string[]; __warnings: string[] };
          return w.__rejections.length > 0 || w.__warnings.length > 0;
        });
        const result = await page.evaluate(() => {
          const w = window as unknown as { __rejections: string[]; __warnings: string[] };
          return { rejections: w.__rejections, warnings: w.__warnings };
        });
        expect(result.rejections).toEqual([]);
        expect(result.warnings.some((w) => w.includes("offline worker was not registered"))).toBe(true);
      });
    } finally {
      await server.close();
    }
  });
});
