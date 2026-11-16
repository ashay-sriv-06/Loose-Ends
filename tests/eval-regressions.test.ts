// Regressions for defects first exposed by the evaluation set (docs/evaluation.md).
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../src/domain/model.ts';
import { candidates, partialCandidate } from '../src/engine/checks.ts';
import { derivePredicate, extractFromBrief, looksBinary } from '../src/engine/extract.ts';

const src = { id: 'b.md', path: 'b.md' };
const art = (p: string, kind = 'png'): Artifact => ({ path: p, name: p.split('/').pop()!, extension: p.split('.').pop()!, kind, size: 1, inDelivery: true }) as unknown as Artifact;
const texts = (brief: string) => extractFromBrief(brief, src).requirements.map((r) => `${r.applicability}: ${r.text}`);

describe('evaluation regressions', () => {
  it('reads an unquoted file name with non-ASCII letters as one name', () => {
    const p = derivePredicate('Inverse logo as lumière-logo-inverse.svg for dark backgrounds.');
    expect(p).toMatchObject({ type: 'file-included', exactName: 'lumière-logo-inverse.svg' });
    expect(candidates({ exactName: 'lumière-logo-inverse.svg' }, [art('a/lumière-logo-inverse.svg', 'svg')])).toHaveLength(1);
  });
  it('a sentence naming several files promises each of them', () => {
    expect(derivePredicate('Please send icon-16.png, icon-32.png and icon-64.png.')).toMatchObject({ exactNames: ['icon-16.png', 'icon-32.png', 'icon-64.png'] });
  });
  it('plain label lines act as section headings, and verbless list items with a size are promises', () => {
    expect(texts('Must have:\n- The printed menu as `menu.pdf`.\n\nNice to have:\n- An animated teaser `menu-teaser.gif`.\n')).toEqual(['required: The printed menu as `menu.pdf`.', 'optional: An animated teaser `menu-teaser.gif`.']);
    expect(texts('Sizes\n\n- Square post, JPG, 1080 by 1080\n')).toEqual(['required: Square post, JPG, 1080 by 1080']);
  });
  it('prose promises and budget-dependent extras are read with the right weight', () => {
    expect(texts("As agreed, you'll get the emblem as a vector file (SVG).\n")).toHaveLength(1);
    expect(texts('If budget allows, a short animation (`intro.mp4`) would be welcome.\n')[0]).toMatch(/^optional/);
    expect(texts('Kickoff was on Monday.\nThanks for the quick turnaround last time.\n')).toEqual([]);
  });
  it('a partial name match is a single unambiguous lead, never a set', () => {
    const pool = [art('out/Story_1080x1920.png'), art('out/thumb.png')];
    expect(partialCandidate({ nameTokens: ['instagram', 'story', 'graphic'], extensions: ['png'] }, pool)?.name).toBe('Story_1080x1920.png');
    expect(partialCandidate({ nameTokens: ['instagram', 'story'], extensions: ['png'] }, [...pool, art('out/story-b.png')])).toBeNull();
    expect(partialCandidate({ nameTokens: ['story'], extensions: ['png'] }, pool)).toBeNull();
  });
  it('recognises a binary file offered as a brief', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000binary')).toBe(true);
    expect(looksBinary('# Brief\n- Café menu as `menu.pdf`\n')).toBe(false);
  });
});
