# Security and reliability probe (after-fixes)

33 of 33 passed.

## scope

- PASS — backend refuses every escaping path on tree, file, extract and run (no UI involved) — 17 escape strings × 7 entry points
- PASS — unknown, missing or malformed root ids are refused
- PASS — malformed request bodies get a 4xx, never a 5xx or a crash
- PASS — static file route cannot leave dist/ (dot segments, encoded and double-encoded)

## symlinks

- PASS — a symlinked brief, file or folder pointing outside is never read — extract 400, file 404, tree 400, nested 404, run 400
- PASS — the picker does not offer symlinks, and a scan with symlinks in the delivery is not Ready — Fix before sending; 2 symlink gaps
- PASS — a file swapped for a symlink after it was chosen is refused at read time — status 400

## remote

- PASS — scanning files that reference remote URLs fetches nothing — 5 remote references recorded as "cannot tell", 0 requests made

## instructions

- PASS — instruction-like text in a brief changes neither permissions nor results — 2 instruction lines ignored; verdict Fix before sending
- PASS — the browser cannot switch off verification policy by editing the request — forged → Fix before sending; all unticked → Could not complete check

## limits

- PASS — oversized request bodies are refused
- PASS — a brief larger than the read limit is reported as partly read, not silently truncated — 124 ms; later promise not read, and the person is told
- PASS — pathological text does not stall the parsers — 7401 ms, state completed, verdict Fix before sending
- PASS — very deep folders and very many files end in an honest incomplete result — depth > 12: Fix before sending; 5050 files: stopped at 5000 in 1173 ms, Fix before sending
- PASS — previews refuse large files and non-images

## credentials

- PASS — a credential placed in the model URL never reaches responses, logs or receipts — refused at startup: LOOSE_ENDS_MODEL_URL must be a plain loopback address (127.0.0.1, localhost or [::1]) with
- PASS — no secret-looking strings in the built frontend, stored runs, logs or ignore rules gaps — no matches; 0 .env file(s) present; .env and .data are ignored

## runs

- PASS — cancel then restart: results never mix, and a cancelled run is never Ready — A cancelled with 8 partial results; B completed with 8
- PASS — a stored run cannot be overwritten, and its receipt does not change when files change — receipt byte-identical after files changed; overwrite refused

## demo

- PASS — demo fix and reset cannot touch a user-selected folder — reset touched only: Demo, Edge
- PASS — a demo fix cannot write outside the demo folder through a planted symlink or a forged operation

## identity

- PASS — a newer timestamp is not approval; touching files does not make results stale either — approval finding stays "failed"; content unchanged so the earlier result stays current
- PASS — editing the approval note invalidates the approval result — 1 result(s) marked out of date
- PASS — editing the brief invalidates every result and blocks restoring the earlier confirmed promises
- PASS — an added file invalidates the matching "missing" finding — including the later names of a multi-file promise and near-name matches — stale after icon-64: 4; after Story_final: 5
- PASS — a different delivery folder, or a different set of promises, invalidates everything
- PASS — runs from one real folder are not attributed to another folder that later gets the same root id
- PASS — freshness polling does not re-hash unchanged files every time — unchanged files (same size and modified time) reuse the fingerprint from the run

## browser

- PASS — hostile SVG and HTML-as-SVG previews run no script and load nothing, in the app and opened directly — no beacon requests, no script execution
- PASS — the full path in the app with hostile files: findings, evidence, client view and receipt make no outside request — 9 findings rendered from hostile input; 0 outside requests
- PASS — the app page itself is served with a content security policy
- PASS — a check that fails to start does not leave an earlier green result on screen as current — earlier verdict “Fix before sending” is now labelled as an earlier result, with the error shown
- PASS — a check whose result never arrives does not fall back to the earlier result as current
