# Loose Ends — Product Contract

**Main screen question:** "Can I send this?"

**Promise:** "Catch missing files, broken file references, and version mix-ups before you send your work."

## User
A freelance designer or small creative studio about to send a project folder to a client.

## Input
- The delivery folder (what will actually be sent).
- The brief (what was promised).
- Optional: an authorized working folder and approval records.

## Output
Specific problems to fix before sending. Each has evidence (what was promised, what was inspected, what was observed) and a next action.

## Interaction
Choose → Check → Fix.

1. Choose: "What are you sending?" and "What did you promise?"
2. Check: "Check before sending."
3. Fix: plain-English findings, each with "Show me"; the user fixes files outside the app and chooses "Check again."

## Copy
| Situation | Text |
|---|---|
| Required check failed | Fix before sending |
| No known failure, required checks unresolved | Needs your review |
| All applicable required checks pass, coverage complete | Ready on checked items |
| Execution failure | Could not complete check |
| Boundary feature | What your client gets |
| Reference outside delivery | This logo uses an image outside the folder you're sending. |

Check outcomes (kept distinct): `verified`, `failed`, `needs-review`, `not-found-in-scope`, `unable-to-inspect`, `scope-conflict`, `stale`.

## Two products, one contract
- **Native UGREEN Skill** (`skill/loose-ends/`): Markdown only (SKILL.md + references/). It instructs the NAS assistant to use supported UGOS capabilities through registered expert agents. It cannot run custom code, the companion UI, or the local validators.
- **Local companion app** (this repository): React + TypeScript + Vite UI with a minimal TypeScript backend on loopback. Runs deterministic validators on a laptop. It is a demonstration and development aid, not part of the submitted Skill ZIP.

Both express findings through the same summary contract (`skill/loose-ends/references/output-contract.md`); capability differences are documented in `docs/platform-capabilities.md`.

## Non-goals
- Generic chatbot, project-management suite, or marketing landing page.
- Modifying, moving, deleting, or sending user files.
- Proving the client's software can open a file, or that files are fully editable.
- Numeric confidence scores or readiness percentages.
- Fetching remote URLs or reading outside the authorized scope.
- Treating "latest" as "approved", or a newer brief as authoritative.

## Success criteria
- The synthetic Acme Brand Launch folder "looks ready" yet the check reports: missing dark logo variant, an SVG that references an image outside the delivery folder, and an approval that names version 6 while version 7 is delivered.
- The same findings appear after renaming the project and folders.
- No brief, zero requirements, partial scan, or unsupported required inspection never yields "Ready on checked items".
- Every finding traces to evidence from the current run.
- Round 1 deliverables exist and describe their real maturity: a proposal PDF (ten answers, at most 500 words) and an initial Skill ZIP.
