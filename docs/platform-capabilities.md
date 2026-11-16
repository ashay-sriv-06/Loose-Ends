# Platform Capabilities — evidence-backed map

Sources actually read (2026-11-15, through the user's browser):
- **[R]** Official Rules — https://ugreenhackathon.devpost.com/rules
- **[K]** Hackathon Starter Kit page — https://ai.ugreen.com/pages/hackathon-starter-kit

**Not read:** the UGOS Skill Creation Tool archive (`uliya-skill-kit-0.7.7-en.zip`, linked from [K] §3). It has not been downloaded (awaiting user permission). [K] §6 says "the capabilities included in the creation-tool archive take precedence." Therefore **exact UGOS CLI command names, expert-agent names, parameters, and return shapes are UNKNOWN** and are not written anywhere in this project.

## 1. Native Skill: what is documented

| Capability area | What is documented | Source | Execution mechanism | Limitations | Verification status |
|---|---|---|---|---|---|
| Files | "Find, browse, organize, deduplicate, and tag" | [K] §6 table | Supported UGOS CLI capabilities through registered expert agents ([R] §4 "What to Create") | Whether listings return sizes, hashes, or modification times is not stated. Loose Ends uses only find/browse (read-only). | Documented publicly; not verified on NAS. Command names unknown — kit not yet read. |
| Documents | "Read, answer questions, extract information, translate, and reconcile" | [K] §6 table | Same | Supported document formats not stated. Whether SVG/Markdown source text can be read verbatim is not stated. | Same |
| Knowledge | "Look up official documentation, transcribe recordings, and save text" | [K] §6 table | Same | Not used by Loose Ends in Round 1 (saving a text receipt is a possible later use and would need user confirmation). | Same |
| Albums | Find photos by person/location/time; create or organize albums | [K] §6 table | Same | Not used. | Same |
| Video / Music, Surveillance | Search, playback, camera events | [K] §6 table | Same | Not used. | Same |
| Chaining areas | "find files first, then read documents..." Every step must map to a real capability | [K] §6 | Skill text orchestrates steps; each uses the previous step's actual output ([K] §5) | — | Same |
| AI model | Local NAS model encouraged, not required; authorized third-party models allowed | [R] §4 | Not specified | Loose Ends plans the local model only; no external data flow. | Not verified |
| Image pixel dimensions | **Not documented** | — | — | The Skill reports dimensions only if a capability returns them; otherwise `unable-to-inspect`. | Unknown |
| Content hashes | **Not documented** | — | — | Same rule. Approval matching falls back to version identifiers stated in file names/contents, labeled as weaker. | Unknown |
| Custom scripts / runtimes / direct NAS access | **Explicitly unsupported** | [R] §4 | — | None are used by the Skill. | n/a |

### Package format (documented)
- `SKILL.md` required entry point with `name` (lowercase, hyphenated, 2–64 chars) and `description` (≤ 1,024 chars); contains user goal, required inputs, supported CLI capabilities, expert orchestration workflow, completion and failure handling. [R] §4 Round 1 Submission Requirements.
- Optional Markdown files under `references/`, each directly linked from SKILL.md. [R] §4.
- No separate manifests, scripts, executables, binaries, or other unsupported files. [R] §4 Functionality.
- ZIP ≤ 10 MB. [R] §4. (The "≤100 files, each <1 MB" limits in our build prompts are applied as conservative self-imposed checks; they were not found in [R] or [K].)
- [K] §5 shows a folder `your-skill-name/` with SKILL.md, a *recommended* README.md, and optional references/. [R] lists only SKILL.md + references; README.md is conservatively omitted.
- Behavioural requirements ([K] §5, §8): only supported capabilities; confirm before delete/move/overwrite/external sharing; no result → say so and stop; no credentials; no scripts; no TODO/placeholder text; name/description must match actual behaviour.

### Explicit unknowns
1. Exact CLI command and expert-agent names (blocked on reading the creation tool).
2. Whether the creation tool's "check" passes this package (not run).
3. Whether file listing exposes hashes, sizes, timestamps.
4. Whether document reading returns raw SVG/Markdown source (needed to see `href` values) and which formats it supports.
5. Scope/permission model for "authorized NAS files".
6. All on-NAS behaviour: nothing has been executed on a UGREEN NAS.

## 2. Local companion app (not part of the Skill)
Runs on the developer's laptop; none of this executes inside the Skill package.

| Capability | Mechanism | Status |
|---|---|---|
| UI ("Can I send this?") | React + TypeScript + Vite | See docs/build-log.md |
| Backend | Minimal Node/TypeScript HTTP server on loopback, allowlisted roots | See build log |
| File inclusion | Inventory of delivery root | See build log |
| PNG/JPEG dimensions | Parsed from file bytes | See build log |
| SVG `href`/`xlink:href`, Markdown image/link references | Parsed and resolved against the delivery boundary; nothing fetched | See build log |
| Approval-to-artifact matching | sha256 / stated version id | See build log |
| Brief extraction | Rule-based (labeled as such) plus manual add/remove; no model provider is wired in this build | See build log |
| Receipts | HTML + JSON export, local only | See build log |
| Demo data | Synthetic "Acme Brand Launch" fixture | See build log |

Adapter labels used in the app: *local actual inspection*, *synthetic fixture*, *native NAS verified* (the last is never shown — no NAS execution has occurred).
