# Evaluation on a small challenge set

**Scope of these numbers.** 17 synthetic project folders (9 in a first batch, 8 held out), 37 promise lines,
13 transformation checks, one local model (`qwen3.5:4b` through Ollama). This is performance on this set only.
It is not an estimate of accuracy on real client projects, and no single "accuracy" figure is given.

Run on 2026-11-15. Reproduce with:

```
npx tsx eval/run.mts                      # first batch: validators, fixed rules, transformations
npx tsx eval/run.mts --heldout            # held-out batch
LOOSE_ENDS_MODEL=qwen3.5:4b npx tsx eval/run.mts --ai [--heldout]   # adds live model extraction
```

Raw results: `docs/eval/results-*.json`. Cases are generated into an OS temp folder by `eval/cases.ts`.

## How it was kept honest

- **Answer keys were written before the application was run on the cases.** `eval/expected/answer-key.json`
  (sha256 `cf7a88b3…221dc0`) and `answer-key-heldout.json` (`8c634654…c3133c`); both hashes are in
  `eval/expected/answer-key.sha256` and neither file has been edited since.
- **Keys are outside scan scope**: they live in the repository; the cases are generated elsewhere.
- **First-run results are reported as observed**, next to the results after fixes.
- **Limits of independence.** The same author wrote the cases, the keys and the fixes. The first batch's
  "after fixes" numbers are a regression check, not evidence. The held-out batch was written after those fixes
  and is the fairer test, but two of its failures were then also fixed, so nothing here is untouched test data.

## Cases

| First batch | Held-out batch |
| --- | --- |
| c1 complete brand kit (Unicode names, spaces, duplicate basename in a working folder) | h1 three files promised in one prose sentence |
| c2 missing required variant (`.txt` brief, duplicate basename inside the delivery) | h2 one of three files in a sentence is missing |
| c3 SVG referencing an omitted asset (prose email brief, URL-encoded path) | h3 Markdown image pointing outside the delivery (Japanese folder names) |
| c4 misleading image filename (`Story_1080x1920.png` is 1080×1350) | h4 wrong-size image with an unrelated name |
| c5 explicitly approved older version (German names, hash-based sign-off) | h5 sign-off by version number; one vague "looks good" |
| c6 conflicting scope documents | h6 conflict about quantity, no file names |
| c7 unsupported required source format (`.indd`), c7b unreadable brief (`.pages`) | h7 truncated required PNG plus `.psd` |
| c8 optional deliverables that must not block | h8 optional items stated in prose |

## 1. File validators (given the key's promises, so extraction is not involved)

Positive = a required promise the key says has a problem. Negative controls = required promises the key says are met,
and files whose references the key says are fine.

| Check type | Batch | First run | After fixes |
| --- | --- | --- | --- |
| File is included | first | 1 TP, 6 TN, **4 FP**, 0 FN | 1 TP, 10 TN, 0 FP, 0 FN |
| | held-out | 0 TP, 3 TN, 0 FP, **1 FN** | 1 TP, 3 TN, 0 FP, 0 FN |
| Image pixel size | first | 2 TP, 3 TN, **1 wrong kind** | 3 TP, 3 TN |
| | held-out | 2 TP, 1 TN | unchanged |
| References stay inside the delivery | first | 1 TP, 3 TN | unchanged |
| | held-out | 1 TP, 1 TN | unchanged |
| Approved version | first | 1 TP, 1 TN | unchanged |
| | held-out | 2 TP, 0 TN | unchanged |
| Left for human review (h6) | held-out | 2 of 2 stayed unresolved | unchanged |

What the failures were:

- **4 false positives, file included.** (a) `lumière-logo-inverse.svg` written without backticks was cut at the `è`
  and reported missing. (b) Two identically named files in `print/` and `web/` were reported as ambiguous although
  the promise was only that the file is included. (c) "the emblem as a vector file (SVG)" looked for a file whose
  name contained "agreed", "ll", "get", "vector".
- **1 wrong kind, pixel size.** "Instagram story graphic, 1080×1920" did not match `Story_1080x1920.png`, so the
  image was called missing rather than measured (it is 1080×1350).
- **1 false negative, file included (held-out).** A sentence naming three files checked only the first. With
  `icon-64.png` absent the result was **"Ready on checked items"**. This was the most serious validator defect found.

## 2. Extraction by fixed rules

| | First batch (23 promise lines) | Held-out (14) |
| --- | --- | --- |
| Missed, first run | **7** (all of c3 and c4, two of c8) | **3** (h1, h3, one of h8) |
| Missed, after fixes | 0 | 0 |
| Invented | 0 | 0 |
| Optional/required confusion | 0 | 0 |
| Citations pointing at the exact line | all | all |
| Ambiguous lines ("keep the files ready for our printer", "we might want a QR code version later") | not extracted | – |

The misses were prose promises ("you'll get…", "comes as…"), list items with no verb, and plain label lines
("Must have:", "Nice to have:") not treated as headings.

## 3. Extraction by the model (live calls, reported separately)

"Model alone" is what the model proposed after the verbatim-quote gate, without the fixed rules.
This track was first run after the fixes in section 5, so there is no before/after for it.

| | First batch (23 lines) | Held-out (14) |
| --- | --- | --- |
| Missed commitments | 0 | 0 |
| Invented commitments | **1**: "Timeline: first drafts Friday." (a schedule, not a deliverable) | 0 |
| Optional/required confusion, model alone | **1**: teaser under "Nice to have:" proposed as required | **1**: "If budget allows…" proposed as conditional, key says optional |
| Same, in AI-assisted mode (model + rule guards) | 0 | 0 |
| Citations valid | all | all |
| Proposals rejected as not in the brief | 0 | 0 |
| Ambiguity | printer line proposed as required and left for human review; QR line not proposed | – |
| Latency per brief | 4–31 s | 3–16 s |

**Variability.** Five cases (c3, c4, c8, h6, h8) were each run three times. The proposals were identical every time,
including the errors: the invented schedule line and both confusions appeared in 3 of 3 runs. On this set the model's
mistakes were systematic, not random, so repeating a call would not have exposed them.

On the paraphrased brief (t3: "Don't forget the single-colour one, wordmark_mono.svg.") the model found all three
promises; the fixed rules found it only after the fix.

## 4. Readiness, end to end

| Track | First batch | Held-out |
| --- | --- | --- |
| Validators with the key's promises, first run | 7 of 9 | 7 of 8 |
| Fixed-rules extraction, first run | 6 of 9 | 6 of 8 |
| Fixed-rules extraction, after fixes | 9 of 9 | 8 of 8 |
| AI-assisted extraction, after fixes (one run) | 9 of 9 | 8 of 8 |
| c6 with each authority decision | 2 of 2 | – |

**False readiness on first run: three cases.** c4 (no promises were read, built-in checks passed, shown as Ready
although the story image is the wrong size), c7b (brief was an unreadable binary, shown as Ready), h2 (above).
One further wrong result was over-cautious (c1 shown as "Fix before sending").

## 5. Transformations and invariants

10 of 13 held on first run; 13 of 13 after fixes.

| Transformation | Result |
| --- | --- |
| Rename files and update references (c3) | findings unchanged; renamed SVG still fails |
| Reorder the brief (c1) | same extracted set and readiness |
| Paraphrase a requirement (c2) | **first run: promise lost**; held after fix |
| Add unrelated files (c2) | findings unchanged |
| Move dependency inside the delivery (c3) | **first run: stayed "Fix"** because of the unrelated false positives; Ready after fix |
| Move dependency outside (c3) | the second SVG now fails too |
| Change a verified image (c4) | verified → failed; earlier run reported out of date; other image unaffected |
| Add the missing file (c2) | **first run: "Needs your review"** from the duplicate-name false positive; Ready after fix |
| Interrupt a run (c1) | cancelled, "Could not complete check" |
| Symlink in delivery / brief removed / zero promises | never Ready |
| Recheck with an unticked promise (c8) | same promise ids and ticks; unticked item not checked; no new findings |

## 6. Fixes made (answer keys untouched)

1. A sentence naming several files now checks every one (`exactNames`). *False readiness.*
2. With no promises read from a brief, the result is "Could not complete check"; built-in checks alone can no longer
   produce Ready. Binary briefs are detected and reported. *False readiness.* This changes an earlier behaviour:
   "no brief" used to show "Needs your review"; three existing test assertions were updated to match.
3. File names and name matching handle letters in any script, in either Unicode normal form.
4. Several files with exactly the promised name satisfy "is included".
5. When no file name fully matches, the single closest file of the right type is measured. A wrong size fails;
   a right size, or a mere presence match, is "needs review", never verified.
6. Extraction: plain label headings, verbless list items that name a file, format or size, sentences naming a file,
   prose promise phrases, "if budget allows / would be welcome" as optional.

Seven regression tests were added (`tests/eval-regressions.test.ts`); two model tests were rewritten because their
premise (rules miss a sentence that names a file) is no longer true. 107 tests pass; 21 of 21 browser steps pass.

## 7. Not fixed, and known weaknesses

- The model still proposes the schedule line as a promise. It becomes a manual item the person can untick; it can
  turn a Ready result into "Needs your review" but cannot produce Ready.
- Fix 6 makes the fixed rules more willing to propose promises. No invented promises appeared on this set, but the
  set has few distractor lines that name files; over-extraction on real briefs is untested.
- Fix 5's "closest file" is a name heuristic. It can pick the wrong file; that is why it never verifies.
- One model, one prompt, deterministic output: variability across models or settings is unmeasured.
- Approved-version has only one negative control; PDF/DOCX briefs, large folders and the native NAS path are not in
  this set at all.
