# Model-backed brief reading in the local companion

Status: **implemented and exercised with a live local model.** Deterministic file verification is unchanged.

## Provider choice

| Option looked at | Finding | Used |
|---|---|---|
| Native NAS assistant (the host that runs the Skill) | Does its own language work on the device (see `docs/native-workflow.md`). Not reachable from a laptop. | No |
| Hosted API key in this project or shell | None configured (`ANTHROPIC_API_KEY` unset; no `.env` in the project). I did not look elsewhere for keys, and a chat subscription is not API access. | No |
| **Ollama on this computer** | Installed, running on `127.0.0.1:11434`, model `qwen3.5:4b` present. No account, no key. | **Yes** |

Because the chosen provider has no credential, nothing secret exists to leak. The model address must be loopback (`modelConfigFromEnv` rejects anything else), calls are made only by the backend, and the browser never talks to the model.

Enable: `LOOSE_ENDS_MODEL=qwen3.5:4b npm start` (optional `LOOSE_ENDS_MODEL_URL`, `LOOSE_ENDS_MODEL_TIMEOUT_MS`).

## What the model does, and the guard on each job

| Job | Code (`src/engine/model.ts`) | Guard applied by fixed code |
|---|---|---|
| Extract explicit commitments | `askModel` → `acceptProposals` | Quote must exist in the brief. Line number is read from the brief, not from the model. What gets checked is derived from the quoted sentence by the existing fixed rules. |
| Optional / conditional | same | Accepted only when the sentence itself carries an optional or conditional cue; otherwise the promise stays **required**. A model cannot quietly make a promise non-blocking. |
| Cite exact passages | same | Source path and line stored on every promise; fabricated quotes are dropped and counted. |
| Name the deliverable | same (`deliverable`) | Every word must be in the quoted line. |
| Identify conflicting scope | `askConflicts` | May only point at two promises that exist. Shown as a suggestion. The binding conflict state still comes from `resolveAuthority` and the user's decision. |
| Propose candidate file matches | `askAssist` (candidate-files call) | Path must be in the run's file listing. Shown as “possibly the same deliverable… look at it yourself”. The finding stays `not-found-in-scope`. |
| Explain findings in plain language | `askAssist` (explain call) | Text with a number not present in the finding, or with a verdict word (“is fine”, “ready to send”, “approved”…), is dropped. Displayed beside the checker's own text, never instead of it. Stored runs are not modified. |

The model never receives file contents other than the chosen brief, and never sets dimensions, existence, dependency results, approval or readiness.

## Output validation and failures

Every reply is constrained by a JSON schema (passed to Ollama as `format`) and validated again locally (`validate`). Failures are typed, each with a user action: `not-configured`, `unavailable`, `model-missing`, `timeout`, `rate-limited`, `refused`, `malformed`, `oversized`, `http-error`. Long briefs are read in up to 6 chunks of about 12,000 characters with real line numbers; beyond that the call is refused as `oversized` rather than truncated.

**No silent fallback.** The user chooses one of three labelled modes: *AI-assisted*, *Fixed rules*, *By hand*. If AI-assisted reading fails, the API returns the error, the screen says no promises were taken from the brief, the check button is disabled, and the user picks *Try again*, *Use fixed rules instead* or *Enter promises by hand*. With no model set up, choosing AI-assisted shows the exact setup steps (`docs/screenshots/22-ai-setup-screen.png`).

## Review, confirmation, persistence

Promises are labelled *AI-suggested · quoted from brief*, *Fixed rules* or *Added by you*, each with file and line, and can be unticked, answered (conditions) or added to. Starting a check confirms the set: it is saved in `.data/confirmed/` with the SHA-256 of each brief, the mode and the model name. Reopening the same brief restores the choices if the brief is byte-identical, and says so if it changed. The run itself records `extractionMode` and `extractionModel`. A check started in AI-assisted mode uses exactly the reviewed set; the model is not called again.

## Live demonstration (real calls, 2026-11-15)

Input: a newly written synthetic brief, `docs/live-model-demo/kickoff-email.md` plus `follow-up.md` (polite paraphrases, one condition, one optional extra, a size changed in the follow-up), and a small synthetic folder. Output: `docs/live-model-demo/run-output.txt`. Provider/model: Ollama, `qwen3.5:4b`.

| Measure | Result |
|---|---|
| Fixed rules alone | 2 promises |
| AI-assisted | 7 promises: 5 added by the model, 2 found by both, 0 discarded |
| Refinements to rule-found promises | 2 (deliverable named “hero poster”, “invitation card”; one reclassified required → conditional because the sentence starts “Should the tasting event go ahead…”) |
| Optional item | “If you end up with spare time, an animated version…” → optional |
| Conflict | Model flagged the 1080 vs 1200 tile; the deterministic authority check independently raised the same question |
| Extraction latency | 17.6 s for two documents plus the conflict pass (first call after load: 23 s) |
| Check result | `Fix before sending`, produced by the validators (3 files not found by name, 1 reference to a missing image, 2 scope conflicts, 2 items for human review) |
| Plain-language help | 8 explanations kept, 0 discarded; 2 candidate files proposed (`Send/northwind-hero-A2-print.pdf`, `Send/poster-art.svg`); run record identical before and after |
| Help latency | 16.8 s (two calls) |

Errors and corrections seen during the live runs, recorded as they happened:
- First reading: the model missed the optional animated-tile line and called “It would really help to get the poster artwork as an SVG” optional. The prompt now asks for optional extras explicitly, and the cue guard keeps that SVG line required.
- First two help runs returned no candidate files although a plausible one existed. Asking for candidates in a separate call fixed it in the third run.
- One request failed at the HTTP client while the server was still starting; no model error occurred in any logged call.

Call log (`.data/model-calls.jsonl`, git-ignored; excerpt in `docs/live-model-demo/model-calls-excerpt.jsonl`): provider, model, purpose, outcome, milliseconds. No brief text, no file names.

## Tests

- `tests/model.test.ts`: 14 tests with a stubbed model — verbatim gate, instruction lines, line numbers from the brief, optional/conditional guard, every failure code, no fallback, log contents, conflict and assist guards, end-to-end with the real validators.
- `scripts/ai-ui.mts` (browser, real model): 6 of 6 — setup screen, check blocked, by-hand mode, labelled AI promises, conflict suggestion, plain-language panel with unchanged status. Report: `docs/ai-ui-report.md`.
- Whole suite: 101 of 101. Main walk-through (no model): 21 of 21.

## Limits

- One small local model, one new brief plus the earlier probes. This shows the integration works; it is not an accuracy measurement. Recall and labels will vary by model and wording.
- The model's refusal, timeout, rate-limit and malformed paths are covered by stubbed tests, not provoked live.
- The verdict-word and number guards on explanations are lexical; a misleading sentence that avoids those words would pass. That is why explanations are shown beside, never instead of, the checker's text.
- Explanations and candidates are not written into receipts or stored runs.
- Hosted providers are not implemented; adding one would need a key kept in a backend environment variable.
