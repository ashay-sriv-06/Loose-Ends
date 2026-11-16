# Loose Ends — final Round 1 materials

Nothing has been submitted, uploaded, emailed, published or committed. Submit by hand at ugreenhackathon.devpost.com before November 15, 2026, 11:45 pm Pacific (per the Official Rules; confirm on the portal).

## Files to submit

| File | Path | Size |
|---|---|---|
| Proposal PDF | `release/loose-ends-proposal.pdf` | 9369 bytes, 3 pages, sha256 f298acf0…d839cfc |
| Initial Skill Package | `release/loose-ends-skill.zip` | sha256 f5226283…70e64eb4b, 4 Markdown files |

Earlier checkpoint kept intact in `release/checkpoint-1/`.

## Validation results

- Proposal: ten answers, **487 English words** (limit 500, counted by `scripts/make_proposal.py` over answer text only); disclosures outside the count; under 1 MB; all three pages rendered and inspected — no clipping.
- Skill ZIP: `release/skill-validation.txt` — **PASS on local format checks**: `name: loose-ends`, description 582 characters, single `loose-ends/` root with `SKILL.md` + three `references/*.md`, every reference linked, Markdown only, no scripts/manifests/binaries, no credential-like strings, no placeholder text, `unzip -t` clean, all size and count limits.
- **Official static check** (uliya-skill-kit 0.7.7, run on the unzipped release ZIP): `static-pass`, 0 errors, 0 warnings — `release/official-check.json`. The earlier ZIP (kept in `release/preserved-2026-11-15/`) was `not-uploadable`; do not submit that one.
- Nothing has run on a UGREEN NAS; a static pass does not prove device behaviour.

## Before you submit (yours to do)

1. Fill in the entrant name / signature / date block on page 3 of the PDF (left blank on purpose), and add a team consent declaration if you are entering as a team.
2. Confirm the track shown on the PDF (“Unleash Your Creativity”) is the one you want; it is set in `scripts/make_proposal.py`.
3. Read the three UGREEN agreements linked from the starter-kit page; the guide says using the tool and taking part confirms agreement. That acceptance is yours.
4. Read `docs/native-workflow.md` (sources, per-step native record, pending hardware steps) and `docs/audit-2026-11-15.md`.

## What works (local companion, synthetic files, laptop)

Choose → review promises → check → evidence (“Show me”) → “What your client gets” graph and table → demo fix → recheck with a real diff → receipt (HTML / JSON) → history after reload. 95 of 95 automated tests and 21 of 21 browser steps pass. See `docs/verification-report.md`.

## What remains unverified

- Any behaviour on a UGREEN NAS; exact UGOS CLI command names and expert-agent names.
- Whether NAS capabilities return pixel sizes or content fingerprints (the Skill reports `unable-to-inspect` if not).
- Brief wording outside the rule-based reader’s patterns; browsers other than Chromium.

## Start / reset the local demo

```bash
cd ~/loose-ends
npm run fixture:reset     # restore the synthetic demo files
npm start                 # http://127.0.0.1:4177
```

## NAS test plan (if selected as a finalist)

1. Before the testing day: the Skill is already bound to catalog CLIs and experts; reread the six delegations against whatever newer catalog UGREEN ships.
2. On the NAS: upload the synthetic Acme project (`fixtures/acme`). Trigger with “Can I send this?”.
3. Core test 1: the missing dark logo is reported as not found in the delivery, and found in the working folder.
4. Core test 2: `Delivery/logo.svg` → `../Working/grain.png` is reported as outside the delivery.
5. Edge case: `fixtures/edge/conflicting-amendment` — the Skill asks which document to follow instead of guessing.
6. Record what the capabilities actually return (file listing depth, SVG text, PDF text, any dimensions or hashes) and tighten the Skill’s claims to match.
7. Record the under-three-minute video on the NAS; back up logs before the day ends.
