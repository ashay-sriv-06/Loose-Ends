# Native Skill: sources, steps, and what is and is not established

## Official resource

| Item | Value |
|---|---|
| Guide page | https://ai.ugreen.com/pages/hackathon-starter-kit (fetched 2026-11-15, HTTP 200) |
| Download link on that page | https://cdn.shopify.com/s/files/1/0630/9416/1602/files/uliya-skill-kit-0.7.7-en.zip?v=1794462613 |
| Retrieved | 2026-11-15 20:38 PST, 61,290 bytes |
| SHA-256 | `e3a9c6a7b80b5790865aa1eea310a942904993693a021888b5f9d580f35d8a67` |
| Package version | uliya-skill-kit 0.7.7 (files dated 2026-11-05) |
| Capability catalog | structure 2.2.0, generated 2026-11-05; 9 CLIs, 84 Actions; “checked against uclaw release_2026930 … not a verified NAS deployment” |
| Local copies | `vendor/uliya-kit/` (reference) and `.claude/skills/uliya-skill-kit/` (project-local install, as the guide instructs: place the folder in the assistant's skills directory). Both git-ignored, not redistributed. |

The guide names one download only. No separate “developer package” is linked from it; `developer.ugnas.com` is linked in the page footer and was not used.

**Install and run requirements, as read before running:** the kit is itself a Markdown Skill for Claude, Codex or WorkBuddy. Nothing is installed system-wide. Its only executable is `scripts/check-skill.mjs` (Node; imports only `node:crypto`, `node:fs/promises` read functions, `node:path`, `node:url`; no network, no writes). Run here with Node v25.8.0. The kit states it “does not execute NAS business, upload SkillHub, install Skills, or verify target-device runtime behavior.”

**Terms:** the guide says using the tool confirms agreement to UGREEN's User Agreement, Privacy Policy and Skill Content Safety and Publishing Guidelines. I did not accept anything on the entrant's behalf; the entrant should read them before submitting.

## Official creation workflow, as followed

Kit `SKILL.md` “Generate a Skill” steps 1–8 and the five references it requires for every create/update (`expert-orchestration`, `runtime-authoring-lessons`, `cli-usage-rules`, `safety-and-approval`, `completion-and-errors`) were read, then `skill/loose-ends/SKILL.md` was revised to that contract: goal, required input, capability evidence (CLI → single agent), expert orchestration with `delegate` only, and handling of `completed`, `failed`, `cancelled`, `waiting_user`, `waiting_approval`.

Two places where the kit's prose and its checker disagree; the checker was followed:
- The guide recommends a root `README.md`; the checker rejects it (`RESOURCE_UNSUPPORTED`: root may contain only `SKILL.md` and `references/`). Not included.
- The kit text writes evidence as `- <cli> -> <agent>`; the checker only accepts `` - `<cli>` → `<agent>` `` under the heading “Generation-time capability evidence”. That form is used.

## Does the host AI do the language work?

Yes, by the kit's own contract — no separate model key is involved in the native Skill.
- The Skill is Markdown read by the NAS main assistant; “the parent Skill may use only `delegate --target <agent-id> --instruction '<task>'`” — a natural-language task.
- “Child experts select and execute their own CLI/Action workflows” (`cli-usage-rules.md`); the parent must not pass private parameters or run `cli.invoke`.
- `ug-document qa` takes “the user's original question, passed verbatim”, returns `answer_draft` with citations, and its `content-scope full` is described as “needs model”.
- The checker rejects any credential literal in a Skill.

Not established: which model runs on the device, its quality, or its context limits. None of this was observed running.

## Native steps

“Executed” means executed on a UGREEN NAS. Every row: **No.** Permissions, prerequisites and error codes are `unknown` in the catalog for every Action; outputs shown there are synthetic.

| # | Interaction stage | Delegate target | Catalog CLI · Action (doc: `data/capability-catalog.json`) | Inputs | Expected result (catalog `returnSummary`) | Effect / approval | Error handling in the Skill | Executed |
|---|---|---|---|---|---|---|---|---|
| 0 | Select folder and brief | none (conversation) | — | user names delivery folder + brief | — | — | ask and wait if either is missing | No |
| 1 | Inspect: list delivery | `file-agent` | `ug-filesystem` · `ls` (`path`, `recursive`, `max-depth`, `limit`), `find` | delivery folder path | “Folder entries with real names, paths…”; `find` also `truncated` | read / none | missing or explicitly empty → Could not complete check; truncated → partial coverage | No |
| 2 | Inspect: list working folder | `file-agent` | same | working folder path (optional) | same | read / none | same; step is skipped if not named | No |
| 3 | Extract requirements; read approval notes | `document-agent` | `ug-document` · `qa` (`query` required, `file`, `intent`, `content-scope`) | brief path; approval note paths | “answer_draft, context_markdown and citations; report missing sources or partial reads” | read / none | partial read → partial coverage; zero commitments → stop; conflict → one question | No |
| 3b | Confirm requirements | none (conversation) | — | extracted list | user-confirmed list | — | waits for the user | No |
| 4 | Inspect: text of delivered SVG/Markdown | `file-agent` | `ug-filesystem` · file-content read Action (`path`, `offset`, `length`) | paths from step 1 | “File content plus offset and truncation information” | read / none | unreadable or cut short → `unable-to-inspect` for that file | No |
| 5 | Inspect: fingerprints | `file-agent` | `ug-filesystem` · `sha256sum` (`path`) | paths named by an approval note | “The SHA-256 digest” | read / none | value not returned → compare stated versions only, mark weaker | No |
| 6 | Inspect: raster image size | `photo-agent` | `ug-photo` · `meta` (`path`, repeatable; “non-image files are skipped”) | PNG/JPEG paths with a size requirement | “EXIF or media metadata plus failed or skipped items” (sample shows `width`, `height`) | read / none | skipped or missing → `unable-to-inspect` | No |
| 7 | Findings with limitations | none (assistant) | — | results of 1–6 | report per `references/output-contract.md` | — | status rules; never “ready” on gaps | No |
| 8 | Recheck after corrections | steps 1, 2, 4, 5, 6 again | same | same scope, confirmed requirements | resolved / still open / new | read / none | earlier results are `stale`, never reused | No |

For every delegation: `completed` → continue only with the needed facts present; `failed` → stop dependants; `cancelled` → report, no retry; `waiting_user` / `waiting_approval` → wait for the same delegation to resume.

## Product checks mapped to native capability

| Check | Companion (local, executed) | Native Skill (authored, not executed) | Native claim |
|---|---|---|---|
| Promised file missing | file listing + name match | steps 1–3 | **Supported by documented Actions.** |
| Exists in working folder, not in delivery | two listings | steps 1–2 | Supported by documented Actions. |
| Reference leaves the folder (SVG, Markdown) | own parser on file bytes | step 4: assistant reads returned text | **Narrowed.** No Action parses SVG. Depends on full text being relayed; otherwise `unable-to-inspect`. |
| Approved version vs delivered | SHA-256 computed locally | steps 3 + 5 | Supported if the checksum is relayed; otherwise stated-version comparison only. |
| Image pixel size | PNG/JPEG header bytes | step 6 | **Narrowed** to raster images for which `meta` returns width/height. SVG size not checked. Unknown for files outside the photo library. |
| Staleness between checks | file size + mtime compare, stored runs | recheck within one conversation | **Narrowed.** No stored history, no automatic change detection. |
| Receipt export, history, evidence panel, demo fixes | yes | — | **Not in the native Skill.** Companion only; the companion is not a prerequisite of the Skill. |

## Validation: official versus ours

| Check | Whose | Result | Record |
|---|---|---|---|
| `check-skill.mjs` on `skill/loose-ends` and on the unzipped release ZIP | **Official** (bundled with kit 0.7.7) | `static-pass`, 0 errors, 0 warnings, exit 0 | `release/official-check.json` |
| ZIP layout, allowlist, sizes, `unzip -t`, placeholder and credential scan | Ours (`scripts/package-skill.ts`) | PASS | `release/skill-validation.txt` |
| Proposal word count | Ours (`scripts/make_proposal.py`) | 487 of 500 | script output |

The official checker's own statement: a static pass “does not prove upload, installation, compatibility, or device execution”. The Skill uses bracketed slots in its delegate instructions for user-supplied paths; the checker does not evaluate whether the device assistant fills them correctly.

## Pending steps that need hardware (finalists only)

1. Upload `release/loose-ends-skill.zip` in the official test environment (SkillHub publish page named in the kit).
2. Put `fixtures/acme` on the NAS. Say: “Can I send this?” and name the delivery folder and brief.
3. For each of steps 1–6 record: terminal state, whether `summary`/`result` carried the needed facts (full listing, quoted sentences, full file text, checksum, width/height), and any wait for approval.
4. Confirm the three baseline findings appear; apply the fixes by hand; say “check again”; confirm the resolved / still open / new lists.
5. Run `fixtures/edge/conflicting-amendment` and confirm one targeted question is asked.
6. Tighten `SKILL.md` and `references/checks.md` to what was actually returned; rerun the official check; rebuild.
