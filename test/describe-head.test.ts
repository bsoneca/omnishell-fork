import { describe as suite, expect, it } from "@test/harness"
import { parseHTML } from "linkedom"
import { describe } from "../interpreter/chrome.js"

// What a screen says about itself in the head of its document: its h1 by default,
// its own wording where it marks it (data-head), the app's line where it says nothing.
const cfg = { app: "battlechess", routes: [], i18n: undefined }
const route = { screen: "player", path: "/player/:id" }
const draw = (screen: string) => {
  const { document } = parseHTML(`<!doctype html><html><head><meta name="description" content="the app"><title>Loading…</title></head><body><div id="app">${screen}</div></body></html>`)
  describe(document, { ...cfg, routes: [{ screen: "player", path: "/player/:id" }] }, { route, params: { id: "1" }, el: document.getElementById("app")!, origin: "https://x.test" })
  return document
}
const meta = (d: Document, sel: string) => d.head.querySelector(sel)?.getAttribute("content")

suite("a screen's own head", () => {
  it("is the h1 and the app's name, the app's line standing, where the screen words nothing", () => {
    const d = draw(`<h1>Ana</h1>`)
    expect(d.title).toBe("Ana — battlechess")
    expect(meta(d, 'meta[name="description"]')).toBe("the app")
  })
  it("is the screen's own title and description where it marks them", () => {
    const d = draw(`<h1>Ana</h1><span hidden data-head="title">Ana on Bonk Chess</span><span hidden data-head="description">12 wins</span>`)
    expect(d.title).toBe("Ana on Bonk Chess")
    expect(meta(d, 'meta[name="description"]')).toBe("12 wins")
    expect(meta(d, 'meta[property="og:description"]')).toBe("12 wins")
  })
  it("falls back to the h1 and the app's line while its row has not landed", () => {
    const d = draw(`<h1></h1><span hidden data-head="title"></span><span hidden data-head="description"></span>`)
    expect(d.title).toBe("battlechess")
    expect(meta(d, 'meta[name="description"]')).toBe("the app")
  })
})
