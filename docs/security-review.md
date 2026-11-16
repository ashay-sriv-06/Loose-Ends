# Reliability and security pass — 2026-11-15

Scope: the existing local app (backend on 127.0.0.1, browser UI, demo tooling). No authentication, cloud service
or new infrastructure was added. Nothing here was run on a NAS.

## How it was checked

`scripts/security-probe.mts` starts the real backend in-process with fresh demo fixtures and a hostile "real"
folder (symlinks pointing outside, SVG/HTML with scripts and remote images, a brief full of instructions, crafted
oversized and pathological files), a beacon server that records any fetch, and a headless browser.
Run records: `docs/security/probe-before-fixes.md` (17 of 33) and `docs/security/probe-after-fixes.md` (33 of 33).
Five of the 16 first-run failures were mistakes in the probe or knock-on failures from the stalled service, not
product defects; they were corrected in the probe, never by loosening what the product must do.

After the fixes: unit tests 112/112, typecheck clean, walk-through `scripts/e2e.mts` 21/21 (select folder → brief →
promises → check → evidence → fix → recheck → receipt → reload), `scripts/ui-review.mts` 23/23.
Not rerun: `scripts/ai-ui.mts` (needs the local model instance, which was not running).

## Verified as already holding

| Point | Evidence |
|---|---|
| Backend enforces allowed folders without the UI | 17 escape strings × 7 entry points (tree, file, extract, run; brief, approval and delivery paths): none returned outside content; forged root ids refused |
| Symlinks, traversal, encoded paths | Linked file, linked folder, file swapped for a symlink after selection: all refused; picker does not list symlinks; a delivery containing them is never "Ready" |
| Remote URLs are not fetched | 5 remote references in scanned files recorded as "cannot tell"; beacon received 0 requests during scan, receipt and freshness |
| Documents cannot change permissions or policy | Hostile brief: allowed folders unchanged, boundary check still on, verdict "Fix before sending". A forged browser request (authority, adapter kind, readiness, "verified") is ignored by the server |
| SVG / HTML previews | Opened directly and embedded: no script ran, no request left the page (sandbox policy on the preview route); receipt escapes hostile filenames |
| Cancellation | Cancelled run A and new run B keep separate ids and results; A reads "Could not complete check" |
| Historical receipts | Receipt bytes identical after files changed; the store refuses to overwrite a run |
| Demo fix / reset on user folders | Refused for every finding of a real folder, including when the folder carries the fixture marker; reset touched only the two demo folders |
| A new timestamp is not approval | Touching the unapproved file left its finding "failed"; identity is content hash |
| Changed brief / boundary | Edited brief → every result stale and earlier confirmed promises not restored; different delivery folder → everything stale; edited approval note → approval result stale |
| Files changing during a check | Existing tests: one retry, then affected results become "needs review" with a recorded gap |

## Defects found and fixed

1. **A crafted Markdown file froze the whole service for about two minutes** (unbounded pattern in the reference
   scanner; one thread serves everything). Patterns bounded; SVG tag scan made linear; an out-of-range character
   reference no longer throws. Ten crafted files now finish in about 7 s.
2. **A demo fix could write outside the demo folder through a planted symlink**, and copy outside content in.
   Demo operations now resolve real paths and refuse symlinks.
3. **A brief over 2 MB was cut off silently.** Now a visible notice when reading, and a recorded gap in the run
   (so it cannot be "Ready"). Delivered SVG/Markdown over the limit is "could not inspect" instead of half-parsed.
4. **A check that failed to start left the earlier verdict on screen with no label**, and in the compact view the
   error was not shown at all. Now a red banner states the check did not run and the result below is marked as the
   earlier one. Same when a started check's result cannot be loaded.
5. **Real-folder ids were positional (`local-1`)**, so after restarting with a different folder list, earlier runs,
   freshness and remembered promises attached to the wrong folder. Ids are now derived from the folder's real path.
6. **A password placed in `LOOSE_ENDS_MODEL_URL` was echoed in API responses.** Such addresses are refused at start.
7. **Malformed requests caused 500s** (non-list paths, bad percent-encoding), and an oversized upload left the
   connection unusable for the next request. Now 400 / 413 with the connection closed.
8. **Freshness polling re-read and re-hashed every file every few seconds.** Unchanged files (same size and
   modified time) reuse the recorded fingerprint; an actual check always hashes from scratch.
9. Found by reading, not by a failing run: an added file matching a *later* name in a multi-file promise, or only
   loosely matching a promise, did not mark the "missing" finding out of date. It does now.
10. Smaller: content security policy on the app page; `Cross-Origin-Resource-Policy: same-origin` on all responses
    (another website could previously embed a local image preview and learn its dimensions); `.env` added to
    `.gitignore`; finished runs' progress buffers are released; non-instruction reading notices were displayed as
    "Ignored …:undefined".

## Unresolved risks

| Trigger | Consequence |
|---|---|
| The existing release ZIP and proposal PDF are submitted as they are | They contain the code from before this pass (items 1–10 unfixed) and the PDF's test count is out of date. They were not rebuilt. |
| Another program on the same computer sends requests to 127.0.0.1:4177 | It can list file names, load image previews, read promises extracted from briefs inside the allowed folders, start checks and apply demo fixes to the demo folders. It cannot reach outside the allowed folders. There is no login by design. |
| A local process with write access swaps a file for a symlink in the instant between the path check and the read | That one read could return content from outside the allowed folder. Requires an attacker already able to write into the folder. |
| A file is edited so that size and modified time both end up unchanged | The "out of date" banner does not appear until the next real check; the check itself hashes content and is correct. The during-check change detection uses the same two signals. |
| Many large crafted text files in one delivery (each under 2 MB) | The service is single-threaded: a check of ten such files took about 7 s, during which other requests wait. Cancel takes effect only between steps. |
| A brief contains instruction-like wording the pattern list does not recognise | No notice is shown for that line. It has no effect on fixed-rule checks. In AI-assisted mode it could influence which promises the model proposes or omits; that was not retested in this pass. |
| Opening a run made before this pass under a real folder (`local-1` ids) | The saved result and receipt open, but it cannot be compared with the folder's current state; it stays labelled as an earlier check. |
| Someone reads `.data/` on this computer | Stored runs contain file names and brief excerpts in plain text. The model call log was checked only for the test credential, not audited line by line. |
| Saving a finished run fails (disk full, permissions) | The check ends without a stored result; the UI now reports that the result could not be loaded, but no failed-run record is written. |
