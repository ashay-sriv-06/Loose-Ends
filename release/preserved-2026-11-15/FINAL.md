# Loose Ends — final Round 1 materials

Nothing has been submitted, uploaded, emailed, published or committed. Submit by hand at ugreenhackathon.devpost.com before November 15, 2026, 11:45 pm Pacific (per the Official Rules; confirm on the portal).

## Files to submit

| File | Path | Size |
|---|---|---|
| Proposal PDF | `release/loose-ends-proposal.pdf` | 8709 bytes, 3 pages |
| Initial Skill Package | `release/loose-ends-skill.zip` | 9153 bytes compressed, 20,555 uncompressed, 4 files |

Earlier checkpoint kept intact in `release/checkpoint-1/`.

## Validation results

- Proposal: ten answers, **470 English words** (limit 500, counted by `scripts/make_proposal.py` over answer text only); disclosures outside the count; under 1 MB; all three pages rendered and inspected — no clipping.
- Skill ZIP: `release/skill-validation.txt` — **PASS on local format checks**: `name: loose-ends`, description 582 characters, single `loose-ends/` root with `SKILL.md` + three `references/*.md`, every reference linked, Markdown only, no scripts/manifests/binaries, no credential-like strings, no placeholder text, `unzip -t` clean, all size and count limits.
- **Not checked:** the official UGOS Skill Creation Tool check. Nothing has run on a UGREEN NAS.

## Before you submit (yours to do)

1. Fill in the entrant name / signature / date block on page 3 of the PDF (left blank on purpose), and add a team consent declaration if you are entering as a team.
2. Confirm the track shown on the PDF (“Unleash Your Creativity”) is the one you want; it is set in `scripts/make_proposal.py`.
3. Recommended: install the official creation tool and run its “Help me check this skill”. It has not been downloaded here.

## What works (local companion, synthetic files, laptop)

Choose → review promises → check → evidence (“Show me”) → “What your client gets” graph and table → demo fix → recheck with a real diff → receipt (HTML / JSON) → history after reload. 87 of 87 automated tests and 21 of 21 browser steps pass. See `docs/verification-report.md`.

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

1. Before the testing day: read the creation tool’s capability list, bind each of the ten workflow steps in `SKILL.md` to real command names, run the tool’s check until clean.
2. On the NAS: upload the synthetic Acme project (`fixtures/acme`). Trigger with “Can I send this?”.
3. Core test 1: the missing dark logo is reported as not found in the delivery, and found in the working folder.
4. Core test 2: `Delivery/logo.svg` → `../Working/grain.png` is reported as outside the delivery.
5. Edge case: `fixtures/edge/conflicting-amendment` — the Skill asks which document to follow instead of guessing.
6. Record what the capabilities actually return (file listing depth, SVG text, PDF text, any dimensions or hashes) and tighten the Skill’s claims to match.
7. Record the under-three-minute video on the NAS; back up logs before the day ends.
