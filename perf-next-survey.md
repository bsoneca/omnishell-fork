# Omnishell: next optimizations (survey, 2026-11-04)

Measured 15:20–15:55 BRT on the M5 Max, Chrome, CPU rate 1. The load average was 9–120 the whole time, so every A/B was interleaved and medians are given; read anything under about 3% as noise. Omnishell was measured as **var-five**: the v0.19.1 base with fixes #2, #6, #7, #9 and #11, served by route. Stock v0.19.1 is shown for reference.

Detailed reports (tables, scripts, traces) are in `.omc/research/` in this worktree: `cmp.md`, `startup.md`, `bulk-memory.md`, `c-cases.md`. Scripts and prototype variants are in the session scratchpad: `/private/tmp/claude-501/-Users-bruno-code-omnishell--claude-worktrees-perf-next-survey-cf15a9/be4c6b76-a7ea-498a-9627-b7305c908eaf/scratchpad/`.

## Fresh comparison (one interleaved run, 15:22–15:37 BRT)

Click-to-paint medians in ms, jfb rule. Runs: 15 per case, 10 for 07 and 08, 30 for C2.

| case | omni-five | omni-stock | Solid | vanilla | five − Solid | load |
|---|---|---|---|---|---|---|
| 01 create 1k | 39.9 | 52.7 | 23.1 | 23.0 | **+16.8** | 58 |
| 02 replace 1k | 39.3 | 48.8 | 25.2 | 21.8 | **+14.1** | 52 |
| 03 update 10th | 12.9 | 31.8 | 12.7 | 13.6 | +0.2 | 37 |
| 04 select | 11.5 | 27.7 | 10.9 | 11.3 | +0.6 | 32 |
| 05 swap | 13.0 | 44.0 | 13.1 | 12.9 | −0.1 | 28 |
| 06 remove | 12.9 | 45.7 | 12.6 | 13.1 | +0.3 | 26 |
| 07 create 10k | 321.9 | 423.7 | 232.4 | 215.2 | **+89.5** | 25 |
| 08 append 1k to 10k | 87.1 | 106.5 | 68.2 | 62.5 | **+18.9** | 17 |
| 09 clear | 13.7 | 30.2 | 13.7 | 13.6 | −0.1 | 11 |
| C1 remote change | 8.6 | 14.1 | 9.4 | 12.2 | −0.8 | 9 |
| C2 optimistic create (p25/med/p75) | 17.4/18.2/18.5 | 33.0 | 14.1/14.7/15.1 | 14.6 | **+3.5** | 12 |
| C3 max input delay, typing during 10k | 47.6 | 45.9 | 170.6 | 155.4 | −123 | 22 |

Startup (B, median of 6 runs):

| | first paint | JS gzip | heap after load | heap after 10k |
|---|---|---|---|---|
| omni (stock, plain mount) | 68 ms | 338 KB | 5.0 MiB* | 22.2 MiB |
| omni-five | — | — | 5.1* | 21.1 |
| Solid | 38 | 4.9 KB | 1.3* | 11.0 |
| vanilla | 32 | 2.7 KB | 1.2* | 3.6 |

\* The harness reads the heap after `page.waitForFunction`, which injects Playwright's script into the page. Measured clean, Omnishell is 2.90 MiB and Solid 0.69, so the real gap is about +2.2 MiB, not +3.8. omni-five's first paint and bytes are not comparable: served through `ctx.route` they are uncompressed, and the route adds about 20 ms.

**Where the gaps are**
- The single-row cases (03–06, 09) and C1 are at the vsync floor, equal to Solid. Omnishell's 1.3–4.8 ms of work hides in the click task, and the in-frame cost is about 0 ms. Nothing is left to win there.
- C3 is already 3.5× better than Solid.
- What's left:
  - bulk create: 1k is 1.7× Solid and 10k is 1.4×;
  - C2: +3.5 ms;
  - memory after 10k rows: 2×;
  - startup: bytes, SES, and the fixed heap base.

## Ranked suggestions

Ranked by gain against effort and risk. "Measured" means prototyped on a copy and A/B'd; "profile" means estimated from self time.

| # | Change | Measured cost today | Expected gain | Risk | Effort |
|---|---|---|---|---|---|
| 1 | **Flush a small optimistic write in the submit's own task, and skip the settle wake for local tables.** Same guard as #9: `inFlight === 0` and `PROMPT_FOLD_MS`. Wire it from the form handler in `screen.js` (2352/2359/2365) and make `notifySettled` return early for `local[table]` (`data-sync.js` ~1608). | C2: row DOM is built in a rAF (1.8 ms), plus a second settle wake about 1 ms later. | **Measured:** C2 26.5 → 13.2 ms on the fork interpreter (n=25). Against references, 11.8 vs Solid 12.9 / vanilla 12.5. The slow mode disappears. 9 smokes pass on the patched copy. | low–med (the synced-table path isn't measured separately) | S, ~15 lines; diff in `scratchpad/w4/wt-c2.diff` |
| 2 | **Per-row memory:** make the row ctx a class with `locale` as a prototype getter. Today the `get locale()` literal puts every ctx in dictionary mode. Share one empty `nested` Map until `syncNested` needs its own. | 416 + 76 B/row, the largest item in the 10k snapshot. | **Measured:** heap after 10k 21.5 → 16.2 MiB; time neutral. | low (no ctx spread or keys use found) | S, ~17 lines (`screen.js` row entry, var-five 4057–4073; `syncNested`) |
| 3 | **Skip the per-row `validate` loop when the table has no validations.** | 10k async calls, about 3.7 MiB of allocation (5%). | **Profile:** −3.7 MiB allocation, about −1 ms at 10k, fewer microtask turns. | low | XS, 3 lines (`data-sync.js` `write`/`add`) |
| 4 | **Use `getAttributeNames()`/`getAttribute()` instead of `el.attributes`** in `onAttrs`, `hasBoundAttribute` and `bindElementAttributes`. | 5 `Attr` + 3 `NamedNodeMap` native objects per row (about 650 B/row native, 1.1 MiB JS). | **Measured:** −1.1 MiB JS heap and −6.5 MB native at 10k. Create-10k script time was 8–19% lower in 4 of 4 pairs; 1k was mixed. Re-check on a quiet machine. | low | S, ~10 lines |
| 5 | **Minify and bundle the interpreter's own modules** (`deno bundle --minify --code-splitting`), with modulepreload hints for the chunks. | 298 KB gzip of JS on the table path. | **Measured:** 298 → 193 KB gzip (−35%). It rendered correctly and created 1000 rows with no errors. No CPU saving. | low (build step only) | M (build script and preload list) |
| 6 | **Make hatch×4, link-prefetch and `messages.js` lazy** (dynamic import, the existing pattern at `screen.js:2107`/`4846`). | 22.8 KB gzip; 71% of messages.js never runs. | −22.8 KB gzip, a little parse time. | low | S, ~25 lines |
| 7 | **Store each step's event list in the binding plan**, so `bindTree` skips the `onAttrs`/`bind` string work per row. | `onAttrs` 6.7 + `bind` 9.3 ms at 10k. | **Profile:** −6 to −8 ms at 10k (−5% JS), plus 3 fewer strings per row. | low | S, ~12 lines (`bindingPlan`, `bindTree`) |
| 8 | **Find why style recalc is +25 ms at 10k** (80.5 vs Solid 54.9). Suspects: `class="none"` on every `<tr>`, `data-*` attributes, insertion order. | +25 ms at 10k, +1.3 at 1k. | Up to −20 ms at 10k, as large as #10. | — | S to investigate |
| 9 | **Defer SES lockdown and compartments to first handler use, or to idle.** | Biggest single pre-paint item: about 9 ms self, plus 0.8 MiB heap and 45 KB gzip. | **Measured (stubbed):** −12 to −14 ms of main-thread CPU before first paint; wall-clock first paint −3 ms (within noise); −0.8 MiB. | med (queued clicks, validation at load) | M |
| 10 | **Bypass the optimistic transaction layer for tab and local tables**: apply the batch with sync begin/write/commit. | Store write is 30 of 133 ms of JS at 10k; 32 of 77 MiB allocated (10k `randomUUID`, 20k `Date`, mutation records). | **Profile:** −15 to −20 ms at 10k, −2 ms at 1k, −35% allocation. | high (rollback, `$synced`, `onSettled`, refusals; vendor bundle) | L |
| 11 | **Local-only data plane:** don't load the full mecha client when an app has no server tables. | mecha-client is 114 KB gzip (33%); 73% of it never runs at load, and it is the last preload to land on slow links. | −40 to −57 KB gzip (estimate). | high | L |
| 12 | **Small list-pass wins:** skip the child sweep in `placeListNodes` when nothing departed; replace wholesale when no row survives; skip the placement pass when nothing arrived, left or moved. | 0.4–3.6 ms. | **Measured:** append to 10k −2.3 ms; replace −0.7 ms. | low–med | S–M |
| 13 | **Event delegation for item handlers.** | 2 closures and 2 listeners per row (244 B). | **Measured:** −252 B/row heap, **no time gain**. Memory only. | med (event order, `currentTarget`, hatch code) | M |

Combined: #2–#4 together measured **21.5 → 14.0 MiB** after 10k rows. Per-row cost then drops below Solid's (about 600 vs 858 B/row). What remains is a fixed base of about 4.4 MiB: SES, interpreter modules, mecha and compartments, which #9 and #11 attack. #5, #6, #9 and #11 together would bring startup to about 150–170 KB gzip with about 30% less pre-paint CPU. That is still far from Solid's 5 KB, a floor set by the interpreter design.

**Floor for create 10k.** Native style, layout and paint already match Solid, except for #8. Even with all JS fixed, create 10k can't go below about 275 ms on this machine. #7 + #8 + #10 together would close most of the 90 ms.

### Harness fixes (framework-bench; not applied, REPORT.md untouched)
- **Heap after load:** read `memLoad` before `waitForFunction`, or poll with CDP instead of Playwright's injected script. The current reading overstates Omnishell by 2.1 MiB.
- **C2 slow mode:** a 600 ms flash timer, armed by the last warm-up submit, fires inside the trace window, and the jfb rule then lands on a trailing frame. Wait about 700 ms after warm-up in `cases-c.mjs`. Alternatively, cancel the previous flash timer on a new submit (`screen.js:2377`, about 6 lines, untested).
- **Variants served by `ctx.route`** add about 20 ms to first paint and skip compression. Mount variant directories on the server for startup numbers.

### Already at the floor (no action)
Select, update, swap, remove, clear and C1 are vsync-bound with about 0 ms of in-frame Omnishell work. C1 has no wasted hop: the wake runs 0.3 ms after the write. C3 beats Solid by 3.5×.

### Under ~20 lines and safe
#1 (P2, one line), #2, #3 and #4 qualify. None was applied: this survey changed no repo code. They fit one small PR against `line/0.20.3`, gated by the unit suite and the `_smokes`.
