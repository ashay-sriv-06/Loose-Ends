# Verification report (Prompt 14)

Scope frozen. All results below are from synthetic fixtures and a few separately hand-written cases, run on a laptop.
They show the checks behave as designed on these cases. They are **not** a measure of general accuracy and **not** NAS evidence.

## Results actually run

| Suite | Result |
|---|---|
| `npm test` (Vitest, 8 files) | **101 passed, 0 failed** (8 files) |
| `npm run typecheck` | clean |
| `npx tsx scripts/e2e.mts` (headless Chromium, desktop 1440×900 + mobile 390×844) | **21 of 21 steps passed** — see `docs/e2e-report.md`, screenshots in `docs/screenshots/` |
| Colour contrast (computed) | 16 of 16 pairs ≥ 4.5:1 — `docs/contrast.md` |

Defects found and fixed during verification:
1. Cancelling during the final consistency step let the run finish as “completed”. Now reports “cancelled”. (Found by `server.test.ts › cancel and restart never mix results`.)
2. Optional count included a built-in suggestion that had produced no check. Fixed in the reducer.
3. Instruction-like text inside *delivered* documents was not recorded (only briefs were). Now recorded and ignored.
4. Changing an authority decision did not mark the shown result as belonging to earlier choices. Fixed.
5. Dependency table broke file paths mid-name on desktop. Fixed (table scrolls inside its own container).
6. Grammar in the status reason (“items failed its check”). Fixed.

## Claim-to-test matrix

| # | Claim | Test(s) | Result |
|---|---|---|---|
| 1 | Baseline fixture yields the three expected problems | `fixture.test.ts › baseline…` (against `tests/expected/acme-baseline.json`, which no scanned folder contains); e2e “Check” | pass |
| 2 | Corrections resolve only the relevant findings | `recheck.test.ts › adding the missing deliverable…` (2 resolved, approval still failed); `fixture.test.ts › corrected state` | pass |
| 3 | Misleading file names cannot override contents | `fixture.test.ts › a misleading file name…` (1080x1920.png is really 1080×1350 → failed) | pass |
| 4 | Unreadable / unsupported required input cannot produce readiness | `fixture.test.ts › unsupported source format`, `› corrupt file`; `readiness.test.ts › unable-to-inspect…`, `› a coverage gap is never green` | pass |
| 5 | Missing brief or zero requirements cannot produce readiness | `readiness.test.ts › zero requirements`, `› no brief`; `runtime.test.ts › an empty brief selection can never be ready` | pass |
| 6 | Approval is never inferred from the newest timestamp | `recheck.test.ts › latest is not approved` (touches mtime, still failed); `› ambiguous "looks good"`; `extract.test.ts › file timestamps play no part` | pass |
| 7 | Scope conflicts stay unresolved until an authority decision | `fixture.test.ts › a conflicting amendment…` (both directions); `extract.test.ts › source authority`; e2e conflict step | pass |
| 8 | Added files invalidate relevant absence findings | `recheck.test.ts › a new candidate file invalidates the earlier "not found"` | pass |
| 9 | Input changed during inspection cannot yield a falsely current result | `runtime.test.ts › a file changed during inspection…`, `› a file that keeps changing is marked unresolved` | pass |
| 10 | References cannot escape authorized scope | `runtime.test.ts › authorized scope` (traversal, absolute, symlink, `../../outside.png` never opened); `server.test.ts › rejects unknown roots, traversal…` | pass |
| 11 | Embedded instructions cannot change permissions or results | `fixture.test.ts › embedded instructions are recorded and ignored`; `extract.test.ts › treats instruction-like text as data` | pass |
| 12 | Cycles and malformed files terminate safely | `fixture.test.ts › cyclic references terminate`, `› corrupt file` | pass |
| 13 | Cancel / restart cannot mix run results | `server.test.ts › cancel and restart never mix results`; `runtime.test.ts › cancellation leaves an honest state` | pass |
| 14 | A new project name and directory layout still work | `fixture.test.ts › metamorphic…` (all names changed, equivalent findings); source scan for fixture-specific strings | pass |
| 15 | A selected requirement change alters the checks | `extract.test.ts › a changed brief changes the actual checks`, `› a user-removed requirement is not checked` | pass |
| + | Stale evidence before recheck; history immutable | `recheck.test.ts › changing a verified file…`, `› an unrelated change cannot clear blockers`; `receipt.test.ts › stored runs reopen…` | pass |
| + | Receipt escaping, long names, partial runs, relative paths only | `receipt.test.ts` (5 tests) | pass |
| + | Real folders are read-only; demo fixes refuse them | `recheck.test.ts › demo fixes refuse real folders…`; `server.test.ts › real folders are read-only` | pass |
| + | Loopback only; other hosts and cross-site writes rejected; previews sandboxed | `server.test.ts` | pass |

## Visual QA (from screenshots)

Checked at desktop and mobile: no horizontal page overflow (asserted in e2e); long paths wrap; keyboard focus ring visible; segmented control responds to arrow keys; Escape closes the evidence panel; mobile evidence panel is a full-width sheet (asserted 390 px); reduced-motion disables transitions (asserted); loading, cancelled, stale, historical, conflict and unsupported states each have their own treatment.

## Known limitations (honest)

- **Not run on a UGREEN NAS.** The Skill passes the official creation tool's static check (`release/official-check.json`) but no delegation in it has been executed. See `docs/audit-2026-11-15.md`.
- **AI is optional and advisory.** By default promises are read by fixed rules; with `LOOSE_ENDS_MODEL` set, a local Ollama model may propose more, kept only when quoted verbatim. Unusual wording can be missed or misread; the review step and manual add exist for that. Sentences it cannot map become “needs your review”, never “checked”.
- **Matching is by file name.** A promised file delivered under a different name is reported missing.
- **Reference analysis covers** SVG `<image>/<use>/<feImage>` href / xlink:href and inline Markdown images/links only. CSS `url()`, `@import`, scripts, reference-style Markdown links and all proprietary formats are reported as not analysed.
- **Image size** is read for PNG and JPEG only. PDF internals are not inspected.
- **Approval records are not authenticated.** A fingerprint identifies content, not who approved it.
- **Change detection is before/after comparison**, not an atomic snapshot. A file changed and changed back within one check would not be noticed.
- **Recheck recomputes everything.** No selective rechecking is claimed.
- **Symlinks are not followed**; a symlink inside the delivery makes the scan incomplete (never green).
- “Open file” is not offered; “Copy path” is. Real user files are never modified.
- The UI was exercised in headless Chromium only. Safari and Firefox were not tested.
