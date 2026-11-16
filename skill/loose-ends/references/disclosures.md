# Disclosures

## What is in this package

Only Markdown: `SKILL.md` and the files under `references/`. It contains no third-party code, scripts, executables, manifests, binaries, credentials, personal data, or sample client files.

## Third-party components

**Skill package:** none.

**Local companion prototype** (separate from this package, used for development and demonstration on a laptop; not submitted in this ZIP and not runnable inside a Skill):

| Component | Source | License | Use |
|---|---|---|---|
| React, React DOM | https://react.dev | MIT | Companion user interface |
| Vite, @vitejs/plugin-react | https://vite.dev | MIT | Development server and build |
| TypeScript | https://www.typescriptlang.org | Apache-2.0 | Language and type checking |
| tsx | https://github.com/privatenumber/tsx | MIT | Running TypeScript on Node.js |
| Vitest | https://vitest.dev | MIT | Tests |
| concurrently | https://github.com/open-cli-tools/concurrently | MIT | Running two development processes |
| playwright-core | https://playwright.dev | Apache-2.0 | Browser walk-through test of the companion (development only) |
| Ollama (optional) | https://ollama.com | MIT | Runs an optional language model on the developer's computer for the companion |
| uliya-skill-kit 0.7.7 | https://ai.ugreen.com/pages/hackathon-starter-kit | UGREEN official tool | Capability catalog and static checker used during authoring; not redistributed |
| Node.js | https://nodejs.org | MIT | Local runtime |
| ReportLab | https://www.reportlab.com/opensource | BSD | Generating the proposal PDF |

## External services and data flows

None. The Skill uses only files the user names on the NAS and sends nothing outside it. The companion prototype runs on loopback with synthetic demo files; it calls no external service. Commitments are read from the brief by fixed rules that the user can correct. Optionally, a language model running on the same computer (through Ollama, loopback only) suggests further commitments; a suggestion is kept only when it quotes the brief word for word, and the model never decides a check result.

## Newly developed for this hackathon

- This Skill: the Choose - Check - Fix workflow, the delivery-boundary ("What your client gets") check, approval-to-version matching rules, source-authority rules, and the output contract.
- The local companion prototype and its synthetic "Acme Brand Launch" demo files.

Nothing here reuses a previously developed Skill or earlier submission material.

## AI tools used

Claude Code (Anthropic) was used to draft and edit this Skill's text, write the companion prototype's code and tests, and prepare the proposal document, under the entrant's direction and review.

## Development status

- The Skill is written against the public capability catalog (structure version 2.2.0) in the official creation tool, uliya-skill-kit 0.7.7. It names three catalog CLIs and their registered experts (`file-agent`, `document-agent`, `photo-agent`), and delegates up to six read-only tasks.
- It passes that tool's bundled static check: `static-pass`, 0 errors, 0 warnings. A static pass does not prove upload, installation, compatibility, or device behaviour.
- It has not been run on a UGREEN NAS. No delegation in it has been executed. The catalog itself marks every Action's stability, permissions, and error codes as unknown.
- Not confirmed: whether the experts relay full text content, SHA-256 values, or image pixel sizes in their delegation results. No catalog Action parses SVG; SVG pixel size is not checked natively. Where it does not, the Skill reports `unable-to-inspect`.
- The local companion prototype works end to end on synthetic files on a laptop (automated tests and a browser walk-through). That is a local demonstration only, not evidence of NAS behaviour.
