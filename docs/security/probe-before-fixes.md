# Security and reliability probe (before-fixes)

17 of 33 passed.

## scope

- PASS — backend refuses every escaping path on tree, file, extract and run (no UI involved) — 17 escape strings × 7 entry points
- PASS — unknown, missing or malformed root ids are refused
- **FAIL** — malformed request bodies get a 4xx, never a 5xx or a crash — /api/extract briefPaths as string → 500 (body.briefPaths ?? []).map is not a function | /api/runs briefPaths as string → 500 (body.briefPaths ?? []).map is not a function | /api/extract approvalPaths as object → 500 approvalPaths.map is not a function or its return value is not iterable | /api/runs approvalPaths as object → 500 (body.approvalPaths ?? []).map is not a function | /api/extract null b
- **FAIL** — static file route cannot leave dist/ (dot segments, encoded and double-encoded) — /%E0%A4%A → 500

## symlinks

- PASS — a symlinked brief, file or folder pointing outside is never read — extract 400, file 404, tree 400, nested 404, run 400
- PASS — the picker does not offer symlinks, and a scan with symlinks in the delivery is not Ready — Fix before sending; 2 symlink gaps
- PASS — a file swapped for a symlink after it was chosen is refused at read time — status 400

## remote

- PASS — scanning files that reference remote URLs fetches nothing — 5 remote references recorded as "cannot tell", 0 requests made

## instructions

- **FAIL** — instruction-like text in a brief changes neither permissions nor results — the missing file was not reported
- PASS — the browser cannot switch off verification policy by editing the request — forged → Fix before sending; all unticked → Could not complete check

## limits

- PASS — oversized request bodies are refused
- **FAIL** — a brief larger than the read limit is reported as partly read, not silently truncated — fetch failed
- **FAIL** — pathological text does not stall the parsers — start 413: {"error":"Request too large."}
- **FAIL** — very deep folders and very many files end in an honest incomplete result — fetch failed
- PASS — previews refuse large files and non-images

## credentials

- **FAIL** — a credential placed in the model URL never reaches responses, logs or receipts — the credential appears in an API response
- **FAIL** — no secret-looking strings in the built frontend, stored runs, logs or ignore rules gaps — scripts/security-probe.mts: sk-probe-FAK…

## runs

- PASS — cancel then restart: results never mix, and a cancelled run is never Ready — A cancelled with 8 partial results; B completed with 8
- PASS — a stored run cannot be overwritten, and its receipt does not change when files change — receipt byte-identical after files changed; overwrite refused

## demo

- **FAIL** — demo fix and reset cannot touch a user-selected folder — fetch failed
- **FAIL** — a demo fix cannot write outside the demo folder through a planted symlink or a forged operation — copy through a planted symlink wrote outside the demo folder | copy from a symlinked source was not refused

## identity

- PASS — a newer timestamp is not approval; touching files does not make results stale either — approval finding stays "failed"; content unchanged so the earlier result stays current
- PASS — editing the approval note invalidates the approval result — 1 result(s) marked out of date
- PASS — editing the brief invalidates every result and blocks restoring the earlier confirmed promises
- **FAIL** — an added file invalidates the matching "missing" finding — including the later names of a multi-file promise and near-name matches — fetch failed
- PASS — a different delivery folder, or a different set of promises, invalidates everything
- **FAIL** — runs from one real folder are not attributed to another folder that later gets the same root id — root ids are positional (local-1, local-2…): after restarting with a different folder list, earlier runs, freshness checks and confirmed promises attach to the wrong folder
- **FAIL** — freshness polling does not re-hash unchanged files every time — no hash counter exported: every 6-second freshness poll re-reads and re-hashes every file in the allowed folder (up to 5,000 files of up to 256 MB each)

## browser

- **FAIL** — hostile SVG and HTML-as-SVG previews run no script and load nothing, in the app and opened directly — page.setContent: InvalidStateError: Failed to execute 'open' on 'Document': Only HTML documents support open().
- PASS — the full path in the app with hostile files: findings, evidence, client view and receipt make no outside request — 9 findings rendered from hostile input; 0 outside requests
- **FAIL** — the app page itself is served with a content security policy — CSP: none
- **FAIL** — a check that fails to start does not leave an earlier green result on screen as current — the failure is not shown anywhere on screen (verdict still reads “Fix before sending”)
- PASS — a check whose result never arrives does not fall back to the earlier result as current
