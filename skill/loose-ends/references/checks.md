# Checks

Each check is limited to what the registered experts return. The Actions named below come from the public capability catalog (structure version 2.2.0); the experts choose and run them, and none has been run on a NAS by the author. Where an expert does not return a fact, the outcome is `unable-to-inspect`.

| Check | Expert | Catalog CLI and Actions relied on | What is not confirmed |
|---|---|---|---|
| 1 Inclusion | `file-agent` | `ug-filesystem`: `ls`, `find` | Whether a very large listing is returned whole |
| 2 References | `file-agent` | `ug-filesystem`: `ls`, and the file-content read Action | Whether full file text is relayed back. No Action parses SVG or Markdown; references are read from the returned text |
| 3 Approval | `document-agent`, `file-agent` | `ug-document`: `qa`; `ug-filesystem`: `sha256sum` | Whether the checksum value is relayed back |
| 4 Properties | `photo-agent` | `ug-photo`: `meta` | Whether width and height are returned for files outside the photo library. SVG and other non-raster files are not covered |

## 1. Required file inclusion

- **Question:** Is each promised deliverable inside the delivery folder?
- **Method:** Compare the confirmed requirements with the delivery listing.
- **Outcomes:** `verified` (a matching file is listed), `not-found-in-scope` (absent from delivery and workspace), `failed` (absent from delivery but present in the named working folder - it exists but would not be sent), `needs-review` (two or more files plausibly match, or the match rests on the file name alone for a property the name cannot prove).
- **Cannot establish:** that the file's content is correct, complete, or opens in the client's software.

## 2. References that leave the delivery folder ("What your client gets")

- **Question:** Does any delivered file depend on something outside the folder being sent?
- **Method:** Read text-based delivered files (for example SVG and Markdown). Extract image and file references. Resolve relative paths from the containing file's folder. Compare with the delivery listing.
- **Outcomes:** `verified` (all discovered references resolve inside the delivery), `failed` (a reference resolves outside the delivery, or to nothing), `unable-to-inspect` (the file cannot be read as text, or the format is unsupported), `needs-review` (web links and other addresses that are not opened).
- **Wording:** "This logo uses an image outside the folder you're sending." Always give the source file, the exact reference as written, and the resolved target path.
- **Cannot establish:** references in formats that cannot be read; whether a reference is essential to the design; whether the client's software can open the file. This is file-boundary analysis, not a test of the client's setup.

## 3. Approval matches delivered version

- **Question:** Is the delivered version the one the approval note names?
- **Method:** Read the approval note; identify the named file and version; compare with the delivered file's version identifier.
- **Outcomes:** `verified` (same identifier), `failed` (the note names one version and a different one is delivered), `needs-review` (the note does not identify a specific version, or identity rests on a file name only).
- **Rule:** "Latest" is never treated as "approved". A newer file date proves nothing about approval.
- **Cannot establish:** that the content is byte-identical to what was approved, unless a SHA-256 checksum is returned by the expert and the same value is recorded in the approval note.

## 4. Stated properties (for example image size)

- **Question:** Does a deliverable have a property the brief requires, such as 1080 x 1920 pixels?
- **Method:** Use the property only if a capability returns it from the file itself.
- **Outcomes:** `verified` or `failed` when the property is returned; otherwise `unable-to-inspect`. A file name containing the size is not evidence.

## Unsupported inputs

Proprietary design source files, archives, corrupt files, and any file a capability cannot read are listed under "What I could not check" with the suggestion to review them manually. A required check that depends on one of them keeps the overall status from being "Ready on checked items".

## Differences from the local companion prototype

A separate local companion app (not part of this package, and not runnable inside a Skill) performs the same four checks on a laptop with its own code: it reads PNG/JPEG dimensions from file bytes and computes content fingerprints. It also reads the brief with fixed rules, optionally assisted by a local language model whose proposals must quote the brief verbatim. On the NAS, this Skill reports those facts only when a registered expert returns them. Both use the same outcome words and overall statuses.
