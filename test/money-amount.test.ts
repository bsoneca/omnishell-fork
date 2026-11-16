import { describe, expect, it } from "@test/harness"
import { currencyOf, formatMoney, ProjectionError } from "../interpreter/screen.js"

// An amount is an integer count of its currency's minor units, and how it reads
// is two facts at once: the currency's (its symbol, its scale) and the reader's
// locale (where the symbol goes, the grouping, the decimal mark, the digits).
// Neither is the column's text, and neither is one country's by default.

const at = (locale: string) => ({ locale })
const brl = { code: "BRL", minorUnits: 2 }
// ICU separates with no-break and narrow no-break spaces; the cases compare
// the visible text, which is what a reader is shown.
const seen = (text: string) => text.replace(/[  ]/g, " ")

describe("formatMoney", () => {
  it("draws the currency's symbol where the reader's locale puts it", () => {
    expect(seen(formatMoney("18900", brl, at("pt-BR")))).toBe("R$ 189,00")
    expect(formatMoney("18900", brl, at("en-US"))).toBe("R$189.00")
    expect(formatMoney("123456", { code: "USD", minorUnits: 2 }, at("en-US"))).toBe("$1,234.56")
    expect(seen(formatMoney("123456", { code: "USD", minorUnits: 2 }, at("pt-BR")))).toBe("US$ 1.234,56")
    expect(seen(formatMoney("123456", { code: "EUR", minorUnits: 2 }, at("de-DE")))).toBe("1.234,56 €")
    expect(seen(formatMoney("123456", { code: "EUR", minorUnits: 2 }, at("fr-FR")))).toBe("1 234,56 €")
  })

  it("groups and writes digits the reader's way", () => {
    // NOT 123,456,789: India groups by lakhs and crores.
    expect(formatMoney("123456789", { code: "INR", minorUnits: 2 }, at("en-IN"))).toBe("₹12,34,567.89")
    // Bahrain's dinar in Arabic-Indic digits.
    const bhd = formatMoney("1234", { code: "BHD", minorUnits: 3 }, at("ar-BH"))
    expect(bhd).toContain("١٫٢٣٤")
    expect(bhd).toContain("د.ب.")
  })

  it("places the decimal by the currency's scale, not by two", () => {
    expect(formatMoney("1050", { code: "JPY", minorUnits: 0 }, at("ja-JP"))).toBe("￥1,050")
    expect(seen(formatMoney("1234", { code: "BHD", minorUnits: 3 }, at("en-US")))).toBe("BHD 1.234")
    // BRL_4, a rate's precision: four places, never rounded to the centavo.
    expect(seen(formatMoney("1050", { code: "BRL", minorUnits: 4 }, at("pt-BR")))).toBe("R$ 0,1050")
    expect(formatMoney("5", brl, at("en-US"))).toBe("R$0.05")
  })

  it("keeps every digit of an int64 past a double's 2^53", () => {
    // Through Number() this reads ...409.92; the string reaches Intl as a decimal literal.
    expect(formatMoney("9007199254740993", brl, at("en-US"))).toBe("R$90,071,992,547,409.93")
  })

  it("signs a negative amount the locale's way", () => {
    expect(formatMoney("-500", brl, at("en-US"))).toBe("-R$5.00")
  })

  it("shows a code that is no ISO 4217 currency after the reader's digits", () => {
    // A token such as a stablecoin takes an alpha code longer than ISO 4217's; Intl takes three letters only.
    expect(formatMoney("1500000", { code: "USDC", minorUnits: 6 }, at("pt-BR"))).toBe("1,500000 USDC")
    // A well-formed code Intl has no symbol for is written as its code.
    expect(seen(formatMoney("100", { code: "XYZ", minorUnits: 2 }, at("en-US")))).toBe("XYZ 1.00")
  })

  it("renders blank for an absent amount, and an unparsable one as it is", () => {
    for (const blank of [null, undefined, ""]) expect(formatMoney(blank, brl, at("pt-BR"))).toBe("")
    // The storybook's synthesized "Sample <column> 1" stays legible, as formatNumber leaves it.
    expect(formatMoney("Sample rent 1", brl, at("pt-BR"))).toBe("Sample rent 1")
    // A row whose currency has not arrived shows its count rather than a guessed currency.
    expect(formatMoney("18900", undefined, at("pt-BR"))).toBe("18900")
  })
})

const schema = {
  offer: {
    fields: [
      { name: "id", type: "text" },
      { name: "rent", type: "int64", money: { currencyField: "rent_currency" } },
      { name: "rent_currency", type: "string" },
      { name: "deposit", type: "int32", money: { currency: "JPY", minorUnits: 0 } },
      { name: "seats", type: "int32" },
    ],
  },
}

describe("currencyOf", () => {
  const ctx = (row: Record<string, unknown>, inert = false) => ({ cfg: { schema }, table: "offer", row, locale: "pt-BR", inert })

  it("reads a row's currency off the sibling field, `{ISO 4217}_{decimals}`", () => {
    expect(currencyOf("rent", ctx({ rent: "18900", rent_currency: "BRL_2" }))).toEqual({ code: "BRL", minorUnits: 2 })
    expect(currencyOf("rent", ctx({ rent: "1050", rent_currency: "JPY_0" }))).toEqual({ code: "JPY", minorUnits: 0 })
    expect(currencyOf("rent", ctx({ rent: "1", rent_currency: "USDC_6" }))).toEqual({ code: "USDC", minorUnits: 6 })
  })

  it("takes the column's currency where the field states one", () => {
    expect(currencyOf("deposit", ctx({ deposit: 1050 }))).toEqual({ code: "JPY", minorUnits: 0 })
  })

  it("answers no currency for a row whose sibling is empty or malformed", () => {
    // A scale past 18 is none the schema admits (#Field.money's minorUnits);
    // a code is ISO 4217 or a longer alpha one, never fewer than 3 letters or
    // one holding a digit.
    for (const held of [null, "", "BRL", "brl_2", "BRL_X", "BRL_19", "BRL_02", "A_2", "US_2", "US1_2"]) {
      expect(currencyOf("rent", ctx({ rent: "18900", rent_currency: held }))).toBe(undefined)
    }
    expect(currencyOf("rent", ctx({ rent: "1", rent_currency: "BRL_18" }))).toEqual({ code: "BRL", minorUnits: 18 })
  })

  it("refuses a row its region's data-select hands without the currency field", () => {
    // data-select="id,rent" keeps the amount and drops its currency.
    expect(() => currencyOf("rent", ctx({ id: "o1", rent: "18900" }))).toThrow(ProjectionError)
    // An optimistic insert carries only what was submitted, and an inert render no row at all.
    expect(currencyOf("rent", ctx({ rent: "18900", $synced: false }))).toBe(undefined)
    expect(currencyOf("rent", ctx({ rent: "18900" }, true))).toBe(undefined)
  })

  it("refuses a column that declares no money, unless the render is inert", () => {
    expect(() => currencyOf("seats", ctx({ seats: 3 }))).toThrow(ProjectionError)
    expect(currencyOf("seats", ctx({ seats: 3 }, true))).toBe(undefined)
  })
})
