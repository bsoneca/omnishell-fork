import { describe, expect, it } from "@test/harness"
import { parseHTML } from "linkedom"
import { appTitle, describe as describeDocument } from "../interpreter/chrome.js"

// A document names itself after its screen's h1 and the app: by the app's display
// name when the program gives one (shell.json `title`), else by its `app`.
const titled = (cfg: Record<string, unknown>, h1: string | null) => {
  const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>")
  const el = document.createElement("section")
  if (h1 !== null) el.innerHTML = `<h1>${h1}</h1>`
  const route = { path: "/learn", screen: "learn", nav: { key: "nav_learn", label: "Learn" } }
  describeDocument(document, { routes: [route], ...cfg }, { route, params: {}, locale: undefined, written: "/learn", el, origin: "" })
  return document.querySelector("title")?.textContent
}

describe("a document's title", () => {
  it("names the app by its display name when the program gives one", () => {
    expect(titled({ app: "battlechess", title: "Bonk Chess" }, "How to play chess")).toBe("How to play chess — Bonk Chess")
    expect(titled({ app: "battlechess", title: "Bonk Chess" }, null)).toBe("Bonk Chess")
  })
  it("names it by its app otherwise", () => {
    expect(titled({ app: "truco" }, "Como se joga")).toBe("Como se joga — truco")
    expect(appTitle({ app: "truco" })).toBe("truco")
  })
})
