# Round 1 checkpoint 1 — 2026-11-15

Nothing here has been submitted externally.

## Artifacts
| File | Path | Size |
|---|---|---|
| Proposal PDF | `release/checkpoint-1/loose-ends-proposal.pdf` | 8548 bytes (limit 1,000,000) — 3 pages |
| Initial Skill ZIP | `release/checkpoint-1/loose-ends-skill.zip` | 9031 bytes compressed, 20,223 bytes uncompressed (limits 10,000,000 each) |
| Skill validation report | `release/checkpoint-1/skill-validation.txt` | — |

ZIP contents (4 files, each under 1,000,000 bytes; limit 100 files):
`loose-ends/SKILL.md`, `loose-ends/references/checks.md`, `loose-ends/references/output-contract.md`, `loose-ends/references/disclosures.md`

## Checks actually run
- `npx tsx scripts/package-skill.ts` → RESULT: PASS (frontmatter name/description, description 582 chars, links both directions, Markdown-only allowlist, no TODO/TBD, no credential-like strings, counts and byte limits, `unzip -t`).
- `python3 scripts/make_proposal.py` → ten answers, **461 words** (limit 500; counted by the script over the answer strings only).
- PDF rendered with `pdftoppm` and all 3 pages inspected: no clipping, legible, page breaks fall between cards/sections.

## Rebuild
```
npx tsx scripts/package-skill.ts [outdir]      # default release/checkpoint-1
python3 scripts/make_proposal.py [outdir]
```

## Unresolved gaps
1. **Official creation tool not read or run.** `uliya-skill-kit-0.7.7-en.zip` was not downloaded (needs user permission). Exact UGOS CLI / expert-agent names are unbound; the Skill names only the publicly listed capability areas. The tool's "check" has not been run. This is an *initial package*, not a validated NAS package.
2. **Entrant name / signature / date are blank** in the PDF (page 3). No team consent declaration is included; add one if entering as a team.
3. **No NAS execution of any kind.** Whether capabilities return raw SVG/Markdown text, pixel dimensions, or content hashes is unknown.
4. The "≤100 files, <1 MB per file" limits come from the build prompts, not the Official Rules text read; only the 10 MB ZIP limit is in the rules.
5. README.md (listed as "recommended" on the Starter Kit page) is deliberately omitted because the rules list only SKILL.md + references/.
6. Eligibility (age, country of residence, one project per entrant) is for the entrant to confirm.
7. The proposal says the companion prototype is "in progress"; refresh answer 8 if its state changes before final submission.
8. Track label on the PDF is "Unleash Your Creativity" — change in `scripts/make_proposal.py` if a different track is chosen.
