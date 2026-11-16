// Evaluation cases. Each is a small, independent synthetic project with its own layout,
// naming convention and brief style. Cases are generated into a temp directory; the answer
// key (eval/expected/answer-key.json) is never inside a scanned folder.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makePdf, makePng } from '../src/fixture/build.ts';

export interface EvalCase {
  id: string;
  root: string;
  delivery: string;
  briefs: string[];
  approvals: string[];
}

export function makeJpeg(width: number, height: number): Buffer {
  const u16 = (n: number) => [n >> 8, n & 0xff];
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, ...u16(height), ...u16(width), 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function put(root: string, rel: string, data: string | Buffer) {
  const f = path.join(root, rel);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, data);
}
const svg = (inner = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${inner}<rect width="100" height="100" fill="#234"/></svg>\n`;
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type Builder = (base: string) => Promise<EvalCase>;

const c1: Builder = async (base) => {
  const root = path.join(base, 'Café Lumière – Brand Kit');
  await put(root, 'Docs/Project brief.md', ['# Café Lumière — brand kit handover', '', 'Agreed on the call, 3 March. Invoice goes out on delivery.', '', '## What we need', '- Primary logo as `lumière-logo.svg`.', '- Inverse logo as lumière-logo-inverse.svg for dark backgrounds.', '- Social banner `banner – wide.png` at 1200×630 px.', '- The brand guide as `Brand Guide.pdf`.', '- All files must be self-contained.', '', 'Parking is free on Saturdays.', ''].join('\n'));
  await put(root, 'Final Export/Logos/lumière-logo.svg', svg('<image href="../Textures/paper%20grain.png" width="100" height="100"/>'));
  await put(root, 'Final Export/Logos/lumière-logo-inverse.svg', svg());
  await put(root, 'Final Export/Social/banner – wide.png', makePng(1200, 630, [200, 180, 150]));
  await put(root, 'Final Export/Guide/Brand Guide.pdf', makePdf(['Cafe Lumiere brand guide']));
  await put(root, 'Final Export/Textures/paper grain.png', makePng(64, 64, [240, 235, 220]));
  await put(root, 'Working/old/lumière-logo.svg', svg('<!-- earlier draft, same file name outside the delivery -->'));
  return { id: 'c1-brand-kit', root, delivery: 'Final Export', briefs: ['Docs/Project brief.md'], approvals: [] };
};

const c2: Builder = async (base) => {
  const root = path.join(base, 'acme_handoff_2026');
  await put(root, 'brief.txt', ['WORDMARK PROJECT - DELIVERABLES', '', '1. wordmark_primary.svg must be in the package.', '2. wordmark_mono.svg (single-colour version) is required as well.', '3. Supply usage_notes.md.', '', 'Payment within 30 days.', ''].join('\n'));
  await put(root, 'handoff/print/wordmark_primary.svg', svg('<!-- print -->'));
  await put(root, 'handoff/web/wordmark_primary.svg', svg('<!-- web -->'));
  await put(root, 'handoff/usage_notes.md', '# Usage notes\n\nKeep clear space around the wordmark.\n');
  await put(root, 'wip/wordmark_mono.svg', svg('<!-- mono, still in wip -->'));
  return { id: 'c2-missing-variant', root, delivery: 'handoff', briefs: ['brief.txt'], approvals: [] };
};

const c3: Builder = async (base) => {
  const root = path.join(base, 'Nordlys Studio', 'Client Drop');
  await put(root, 'Notes/what we agreed.md', ['Hej Tove,', '', "As agreed, you'll get the emblem as a vector file (SVG).", 'The badge comes as an SVG as well.', 'Please keep the files ready for our printer.', '', 'Mvh, Jonas', ''].join('\n'));
  await put(root, 'Deliverables (client)/vector/emblem.svg', svg('<image xlink:href="../../assets/grain%20texture.png" width="100" height="100"/>'));
  await put(root, 'Deliverables (client)/vector/badge.svg', svg(`<defs><g id="g1"><circle r="5"/></g></defs><use href="#g1"/><image href="textures/weave.png" width="20" height="20"/><image href="data:image/png;base64,${PIXEL}" width="1" height="1"/>`));
  await put(root, 'Deliverables (client)/vector/textures/weave.png', makePng(32, 32, [90, 90, 90]));
  await put(root, 'assets/grain texture.png', makePng(32, 32, [120, 110, 100]));
  return { id: 'c3-svg-omitted-asset', root, delivery: 'Deliverables (client)', briefs: ['Notes/what we agreed.md'], approvals: [] };
};

const c4: Builder = async (base) => {
  const root = path.join(base, 'summer-campaign');
  await put(root, 'README brief.md', ['Summer campaign assets', '', '* Instagram story graphic, PNG, 1080×1920 px', '* Square post, JPG, 1080 by 1080', '* Thumbnail `thumb.png` at 400 x 400', '', 'Timeline: first drafts Friday.', ''].join('\n'));
  await put(root, 'out/Story_1080x1920.png', makePng(1080, 1350, [250, 120, 60])); // the name lies
  await put(root, 'out/square-post.jpg', makeJpeg(1080, 1080));
  await put(root, 'out/thumb.png', makePng(400, 400, [30, 60, 90]));
  return { id: 'c4-misleading-name', root, delivery: 'out', briefs: ['README brief.md'], approvals: [] };
};

const c5: Builder = async (base) => {
  const root = path.join(base, 'Verpackung Müller');
  const v3 = makePdf(['Packaging dieline', 'Version 3']);
  const v4 = makePdf(['Packaging dieline', 'Version 4']);
  const label = makePdf(['Front label', 'Approved artwork']);
  await put(root, 'Auftrag/brief.md', ['## Deliverables', '- Deliver the client-approved packaging dieline as `packaging-dieline.pdf`.', '- Deliver the approved front label `label-front.pdf`.', ''].join('\n'));
  await put(root, 'Sign-off/Freigabe März.md', ['# Freigabe', '', 'Approved: packaging-dieline.pdf version 3.', `sha256: ${sha(v3)}`, '', 'Approved: label-front.pdf', `sha256: ${sha(label)}`, ''].join('\n'));
  await put(root, 'send/packaging-dieline.pdf', v4); // newer than what was approved
  await put(root, 'archive/packaging-dieline.pdf', v3); // the approved one, same file name, outside the delivery
  await put(root, 'send/label-front.pdf', label);
  return { id: 'c5-approved-older', root, delivery: 'send', briefs: ['Auftrag/brief.md'], approvals: ['Sign-off/Freigabe März.md'] };
};

const c6: Builder = async (base) => {
  const root = path.join(base, 'harbour-web');
  await put(root, 'scope/SOW.md', ['## Scope', '- Hero banner `hero.png` at 1600×900 px.', '- Footer logo `footer-logo.svg`.', ''].join('\n'));
  await put(root, 'scope/Change request 02.md', ['The hero banner `hero.png` must be 1920×1080 px.', ''].join('\n'));
  await put(root, 'export/final/hero.png', makePng(1920, 1080, [10, 60, 110]));
  await put(root, 'export/final/footer-logo.svg', svg());
  return { id: 'c6-conflict', root, delivery: 'export/final', briefs: ['scope/SOW.md', 'scope/Change request 02.md'], approvals: [] };
};

const c7: Builder = async (base) => {
  const root = path.join(base, 'poster job');
  await put(root, 'brief.md', ['## Required', '- Print-ready `poster.pdf`.', '- The editable source `poster.indd` must be included.', ''].join('\n'));
  await put(root, 'to client/poster.pdf', makePdf(['Poster']));
  await put(root, 'to client/poster.indd', Buffer.from([0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d, ...Array.from({ length: 400 }, (_, i) => (i * 37) % 251)]));
  return { id: 'c7-unsupported-source', root, delivery: 'to client', briefs: ['brief.md'], approvals: [] };
};

const c7b: Builder = async (base) => {
  const root = path.join(base, 'poster job (brief in Pages)');
  await put(root, 'Brief.pages', Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 600 }, (_, i) => (i * 91) % 256)]));
  await put(root, 'to client/poster.pdf', makePdf(['Poster']));
  return { id: 'c7b-unsupported-brief', root, delivery: 'to client', briefs: ['Brief.pages'], approvals: [] };
};

const c8: Builder = async (base) => {
  const root = path.join(base, 'Trattoria Ponte');
  await put(root, 'brief.md', ['# Menu redesign', '', 'Must have:', '- The printed menu as `menu.pdf`.', '', 'Nice to have:', '- An animated teaser `menu-teaser.gif`.', '- Optional: a favicon `favicon.png`.', '', 'We might want a QR code version later.', ''].join('\n'));
  await put(root, 'Für den Kunden/menu.pdf', makePdf(['Menu']));
  return { id: 'c8-optional', root, delivery: 'Für den Kunden', briefs: ['brief.md'], approvals: [] };
};


// ---------- held-out batch (written after the first batch's fixes; see answer-key-heldout.json) ----------

const h1: Builder = async (base) => {
  const root = path.join(base, 'studio.kite', '2026.11 rebrand');
  await put(root, 'email from client.txt', ['Thanks for the quick turnaround last time.', '', 'Final files: logo_colour.svg, logo_white.svg and the style sheet (styleguide.pdf).', ''].join('\n'));
  await put(root, 'FINAL/logo_colour.svg', svg());
  await put(root, 'FINAL/logo_white.svg', svg());
  await put(root, 'FINAL/styleguide.pdf', makePdf(['Style guide']));
  return { id: 'h1-kit-one-sentence', root, delivery: 'FINAL', briefs: ['email from client.txt'], approvals: [] };
};
const h2: Builder = async (base) => {
  const root = path.join(base, 'app-icons');
  await put(root, 'request.md', ['Please send icon-16.png, icon-32.png and icon-64.png.', ''].join('\n'));
  await put(root, 'dist/icons/icon-16.png', makePng(16, 16, [1, 2, 3]));
  await put(root, 'dist/icons/icon-32.png', makePng(32, 32, [1, 2, 3]));
  return { id: 'h2-missing-in-list-sentence', root, delivery: 'dist', briefs: ['request.md'], approvals: [] };
};
const h3: Builder = async (base) => {
  const root = path.join(base, 'ミナト案件');
  await put(root, 'brief.md', ['# Handover', '', 'The handover notes go in `README.md`.', ''].join('\n'));
  await put(root, '納品/README.md', ['# Notes', '', '![hero](../shots/hero.png)', '', 'See [our site](https://example.com) for more.', ''].join('\n'));
  await put(root, '納品/CHANGES.md', ['# Changes', '', '![icon](img/icon.png)', ''].join('\n'));
  await put(root, '納品/img/icon.png', makePng(8, 8, [9, 9, 9]));
  await put(root, 'shots/hero.png', makePng(8, 8, [5, 5, 5]));
  return { id: 'h3-markdown-outside-image', root, delivery: '納品', briefs: ['brief.md'], approvals: [] };
};
const h4: Builder = async (base) => {
  const root = path.join(base, 'ads_q4');
  await put(root, 'specs.md', ['Sizes', '', '- Leaderboard banner, JPG, 970 x 250', '- Avatar as `avatar.png`, 256×256', ''].join('\n'));
  await put(root, 'upload/banner-728x90.jpg', makeJpeg(728, 90));
  await put(root, 'upload/avatar.png', makePng(256, 256, [3, 3, 3]));
  return { id: 'h4-wrong-size-plain-name', root, delivery: 'upload', briefs: ['specs.md'], approvals: [] };
};
const h5: Builder = async (base) => {
  const root = path.join(base, 'print run');
  await put(root, 'brief.md', ['## To deliver', '- Send the signed-off brochure PDF.', '- The approved flyer as `flyer.pdf`.', ''].join('\n'));
  await put(root, 'mail/sign-off.md', ['Client signed off on v2 of the brochure (brochure_v2.pdf).', '', 'The flyer looks good!', ''].join('\n'));
  await put(root, 'package/brochure_v3.pdf', makePdf(['Brochure', 'v3']));
  await put(root, 'package/flyer.pdf', makePdf(['Flyer']));
  return { id: 'h5-signed-off-by-version', root, delivery: 'package', briefs: ['brief.md'], approvals: ['mail/sign-off.md'] };
};
const h6: Builder = async (base) => {
  const root = path.join(base, 'iconset');
  await put(root, 'docs/original brief.md', ['## Deliverables', '- Deliver three icon sizes.', ''].join('\n'));
  await put(root, 'docs/update.md', ['## Deliverables', '- Only two icon sizes are needed now.', ''].join('\n'));
  await put(root, 'out/icon-small.png', makePng(16, 16, [1, 1, 1]));
  await put(root, 'out/icon-large.png', makePng(64, 64, [1, 1, 1]));
  return { id: 'h6-quantity-conflict', root, delivery: 'out', briefs: ['docs/original brief.md', 'docs/update.md'], approvals: [] };
};
const h7: Builder = async (base) => {
  const root = path.join(base, 'Wandbild');
  await put(root, 'brief.md', ['## Required', '- Layered artwork `mural.psd`.', '- Mural preview `mural.png` at 2000×1000.', ''].join('\n'));
  await put(root, 'Übergabe/mural.psd', Buffer.from([0x38, 0x42, 0x50, 0x53, 0, 1, ...Array.from({ length: 300 }, (_, i) => (i * 13) % 256)]));
  await put(root, 'Übergabe/mural.png', makePng(2000, 1000, [7, 7, 7]).subarray(0, 14)); // truncated: PNG signature, then cut off
  return { id: 'h7-damaged-required-image', root, delivery: 'Übergabe', briefs: ['brief.md'], approvals: [] };
};
const h8: Builder = async (base) => {
  const root = path.join(base, 'gig-poster');
  await put(root, 'notes.md', ['Kickoff was on Monday.', '', 'What you get:', '- Poster `poster-a3.pdf`', '- Stickers sheet `stickers.pdf` (bonus)', '', 'If budget allows, a short animation (`intro.mp4`) would be welcome.', ''].join('\n'));
  await put(root, 'deliver/poster-a3.pdf', makePdf(['Poster']));
  return { id: 'h8-optional-in-prose', root, delivery: 'deliver', briefs: ['notes.md'], approvals: [] };
};

export const BUILDERS: Record<string, Builder> = {
  'c1-brand-kit': c1,
  'c2-missing-variant': c2,
  'c3-svg-omitted-asset': c3,
  'c4-misleading-name': c4,
  'c5-approved-older': c5,
  'c6-conflict': c6,
  'c7-unsupported-source': c7,
  'c7b-unsupported-brief': c7b,
  'c8-optional': c8,
  'h1-kit-one-sentence': h1,
  'h2-missing-in-list-sentence': h2,
  'h3-markdown-outside-image': h3,
  'h4-wrong-size-plain-name': h4,
  'h5-signed-off-by-version': h5,
  'h6-quantity-conflict': h6,
  'h7-damaged-required-image': h7,
  'h8-optional-in-prose': h8,
};

export async function build(id: string, base: string): Promise<EvalCase> {
  const dir = path.join(base, `${id}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  const c = await BUILDERS[id](dir);
  return { ...c, root: await fs.realpath(c.root) };
}
export { put, svg };
