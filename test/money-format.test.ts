// Plain numbers and decimals are formatted by the terminal without built-in
// money special-casing. The column is a number or decimal string, and the
// reader's own locale decides grouping and fraction digits. A money column
// formats with its currency, the column's or the row's (#Field.money).
import { describe, expect, it } from "@test/harness"
import { mountScreen, textOf } from "./screen-harness.ts"

const ROUTE = { screen: "ledger", files: { html: "ledger.html", css: "ledger.css", handlers: [] } }

const FILES = {
  "ledger.html": `<section class="screen" data-screen="ledger">
    <ul data-live="expense">
      <template data-item><li>
        <span class="amount" data-text="{amount}" data-text-format="number"></span>
        <span class="seats" data-text="{seats}" data-text-format="number"></span>
      </li></template>
    </ul>
  </section>`,
  "ledger.css": "",
}

const schema = {
  expense: {
    fields: [
      { name: "id", type: "text" },
      { name: "amount", type: "int" },
      { name: "seats", type: "int" },
    ],
  },
}

const world = { expense: [{ id: "e1", amount: 1204, seats: 1234 }] }

describe("plain numbers and decimals are formatted without built-in money special-casing", () => {
  it("renders integer columns with locale grouping and no currency prefix", async () => {
    for (const [locale, amount, seats] of [["pt-BR", "1.204", "1.234"], ["en-US", "1,204", "1,234"]]) {
      const m = await mountScreen({ route: ROUTE, files: FILES, tables: world, seed: 1, schema, locale })
      await m.settle()
      expect(textOf(m.one(".amount"))).toBe(amount)
      expect(textOf(m.one(".seats"))).toBe(seats)
      await m.stop()
    }
  })

  it("renders decimal columns with locale decimal separator without scaling by minor units", async () => {
    const decimalSchema = {
      expense: {
        fields: [
          { name: "id", type: "text" },
          { name: "amount", type: "decimal" },
          { name: "seats", type: "int" },
        ],
      },
    }
    const decimalWorld = { expense: [{ id: "e1", amount: "1204.50", seats: 1234 }] }
    for (const [locale, amount] of [["pt-BR", "1.204,5"], ["en-US", "1,204.5"]]) {
      const m = await mountScreen({ route: ROUTE, files: FILES, tables: decimalWorld, seed: 1, schema: decimalSchema, locale })
      await m.settle()
      expect(textOf(m.one(".amount"))).toBe(amount)
      await m.stop()
    }
  })
})

describe("data-text-format=\"money\" on a screen", () => {
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
  // ICU separates with no-break and narrow no-break spaces; the reader sees spaces.
  const seen = (text: string) => text.replace(/[\u00a0\u202f]/g, " ")
  const ROUTE = { screen: "offers", files: { html: "offers.html", css: "offers.css", handlers: [] } }
  const FILES = {
    "offers.html": `<section class="screen" data-screen="offers">
      <ul data-live="offer">
        <template data-item><li>
          <span class="rent" data-text="{rent}" data-text-format="money"></span>
          <span class="deposit" data-text="{deposit}" data-text-format="money"></span>
        </li></template>
      </ul>
    </section>`,
    "offers.css": "",
  }
  // Two rows, two currencies: each amount reads in its own.
  const world = {
    offer: [
      { id: "o1", rent: "18900", rent_currency: "BRL_2", deposit: 5000, seats: 1 },
      { id: "o2", rent: "123456", rent_currency: "USD_2", deposit: 5000, seats: 1 },
    ],
  }

  it("formats each row's amount in its row's currency and the reader's locale", async () => {
    for (const [locale, rents, deposit] of [
      ["pt-BR", ["R$ 189,00", "US$ 1.234,56"], "JP¥ 5.000"],
      ["en-US", ["R$189.00", "$1,234.56"], "¥5,000"],
    ] as const) {
      const m = await mountScreen({ route: ROUTE, files: FILES, tables: world, seed: 1, schema, locale })
      await m.settle()
      expect(m.all(".rent").map((el) => seen(textOf(el)))).toEqual([...rents])
      expect(m.all(".deposit").map((el) => seen(textOf(el)))).toEqual([deposit, deposit])
      await m.stop()
    }
  })
})
