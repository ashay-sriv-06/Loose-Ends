#!/usr/bin/env python3
"""Builds the Round 1 proposal PDF. Usage: python3 scripts/make_proposal.py [outdir=release/checkpoint-1]
Counts words over the ten answers only and fails above 500."""
import os, re, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, KeepTogether

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else "release/checkpoint-1")
OUT = os.path.join(OUT_DIR, "loose-ends-proposal.pdf")

IVORY, WHITE, INK, COBALT, MUTED, LINE = (HexColor(c) for c in
    ("#F5F3EE", "#FFFEFB", "#20231F", "#355CDE", "#5E625B", "#DDD9CF"))

QA = [
 ("One sentence: what does the Skill do?",
  "Loose Ends checks a project folder against the brief and catches missing files, broken references, and version mix-ups before you send it."),
 ("Target user and problem",
  "Freelance designers and small studios storing client projects on a NAS. A delivery folder can look finished yet omit a promised file, depend on an image left in a working folder, or contain a version the client never approved. These mistakes surface only after sending."),
 ("Proposed solution",
  "A read-only Skill that answers “Can I send this?” It compares the folder being sent with the brief and reports specific problems, each with evidence and a next action. Its central rule is the recipient boundary: whatever is inside the folder you send is all your client gets."),
 ("Core user flow",
  "Choose, Check, Fix. The Skill asks “What are you sending?” and “What did you promise?”, lists the brief’s commitments for confirmation, checks the folder, then reports “Here is what needs attention before sending.” The user fixes files and asks again."),
 ("Substantive difference",
  "General assistants summarize a folder or brief; file tools find duplicates. Loose Ends checks the delivery boundary and keeps “could not check” separate from “passed.” It gives no scores, and never reports ready when there is no brief, a partial listing, or an unreadable required file."),
 ("UGREEN AI NAS capabilities, by step",
  "From the official capability catalog (2.2.0). file-agent via ug-filesystem: ls and find list the delivery and working folders; file-content read returns SVG and Markdown text; sha256sum fingerprints files. photo-agent via ug-photo: meta gives raster image size. document-agent via ug-document: qa reads the brief and approval notes with citations. All are read-only; none needs approval."),
 ("Technical approach",
  "A Markdown-only Skill (SKILL.md plus three references) sends up to six self-contained delegations to registered experts; each later step uses only the real result returned upstream. Inputs are the folders and documents the user names; nothing else is read. No moves, deletes, or external sending. Document text is treated as untrusted content. Conflicting briefs trigger one targeted question."),
 ("Current development status",
  "Implemented: the Skill package, which passes the official creation tool’s static check (static-pass, no errors or warnings); and a local companion prototype with deterministic checks and optional local-model brief reading, covered by 95 automated tests and a browser walk-through on synthetic files on a laptop. Not yet implemented: any on-device run. Pending NAS validation: every delegation and what the experts actually return."),
 ("Final validation plan",
  "Core test one: the brief requires a dark logo variant that is missing from the delivery. Core test two: a delivered SVG references an image outside the delivery folder. Edge case: a conflicting brief amendment with no stated precedence; the Skill must ask rather than guess."),
 ("Known limitations, risks, dependencies",
  "Proprietary design files cannot be inspected and are reported as such. Pixel dimensions and content fingerprints are reported only if NAS capabilities return them. No NAS capability parses SVG; references are read from returned file text, and SVG size is unchecked. The Skill does not prove files open in the client’s software. Risk: documented capabilities may differ on-device. No external services are required."),
]

def words(s):
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9’'\-]*", s))

total = sum(words(a) for _, a in QA)
print(f"Answer word count: {total} (limit 500)")
for i, (q, a) in enumerate(QA, 1):
    print(f"  {i:>2}. {words(a):>3}  {q}")
if total > 500:
    sys.exit("FAIL: more than 500 words")
if len(QA) != 10:
    sys.exit("FAIL: need ten answers")

ss = lambda name, **k: ParagraphStyle(name, fontName=k.pop("fontName", "Helvetica"), textColor=k.pop("textColor", INK), **k)
H_TITLE = ss("t", fontName="Helvetica-Bold", fontSize=26, leading=30)
H_SUB = ss("s", fontSize=11.5, leading=16, textColor=MUTED)
Q = ss("q", fontName="Helvetica-Bold", fontSize=8.6, leading=11, textColor=COBALT, spaceAfter=2.5)
A = ss("a", fontSize=10.1, leading=14.2)
LEAD = ss("lead", fontName="Helvetica-Bold", fontSize=13, leading=18)
H2 = ss("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, spaceAfter=4)
SMALL = ss("sm", fontSize=8.6, leading=12)
SMALLB = ss("smb", fontName="Helvetica-Bold", fontSize=8.6, leading=12)
NOTE = ss("note", fontSize=8, leading=11, textColor=MUTED)

def page(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(IVORY); canvas.rect(0, 0, w, h, stroke=0, fill=1)
    canvas.setFillColor(COBALT); canvas.rect(0, h - 5, w, 5, stroke=0, fill=1)
    canvas.setFont("Helvetica", 7.6); canvas.setFillColor(MUTED)
    canvas.drawString(0.8 * inch, 0.48 * inch, "Loose Ends · UGREEN Hackathon 2026 on AI NAS · Round 1 proposal")
    canvas.drawRightString(w - 0.8 * inch, 0.48 * inch, f"Page {doc.page}")
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch,
                      topMargin=0.7 * inch, bottomMargin=0.75 * inch,
                      title="Loose Ends — Round 1 Proposal", author="", subject="UGREEN Hackathon 2026 on AI NAS")
doc.addPageTemplates(PageTemplate(id="p", frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f",
                     leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=page))

def card(i, q, a, style=A):
    num = Paragraph(f"{i:02d}", ss(f"n{i}", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=MUTED))
    body = [Paragraph(q.upper(), Q), Paragraph(a, style)]
    t = Table([[num, body]], colWidths=[0.42 * inch, doc.width - 0.42 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 10), ("LEFTPADDING", (1, 0), (1, 0), 2), ("RIGHTPADDING", (1, 0), (1, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 7.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 8.5),
    ]))
    return KeepTogether([t, Spacer(1, 5.5)])

story = [Paragraph("Loose Ends", H_TITLE), Spacer(1, 2),
         Paragraph("Can I send this? &nbsp;·&nbsp; A Skill for UGREEN AI NAS &nbsp;·&nbsp; Track: Unleash Your Creativity", H_SUB),
         Spacer(1, 12)]
for i, (q, a) in enumerate(QA, 1):
    story.append(card(i, q, a, LEAD if i == 1 else A))
story.append(Paragraph(f"The ten answers above total {total} English words (limit 500). The sections below are excluded from that count under the Official Rules.", NOTE))
story.append(Spacer(1, 14))

def table(rows, widths):
    data = [[Paragraph(c, SMALLB if r == 0 else SMALL) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=[w * doc.width for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t

appendix = [
    Paragraph("Disclosures", H2),
    Paragraph("<b>Third-party components.</b> The Skill ZIP contains only Markdown written for this hackathon and no third-party code. "
              "The components below are used only by the separate local companion prototype and to produce this PDF; they are not in the Skill ZIP.", SMALL),
    Spacer(1, 6),
    table([["Component", "Source", "License", "Use"],
           ["React, React DOM", "react.dev", "MIT", "Companion prototype interface"],
           ["Vite, @vitejs/plugin-react", "vite.dev", "MIT", "Development server and build"],
           ["TypeScript", "typescriptlang.org", "Apache-2.0", "Language and type checking"],
           ["tsx", "github.com/privatenumber/tsx", "MIT", "Running TypeScript on Node.js"],
           ["Vitest", "vitest.dev", "MIT", "Tests"],
           ["concurrently", "github.com/open-cli-tools/concurrently", "MIT", "Running development processes"],
           ["playwright-core", "playwright.dev", "Apache-2.0", "Browser walk-through test (development only)"],
           ["Ollama (optional)", "ollama.com", "MIT", "Runs an optional local model for the companion; not in the Skill ZIP"],
           ["uliya-skill-kit 0.7.7", "ai.ugreen.com", "UGREEN (official tool)", "Capability catalog and static checker; not redistributed"],
           ["Node.js", "nodejs.org", "MIT", "Local runtime"],
           ["ReportLab", "reportlab.com/opensource", "BSD", "Generating this PDF"]],
          [0.26, 0.34, 0.13, 0.27]),
    Spacer(1, 9),
    Paragraph("<b>External services and data flows.</b> None are required. The Skill reads only the folders and documents the user names on the NAS and sends nothing outside it. "
              "The companion prototype runs on the developer’s computer on loopback with synthetic demo files; it calls no external service. Optionally it asks a language model running on the same computer (through Ollama, on loopback) to suggest commitments from the brief; a suggestion is kept only when it quotes the brief word for word, and the model never decides a result.", SMALL),
    Spacer(1, 6),
    Paragraph("<b>Newly developed for this hackathon.</b> The Skill (workflow, delivery-boundary check, approval-to-version rules, source-authority rules, output contract), "
              "the local companion prototype, and its synthetic “Acme Brand Launch” demo files. No earlier Skill or submission material is reused.", SMALL),
    Spacer(1, 6),
    Paragraph("<b>AI tools used.</b> Claude Code (Anthropic) was used to draft the Skill text, write the companion prototype’s code and tests, and prepare this proposal, under the entrant’s direction and review.", SMALL),
    Spacer(1, 6),
    Paragraph("<b>Validation status.</b> The Skill package passes the static check bundled with the official creation tool (uliya-skill-kit 0.7.7, catalog 2.2.0): static-pass, 0 errors, 0 warnings. A static pass does not prove upload, installation, or device behaviour. The Skill has not run on a UGREEN NAS.", SMALL),
    Spacer(1, 16),
    Paragraph("Entrant", H2),
    Paragraph("To be completed by the entrant before submission. Left blank intentionally.", NOTE),
    Spacer(1, 22),
]
sig = Table([["", "", ""], [Paragraph("Entrant name", NOTE), Paragraph("Signature", NOTE), Paragraph("Date", NOTE)]],
            colWidths=[doc.width * 0.4, doc.width * 0.38, doc.width * 0.22])
sig.setStyle(TableStyle([("LINEBELOW", (0, 0), (0, 0), 0.6, INK), ("LINEBELOW", (1, 0), (1, 0), 0.6, INK), ("LINEBELOW", (2, 0), (2, 0), 0.6, INK),
                         ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 14), ("TOPPADDING", (0, 1), (-1, 1), 3)]))
story.append(KeepTogether(appendix[:3]))
story.extend(appendix[3:])
story.append(sig)

os.makedirs(OUT_DIR, exist_ok=True)
doc.build(story)
size = os.path.getsize(OUT)
print(f"Wrote {os.path.relpath(OUT, ROOT)} ({size} bytes, {doc.page} pages)")
if size >= 1_000_000:
    sys.exit("FAIL: PDF is 1 MB or larger")
