# Build Log

Format: one section per prompt. Record what exists, checks actually run, blockers, next step.

## Prompt 01 — Product and platform (docs)
- Created `docs/product-contract.md`, `docs/platform-capabilities.md`, this log.
- Read: official rules (Devpost) and Starter Kit page, via the user's browser.
- **Blocker:** official creation tool archive `uliya-skill-kit-0.7.7-en.zip` not downloaded (needs user permission). Exact UGOS CLI/expert-agent names unknown; none invented.
- Repository was new: stack chosen = React + TypeScript + Vite, minimal Node TS backend.

## Prompt 04 — Native Skill (initial package)
- See `release/checkpoint-1/skill-validation.txt` for the checks run by `scripts/package-skill.ts`.
- Status: initial package following the publicly documented format. **Not** checked by the official creation tool; **not** a validated NAS package.

## Prompt 05 — Round 1 checkpoint
- See `release/checkpoint-1/CHECKPOINT.md` (paths, sizes, word count, gaps).

## Prompt 02 — Domain model and readiness
- `src/domain/model.ts`, `src/domain/readiness.ts`. Execution state, check outcome and applicability are three separate fields.
- Check: `tests/readiness.test.ts` — 19 tests pass (mixed failures/unknowns, zero requirements, partial coverage, conflicting scope, no double counting, no percentages).

## Prompt 03 — Synthetic fixture
- `src/fixture/build.ts` generates real PNG (valid chunks/CRC), PDF (valid xref), SVG and Markdown files; baseline, corrected and renamed variants; seven edge cases.
- Answer key in `tests/expected/` (outside every scanned folder). Reset: `npm run fixture:reset`, guarded by a marker file and a parent-directory check.
- Check: `tests/fixture.test.ts` — 13 tests pass, including the rename (metamorphic) test and a scan proving no fixture names appear in `src/domain` or `src/engine`.

## Prompt 06 — Runtime boundary
- `src/engine/adapter.ts` (allowlisted roots, path normalization, no symlink following, limits), `src/engine/run.ts` (progress events, cancellation, before/after change detection with one automatic recheck), `src/engine/store.ts`, `src/server/app.ts` (loopback, host/origin checks).
- Adapters are labelled `synthetic-fixture` or `local-actual`. `native-nas-verified` exists as a label only; no NAS adapter is implemented.
- Check: `tests/runtime.test.ts` (15) and `tests/server.test.ts` (8) pass.

## Prompt 07 — Brief → promises, authority
- `src/engine/extract.ts`: rule-based reader (labelled as such, not AI), required / conditional / optional, provenance, authority resolution by user decision or explicit approval record.
- **Not built:** a model provider. No API key was configured, so none is wired; the UI says so. Manual add/remove is available.
- Check: `tests/extract.test.ts` — 11 tests pass.

## Prompt 08 — “What your client gets”
- `src/engine/references.ts`, `src/engine/images.ts`, boundary checks in `src/engine/checks.ts`.
- Check: covered in fixture/runtime tests (escape, encoded, fragments, data URIs, cycles, missing).

## Prompt 09 — Approvals and rechecks
- Approval matching by sha256 when the record gives one, else version number (flagged weaker). `src/engine/freshness.ts`: derived staleness view and run diff; stored runs never change. Full recomputation on recheck; no selective recheck claimed.
- Check: `tests/recheck.test.ts` — 16 tests pass.

## Prompts 10–12 — Interface, evidence wiring, fix loop
- `web/src/App.tsx`, `Boundary.tsx`, `Picker.tsx`, `styles.css`. References actually seen: `docs/design-references.md`. Contrast: `docs/contrast.md`.
- Demo fixes do real file operations in the fixture root only (`src/engine/demo.ts`).
- Check: `scripts/e2e.mts` — 21 of 21 browser steps pass (desktop + mobile). Screenshots in `docs/screenshots/`.

## Prompt 13 — Receipt and history
- `src/engine/receipt.ts` (HTML + JSON, relative paths, escaped, no scripts), history in `.data/runs/` (write-once).
- Check: `tests/receipt.test.ts` — 5 tests pass; export and reload covered in e2e.

## Prompt 14 — Adversarial verification
- `docs/verification-report.md`. 87 of 87 tests pass; six defects found and fixed (listed there).

## Prompt 15 — Final deliverables
- `release/loose-ends-skill.zip`, `release/loose-ends-proposal.pdf`, `release/FINAL.md`; earlier checkpoint kept in `release/checkpoint-1/`.
- Nothing was submitted, deployed, emailed, published or committed.

## Open blockers
1. Official creation tool (`uliya-skill-kit-0.7.7-en.zip`) not downloaded — awaiting the user’s permission. Until it is read: exact UGOS CLI command names are unbound and the tool’s own check has not been run.
2. Entrant name / signature block in the PDF is blank for the user to complete.
3. No NAS testing (only available to finalists).

## Audit and fixes — 2026-11-15 evening
- Preserved prior release with hashes: `release/preserved-2026-11-15/`.
- Downloaded official creation tool to `vendor/` (git-ignored). Its checker rated the earlier Skill `not-uploadable` (5 errors). Rewrote `SKILL.md` to the official contract with catalog CLIs/experts and five delegations: now `static-pass`, 0 errors, 0 warnings.
- Corrected a false capability claim in the proposal (reconcile) and rebuilt the PDF (485 words).
- Added optional local-model brief reading (`src/engine/model.ts`, Ollama loopback, verbatim-quote gate). 95 of 95 tests; 21 of 21 browser steps.
- Full findings and matrix: `docs/audit-2026-11-15.md`.
- Still blocked: no NAS execution; entrant signature; submission.

## Native binding pass — 2026-11-15 late
- Verified the kit URL on the official starter-kit page; recorded URL, date, size, hash in `docs/native-workflow.md`. Installed the kit project-locally (`.claude/skills/`, git-ignored).
- Skill revised: image size now via `ug-photo` → `photo-agent` (`meta`); `ug-filemgr` dropped; SVG and staleness claims narrowed; recheck flow added. Official check: `static-pass`.
- Proposal rebuilt (487 words). Release hashes in `release/SHA256SUMS.txt`.
- Blocker unchanged: no NAS execution.

## Model-backed brief reading — 2026-11-15 night
- Provider: Ollama on loopback (`qwen3.5:4b`), the only explicitly available option; no credential involved.
- `src/engine/model.ts` rewritten: schema-validated calls, typed failures, no silent fallback, guards on every model job. Three labelled modes in the UI, setup/error screen, confirmed-set persistence with brief hashes, plain-language help.
- Live run on a new synthetic brief recorded in `docs/model-integration.md` and `docs/live-model-demo/`.
- Checks: 101 of 101 tests; 21 of 21 main browser steps; 6 of 6 model-screen browser steps (real model).
- Release ZIP and PDF not rebuilt in this pass (the PDF still says 95 tests).

## 2026-11-15 — Evaluation set

Built `eval/` (17 synthetic cases, pre-written answer keys, runner). First run exposed three false-readiness
defects and seven missed promises; fixed and re-run. Details and remaining weaknesses: `docs/evaluation.md`.
Tests 107/107, browser walk-through 21/21. Release ZIP/PDF not rebuilt (the Skill package is unaffected; the PDF
still says 95 tests).

## 2026-11-15 — Interface refinement

Same scope, clearer first screen, findings-first result, side-by-side evidence, explicit states. References viewed
in a browser this time (`docs/design-references.md`). Record, defects and heuristic review: `docs/interface-review.md`.
Checks: ui-review 23/23, walk-through 21/21, AI screens 6/6 (live model), unit tests 107/107.

## 2026-11-15 — Reliability and security pass

Attack probe (`scripts/security-probe.mts`) against the real backend: 17/33 before, 33/33 after. Fixed: Markdown
scanner stall, demo-fix symlink escape, silent 2 MB truncation, failed check leaving the earlier verdict unlabelled,
positional folder ids, credential echo, malformed-request 500s, freshness re-hashing. Record and unresolved risks:
`docs/security-review.md`. Checks: unit 112/112, walk-through 21/21, ui-review 23/23. AI screens not rerun.
Release ZIP and PDF not rebuilt.
