# Interface refinement — 2026-11-15

Scope unchanged: the same product, screens and checks. This pass changed hierarchy, wording, density, states and the
evidence drawer. Screenshots: `docs/screenshots/before/` and `docs/screenshots/after/`. Automated checks:
`docs/ui-review-checks.md` (23 of 23), produced by `scripts/ui-review.mts`.

## Before / after

| | Before | After |
| --- | --- | --- |
| What does this do? | Headline only. No sentence saying what the tool does. | Headline plus "Check your folder against the brief before it reaches your client." |
| What do I select? | "What are you sending?" / "What did you promise?" as questions, with step labels "1 · Choose", "2 · Check". | Two labelled inputs, "Folder to send" and "What you promised", each showing the chosen name, one line of help and "Change". |
| What happens next? | A separate "Nothing checked yet" card below the fold of attention. | One sentence beside the action, and three numbered steps under the card. All inside the first 900px view (ends at 678px). |
| Reading-mode control | Sat between the inputs and the action; label "AI-assisted (not set up)". | Below the action, smaller, labelled "How the brief is read". |
| Result position (1440×900) | Verdict started at about 570px; the first finding began at about 835px and was cut off by the fold. | The chooser collapses to one summary line; verdict at about 195px, first finding at 494px (measured). |
| A finding | Title, sometimes a path, next action, "Show me". No reason. Missing files showed no file at all. | Sentence, affected file (or the promised name with "not in Delivery"), why it matters, "Next" action, "Show me". |
| Evidence drawer | Six stacked sections; fingerprints and byte counts in the main flow. | "The brief says" beside "The file shows" (side by side from 440px of drawer width, stacked below), then why / next / limits. Technical details behind a disclosure. |
| States | Completed, stale, earlier-check. Cancelled, failed and partial runs looked like ordinary results. | Empty, loading (five real phases, "n of m" promises), partial (count plus list), failed, cancelled, stale, completed — each with one next action. |
| What your client gets | Static picture. | Opens from a finding with that file selected; lines draw in, the one crossing the boundary last; nodes do not move; no animation under reduced motion. |

## Defects corrected

Found by looking at real screenshots and by the interaction checks.

1. **Mobile: reading-mode labels overlapped** each other and the selected highlight (before/20, before/21).
2. **Focus was pulled back into the drawer on every re-render** (the 6-second freshness poll re-ran the focus
   effect). Focus now moves only when the drawer opens on a new finding.
3. **Closing the drawer dropped focus** to the top of the page. It now returns to the "Show me" that opened it.
4. **The first finding was cut off by the fold** after a check on a 900px-tall screen.
5. **Missing-file findings named no file** in the row and showed a "–" placeholder.
6. **Cancelled and failed runs had no explanation or next action**; partial coverage was only a count in the rail.
7. **Two Cancel buttons** appeared during loading (introduced and removed in this pass).
8. **A file name with no spaces or hyphens widened the whole page on a phone** by 374px (found with a real
   120-character name; fixed with wrapping rules).
9. **The page behind the mobile drawer scrolled** under the sheet. It is now locked while the sheet is open, and the
   drawer header with Close stays pinned while its content scrolls.
10. **"Demo files only" broke one letter per line** on a phone (introduced and fixed in this pass).
11. **The file picker disappeared on wide screens** because a new drawer backdrop reused its class name (introduced
    in this pass, caught by the existing walk-through, fixed).
12. **The "Show me" button in the dependency table was clipped** at the right edge.
13. Earlier-check rows truncated the date ("Nov 15, …"); the time now comes first.

## What was verified, and how

- **Desktop 1440×900 and mobile 390×844**, real headless-Chromium screenshots of every state listed above.
- **Keyboard**: the main action is reached in 4 Tab presses with a 2px focus ring; the drawer opens with Enter,
  closes with Escape, focus returns to its opener; tabs respond to arrow keys.
- **Drawer scrolling**: 1242px of content in a 900px drawer scrolls independently; the page behind did not move.
- **Long names**: a real folder with 100–120 character names, including one with no break points and non-ASCII
  letters. No horizontal overflow on desktop or mobile, in the list or the drawer; truncated names carry the full
  name as a tooltip.
- **Contrast**: 17 text styles measured against their real backgrounds in the running page
  (`docs/contrast-measured.json`). Lowest is 4.57:1 (the "Missing" chip); all meet WCAG AA 4.5:1.
- **Reduced motion**: animation duration measured at effectively zero.

Two states were not produced by a real event:
- **Failed** — no real failing run was available, so one server response was altered in the test browser to say
  "failed". The screenshot shows how the screen renders that state, not a real failure.
- **Loading** — the progress stream was held for 0.9 s so the state could be photographed. The run on the demo
  files otherwise finishes too quickly to see, so the captured frame shows the phase list before the first phase.

## Heuristic comprehension review

**This is not user research. No participants were involved.** It is one reviewer (the assistant that built the
interface) reading the first screen against the three questions and a short list of usability heuristics. It can
find wording and hierarchy problems; it cannot show that a real freelancer understands the screen in five seconds.

| Question | Where the answer is | Reading time (about 200 words/min) | Judgement |
| --- | --- | --- | --- |
| What does this do? | Headline + one sentence, 16 words | ~5 s | Answered. "Brief" is assumed vocabulary; a client who says "scope" or "SOW" may hesitate. |
| What do I select? | Two labels, 5 words, each with a visible current value | ~2 s | Answered. "What you promised" is less concrete than "Folder to send"; the help line "The brief or scope you agreed" carries it. |
| What happens next? | Button label, then one 27-word sentence beside it | ~8 s for the sentence | Partly. The button alone implies it; the full answer takes longer than five seconds to read. The three steps below repeat it at a glance. |

Against common heuristics:

- **Visibility of status** — good after this pass: every state names itself and shows real counts.
- **Match with the user's language** — mostly plain. Still technical in the main flow: "fingerprint" in one
  approval finding, "reference" in dependency findings.
- **Recognition over recall** — the collapsed summary keeps the folder and brief visible above the result.
- **Error prevention** — the action is disabled until a folder is chosen, with the reason beside it.
- **Minimalism** — the rail still competes with the first screen: "What's being checked" repeats the two inputs,
  and "Earlier checks" lists eight near-identical rows. Left as is to keep scope; it is the weakest part.
- **Unverified** — whether "Fixed rules / AI-assisted / By hand" means anything to a first-time user, and whether
  people notice "Change" in the collapsed summary. Both need real participants.
