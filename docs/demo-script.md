# 90-second demo script (local companion)

Recorded on a laptop with synthetic files. Say so on screen or in narration: **“This is the local companion on demo files — not a NAS run.”**
Setup: `npm run fixture:reset && npm start`, open http://127.0.0.1:4177. Check runs finish in well under a second, so no edits are needed.

| Time | On screen | Say |
|---|---|---|
| 0–10 s | Finder: `fixtures/acme/Delivery` — logo, banner, guidelines PDF, README. Open `logo.svg`; it looks fine. | “This folder looks ready to send.” |
| 10–25 s | Loose Ends. “What are you sending?” = `Delivery`. “What did you promise?” = `Brief/brief.md`, approval note added. Open “5 promises found in the brief — review”, close it. Press **Check before sending**. | “I pick the folder I’m sending and the brief. It reads the promises, and I check.” |
| 25–50 s | **Fix before sending**. Finding 1: “logo-dark.svg was promised but is not in the folder you’re sending.” Finding 3: “This logo uses an image outside the folder you’re sending.” Click **Show me** on it: reference `../Working/grain.png` → `Working/grain.png`. Switch to **What your client gets**: the arrow leaves the delivery box. | “The dark logo never made it in. And the logo borrows a texture from my working folder — on my machine it works, but my client only gets what’s inside this folder.” |
| 50–65 s | Back to Findings. **Show me** on “brand-guidelines-v7.pdf is version 7, but the approval names version 6.” Point at the approval excerpt, the two fingerprints, and “The approved file exists here: Working/brand-guidelines-v6.pdf”. | “The client approved version 6. I’m about to send version 7. Newer isn’t approved.” |
| 65–80 s | **Apply demo fix** on finding 1 and on finding 3 (each shows the exact file changes). Results turn “Out of date”. Press **Check again**. | “These demo fixes change the actual files — nothing is marked as passed by hand. So I check again.” |
| 80–90 s | “2 issues resolved.” Status is still **Fix before sending**: the approval mismatch remains because that is my decision. Click **Open receipt**. | “Two resolved, one still mine to decide. And a receipt of exactly what was checked — and what wasn’t.” |

Closing line: “Loose Ends checks your project folder against the brief and catches missing files, broken references, and version mix-ups before you send it.”

Notes
- The diff banner reads “2 issues resolved. 2 still need attention.” The second open item is the optional favicon, which does not block sending.
- For Round 2 this script must be re-recorded with the Skill running on the assigned NAS on the assigned testing day, as the official rules require. This local recording cannot stand in for that.
