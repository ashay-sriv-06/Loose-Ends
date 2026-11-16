# Loose Ends — “Can I send this?”

Loose Ends checks your project folder against the brief and catches missing files, broken references, and version mix-ups before you send it.

This repository holds two separate things:

| | What it is | Where |
|---|---|---|
| **Native Skill** | A Markdown-only UGREEN AI NAS Skill (`SKILL.md` + `references/`). This is the hackathon submission. Not yet run on a NAS. | `skill/loose-ends/`, packaged to `release/` |
| **Local companion** | A React + TypeScript app with a small local backend that demonstrates the same checks on a laptop with deterministic validators. It cannot run inside a Skill and is not part of the Skill ZIP. | `src/`, `web/`, `tests/` |

## Run the local demo

```bash
npm install
npm start            # builds the UI and serves everything on http://127.0.0.1:4177 (loopback only)
```

The demo opens on the synthetic “Acme Brand Launch” project. Press **Check before sending**.

- Reset the demo files: `npm run fixture:reset` (or “Restore demo files” in the app). Only `fixtures/acme` and `fixtures/edge` are ever touched.
- Check your own folder (read-only): `LOOSE_ENDS_ROOTS="Client work=/absolute/path" npm start`. The browser can only browse folders listed there.
- Development mode with hot reload: `npm run dev` (UI on http://127.0.0.1:5177).

## Verify

```bash
npm test                     # 101 automated tests
LOOSE_ENDS_MODEL=qwen3.5:4b npm start   # optional: local Ollama model suggests promises (verbatim quotes only)
npm run typecheck
npm start &  npx tsx scripts/e2e.mts   # 21-step browser walk-through with screenshots (needs a cached Playwright Chromium)
```

## Rebuild the submission files

```bash
npx tsx scripts/package-skill.ts release    # release/loose-ends-skill.zip + validation report
python3 scripts/make_proposal.py release    # release/loose-ends-proposal.pdf (needs reportlab)
```

## Documents

- `docs/product-contract.md` — user, scope, copy, non-goals
- `docs/platform-capabilities.md` — what is documented for the NAS, and what is still unknown
- `docs/verification-report.md` — claim-to-test matrix and limitations
- `docs/demo-script.md` — 90-second demo
- `docs/build-log.md` — what was built, checks run, blockers
- `release/FINAL.md` — final artifact paths and validation results

## Honest status

Works locally on synthetic files. Nothing here has been run on a UGREEN NAS. The Skill names catalog CLIs and experts from the official creation tool (in `vendor/`, not redistributed) and passes its static check; no delegation has been executed. The companion reads promises by fixed rules; an optional local model (AI-assisted mode) proposes promises, conflicts, candidate files and plain-language explanations under fixed guards — see `docs/model-integration.md`. See `docs/audit-2026-11-15.md`.
