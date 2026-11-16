# Interface checks (automated)

23 of 23 passed. Screenshots: docs/screenshots/after/.

- PASS — Empty: the first screen answers what / select / next inside one 1440×900 view — action ends at 358px, next-steps end at 660px of 900
- PASS — Keyboard: the main action is reachable by Tab and shows a focus ring — 4 Tab presses; outline solid 2px
- PASS — Loading: real phases and counts, no percentage — 5 phases listed; Cancel present
- PASS — Completed: verdict and the first finding are above the fold; counts match the list — first finding at 494px; tally: 3 to fix 0 to review 4 fine 1 optional open 4 files in Delivery
- PASS — Each open finding has: sentence, affected file, why, “Show me”, next action — 4 findings checked
- PASS — Drawer: opens from the keyboard, brief and file fact sit side by side, technical details closed — drawer 490px wide; columns 219px + 219px
- PASS — Drawer: scrolls on its own, header stays, page does not move — content 1242px in a 900px drawer; scrolled to 342px; Close stays at y=14
- PASS — Drawer: Escape closes it and focus returns to the same “Show me” — Show me | brand-guidelines-v7.pdf is version 7, bu
- PASS — Boundary: “See where this file sits” reveals the real dependency with the file selected — 1 line(s) cross the boundary; node position unchanged during the 0.9 s reveal
- PASS — Stale: a changed file marks the result out of date and offers “Check again”
- PASS — Partial: files that could not be inspected are counted and listed — Partial check. 1 file or reference could not be fully inspected. The result covers only what was checked.
- PASS — Cancelled: a check stopped by the person is labelled as incomplete (real cancel request) — You cancelled this check. It stopped before any result was produced. Check again
- PASS — Failed: an errored run says so and offers “Try again” (state injected into one response; no real failure was available)
- PASS — Contrast: text on its real background meets WCAG AA — 17 text styles measured, lowest 4.57:1 (.chip.tone-bad)
- PASS — Long file names: no horizontal overflow, names truncate, full name available (desktop) — 3 findings with 100+ character names
- PASS — No browser console or page errors (desktop)
- PASS — Mobile 390px: first screen shows headline, both inputs and the action without scrolling — action ends at 485px of 844
- PASS — Mobile: reading-mode labels do not overlap or clip
- PASS — Mobile: findings list, then the drawer as a full-width sheet that locks the page behind it — “Show me” 38px tall; sheet 390×726; scrolled 260px inside; columns stacked
- PASS — Mobile: “What your client gets” scrolls inside its own box
- PASS — Long file names on mobile: no horizontal overflow
- PASS — Reduced motion: the boundary reveal and other animations are switched off — edge animation 1e-06s / delay 0s
- PASS — No page errors (mobile)
