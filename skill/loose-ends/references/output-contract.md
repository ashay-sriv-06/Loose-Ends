# Output contract

The report is built only from check records produced in the current conversation. Counts are counted from those records.

## Outcome words (one per check)

| Outcome | Meaning |
|---|---|
| `verified` | Inspected, and the observation satisfies the requirement. |
| `failed` | Inspected, and the observation contradicts the requirement. |
| `needs-review` | Inspected, but a person must decide (ambiguous match, vague approval, unopened link). |
| `not-found-in-scope` | Looked for within the authorized folders and not found. |
| `unable-to-inspect` | Could not be inspected (unsupported format, unreadable file, capability did not return the fact, partial listing). |
| `scope-conflict` | Sources disagree about what is required and no authority has been established. |
| `stale` | An earlier result whose file or source has changed since; not current until rechecked. |

## Overall status (exactly one)

Apply in this order:

1. **Could not complete check** - the delivery folder could not be listed, there is no brief, or zero requirements were extracted.
2. **Fix before sending** - at least one applicable required check is `failed` or `not-found-in-scope`.
3. **Needs your review** - no known required failure, but at least one required check is `needs-review`, `unable-to-inspect`, `scope-conflict`, or `stale`, or coverage was partial.
4. **Ready on checked items** - every applicable required check is `verified` and coverage of required checks is complete.

Optional items never change the overall status; they are listed separately as suggestions.

## Layout

```
Can I send this? - <overall status>

<N> to fix, <M> to review, <K> verified   (counted from the checks below)

Fix before sending
1. <plain-English problem>
   Promised: "<quoted sentence>" (<source document>)
   Inspected: <file path>
   Observed: <what was seen>
   Next: <one action>
   Limits: <what this check cannot establish>

Needs your review
<same fields as above for each item>

Verified
- <requirement> - <file path>

What I checked: <delivery folder>, <brief>, <optional sources>; <number> files listed
What I could not check: <files/formats/steps, each with the reason>
```

## Example

```
Can I send this? - Fix before sending

2 to fix, 1 to review, 2 verified

Fix before sending
1. The dark logo variant is not in the folder you're sending.
   Promised: "Logo in light and dark variants (SVG)." (Brief.md)
   Inspected: Delivery/ (6 files listed)
   Observed: logo.svg present; no dark variant listed. A file named logo-dark.svg is listed in Working/.
   Next: Add the dark variant to Delivery/ and check again.
   Limits: Matching is by listing and file name; content was not compared.

2. This logo uses an image outside the folder you're sending.
   Promised: "All files must be self-contained." (Brief.md)
   Inspected: Delivery/logo.svg
   Observed: reference "../Working/grain.png" resolves to Working/grain.png, outside Delivery/.
   Next: Put grain.png inside Delivery/ and update the reference, then check again.
   Limits: Shows where the reference points; does not test the client's software.

Needs your review
3. The approval note names version 6; the delivered guidelines are version 7.
   Promised: "Deliver the approved brand guidelines." (Brief.md)
   Inspected: Delivery/brand-guidelines.md, Approvals/approval-note.md
   Observed: note says "Approved: brand guidelines v6"; delivered file states "Version: 7".
   Next: Confirm which version the client approved and deliver that one.
   Limits: Compared stated version identifiers, not full content.

Verified
- Social story image (PNG) - Delivery/social/story.png
- Brand guidelines document present - Delivery/brand-guidelines.md

What I checked: Delivery/, Brief.md, Working/, Approvals/approval-note.md; 6 files listed
What I could not check: Working/logo-source.xd (unsupported format - review manually)
```

## Rules

- No percentages, scores, or ratings.
- Never write "everything is perfect", "guaranteed", or "certified".
- If the status is "Ready on checked items", add: "This describes the files inspected just now. Items listed under 'What I could not check' were not verified."
