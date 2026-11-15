import { describe, expect, it } from "@test/harness"
import { type Entity, formatBindings, formatLint } from "../interpreter/lint.ts"

// data-text-format="money" is the one format that needs more than the value:
// the currency code and the minor-unit scale ride the column (schema.cue
// #Field.money), so a binding whose column the emitted schema cannot answer for
// has no currency to render with — and the interpreter refuses it at hydration.
// This is the rung that says so before a screen is ever mounted.

const ledger: Entity = {
  table: "expense",
  durability: "server",
  fields: [
    { name: "id", type: "uuid", pk: true },
    { name: "note", type: "text" },
    { name: "amount", type: "int", money: { currency: "BRL", minorUnits: 0 } },
    { name: "seats", type: "int" },
  ],
}

const one = (html: string) => formatBindings(html)[0]

describe("formatBindings", () => {
  it("binds each placeholder to the region whose row carries it", () => {
    expect(formatBindings('<ul data-live="expense"><template data-item><li data-text="{amount} de {note}" data-text-format="money"></li></template></ul>'))
      .toEqual([
        { format: "money", expr: "amount", table: "expense" },
        { format: "money", expr: "note", table: "expense" },
      ])
  })

  it("resolves a nested region against its own table, not the one around it", () => {
    // The tag stack exists for this case: a checker reading the outermost
    // data-live would grade a nested list's columns against the wrong entity.
    expect(
      formatBindings(
        '<ul data-live="category"><template data-item><li>' +
          '<ol data-live="expense"><template data-item><li data-text="{amount}" data-text-format="money"></li></template></ol>' +
          "</li></template></ul>",
      ),
    ).toEqual([{ format: "money", expr: "amount", table: "expense" }])
  })

  it("binds a region's own data-text in that region's context", () => {
    // bindTexts is handed the region as its scope and matches it, so the
    // region's own binding reads its own row and not its parent's.
    expect(one('<ul data-live="category"><span data-live="expense" data-text="{amount}" data-text-format="money"></span></ul>'))
      .toEqual({ format: "money", expr: "amount", table: "expense" })
  })

  it("reports a binding under no region with no table", () => {
    expect(one('<p data-text="{msg.total}" data-text-format="money"></p>'))
      .toEqual({ format: "money", expr: "msg.total", table: undefined })
  })

  it("scans no markup a comment or a script holds", () => {
    expect(formatBindings('<!-- <p data-text="{x}" data-text-format="money"></p> -->')).toEqual([])
  })
})

describe("formatLint", () => {
  it("accepts portable numeric carriers for number formatting", () => {
    for (const type of ["int32", "int64", "double", "decimal"]) {
      const entity = { ...ledger, fields: [{ name: "value", type }] }
      expect(formatLint({ format: "number", expr: "value", table: "expense" }, entity)).toBe(null)
    }
  })

  it("is silent on a money column that declares one", () => {
    expect(formatLint({ format: "money", expr: "amount", table: "expense" }, ledger)).toBe(null)
  })

  it("refuses money on a column declaring none", () => {
    expect(formatLint({ format: "money", expr: "seats", table: "expense" }, ledger))
      .toBe('data-text-format="money" reads {seats}, which declares no money: on "expense"')
  })

  it("refuses money on an expression that is not a column of the region's table", () => {
    // A route param, a message and an embedded join all resolve somewhere the
    // column declaration is not, and the formatter cannot guess a currency.
    for (const expr of ["param.id", "msg.total", "category.budget"]) {
      expect(formatLint({ format: "money", expr, table: "expense" }, ledger))
        .toContain(`reads {${expr}}, which is not a column of "expense"`)
    }
    expect(formatLint({ format: "money", expr: "ghost", table: "expense" }, ledger))
      .toContain('reads {ghost}, which is not a column of "expense"')
  })

  it("reads a row's currency off a sibling column the table has, and refuses one it lacks", () => {
    const offer: Entity = {
      table: "offer",
      durability: "server",
      fields: [
        { name: "id", type: "uuid", pk: true },
        { name: "rent", type: "int64", money: { currencyField: "rent_currency" } },
        { name: "rent_currency", type: "string" },
        { name: "fee", type: "int64", money: { currencyField: "fee_currency" } },
      ],
    }
    expect(formatLint({ format: "money", expr: "rent", table: "offer" }, offer)).toBe(null)
    expect(formatLint({ format: "money", expr: "fee", table: "offer" }, offer))
      .toBe('data-text-format="money" reads {fee}, whose currency field fee_currency is not a column of "offer"')
  })

  it("refuses a data-select that leaves a row's currency out, and keeps every other", () => {
    const offer: Entity = {
      table: "offer",
      durability: "server",
      fields: [
        { name: "id", type: "uuid", pk: true },
        { name: "rent", type: "int64", money: { currencyField: "rent_currency" } },
        { name: "rent_currency", type: "string" },
        { name: "deposit", type: "int32", money: { currency: "JPY", minorUnits: 0 } },
      ],
    }
    const html = (select: string) =>
      `<ul data-live="offer" data-select="${select}"><template data-item><li data-text="{rent}" data-text-format="money"></li></template></ul>`
    for (const select of ["*", "*,device(name)", "id,rent,rent_currency", "rent,rent_currency::text", "id, rent , rent_currency"]) {
      expect(formatLint(one(html(select)), offer)).toBe(null)
    }
    for (const select of ["id,rent", "rent,currency:rent_currency", "rent,rent_currency(code)", "rent,rent_currency.count()"]) {
      expect(formatLint(one(html(select)), offer))
        .toBe(`data-text-format="money" reads {rent}, whose currency field rent_currency the region's data-select="${select}" leaves out of the row`)
    }
    // The column's own currency rides no row, so a projection cannot drop it.
    const deposit = '<div data-live="offer" data-select="id,deposit"><span data-text="{deposit}" data-text-format="money"></span></div>'
    expect(formatLint(one(deposit), offer)).toBe(null)
  })

  it("carries the select of the region whose row it binds", () => {
    expect(one('<div data-live="offer" data-select="id,rent"><p><span data-text="{rent}" data-text-format="money"></span></p></div>'))
      .toEqual({ format: "money", expr: "rent", table: "offer", select: "id,rent" })
    // A nested region's own select, not its parent's.
    expect(one('<div data-live="a" data-select="*"><div data-live="offer"><span data-text="{rent}" data-text-format="money"></span></div></div>'))
      .toEqual({ format: "money", expr: "rent", table: "offer" })
  })

  it("refuses money outside every region", () => {
    expect(formatLint({ format: "money", expr: "total", table: undefined }, undefined))
      .toContain("outside every data-live region")
  })

  it("holds number to a declared column's type and to nothing else", () => {
    expect(formatLint({ format: "number", expr: "seats", table: "expense" }, ledger)).toBe(null)
    expect(formatLint({ format: "number", expr: "note", table: "expense" }, ledger))
      .toBe('data-text-format="number" reads {note}, which is text on "expense"')
    // A derived column — data-project's index, count and lanes — is a number
    // the schema never mentions, and a rule refusing it would be a rule about
    // the wrong layer.
    expect(formatLint({ format: "number", expr: "place", table: "expense" }, ledger)).toBe(null)
    expect(formatLint({ format: "number", expr: "param.page", table: undefined }, undefined)).toBe(null)
  })

  it("holds no other format to a declaration", () => {
    // datetime formats any text, plain formats none, and a renderer is the
    // app's own module.
    for (const format of ["plain", "datetime", "date", "time", "markdown"]) {
      expect(formatLint({ format, expr: "note", table: "expense" }, ledger)).toBe(null)
    }
  })
})
