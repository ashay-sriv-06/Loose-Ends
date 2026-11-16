# Design references actually seen

## Second pass — 2026-11-15, viewed in a real browser (Chrome)

Both collections loaded this time. Only the items below were looked at; nothing else on either site is claimed.

**Best Designs on X** — https://bestdesignsonx.com/
- Seen: the home page (masonry grid, left navigation, search) and one screen of scrolling. The tiles in view were
  app icons, a typeface specimen ("Joby Sans"), a dark "Update Requested" loading visual and several still-loading
  placeholders.
- Not seen: any individual post, any X thread, any video. No tile was opened.
- Used: nothing specific. The tiles in view were brand and motion pieces, not working product screens.

**Craft rebuilds from X** — https://bookmarks.pixeleate.com/ (the credited collection recorded in the first pass)
- `nizam-permitting` (original credited to @nizamdesign) — **live demo viewed.** A document list: file icon, name,
  one line of meta under it, a status badge at the right, counts next to the section title ("10 files · 8 verified"),
  a context menu open on one row.
- `knowledge-sources` (credited to @disarto_max) — **live demo viewed.** An empty state: title, two lines of
  explanation, one primary and one secondary action, source rows below, and a footer whose counts come from the rows.
- `jelly-segmented-control` (credited to @lorenzodossi) — **one frame viewed** of an auto-playing demo. The
  spring motion itself was not observed frame by frame.
- `flint-graph` (credited to @mutableos) — **one static view.** Nodes and edges on one canvas with a detail panel at
  the right. No interaction was tried.

What was borrowed (principles, no assets, no copy, no code):

1. From the document list: each finding is a row with a small file preview, the name in monospace on its own line,
   one status badge, and the counts beside the group title.
2. From the empty state: the first screen explains what will happen in three short steps under the action instead of
   an empty "nothing yet" card.
3. From the footer counts: the verdict's tally line (to fix / to review / fine / files) is computed from the same
   arrays that render the list.
4. From the graph: nodes never move; selecting a file dims the rest in place.

## First pass (text fetch only)

No images, demos or posts were viewed in the first pass; only page titles and captions were read. The principles
recorded then (244 / 1fr / inspector grid, one sliding segmented highlight, counts from records, deterministic graph
layout, badges instead of scores) still hold.
