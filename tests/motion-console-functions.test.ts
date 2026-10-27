import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConsoleControlsSchema } from '@/lib/creative-engine/schemas';
import { composePrompt, BUILTIN_PRESETS } from '@/lib/creative-engine/compose';
import { ignoredRefs, referencePaths, stripIgnoredRefs, validateRequest, buildVideoBody } from '@/lib/arcads/validate';
import {
  COLUMN_KEYS, assetKindFromPath, checkPathProblem, chipWidths, defaultFor, draftKey, generateBlockReason, isModified, isPresetModified,
  parseDraft, shortcutFor, titleCaseStatus,
} from '@/lib/creative-engine/console-ui';
import { fmtCredits } from '@/lib/creative-engine/format';
import { GET as assetsGET } from '@/app/api/creative-engine/arcads/assets/route';

/** S05a §10 unit tests: the Motion console's pure helpers, dialogue toggle, reference rules and the path check route. */

const D = ConsoleControlsSchema.parse({});
const base = { campaign: true, readOnly: false, connected: true, blocking: 0, busy: false };

describe('generateBlockReason (FR-8)', () => {
  test('null when Generate can run', () => expect(generateBlockReason(base)).toBeNull());
  test('sample first, with no fix', () => expect(generateBlockReason({ ...base, readOnly: true, campaign: false, connected: false })).toEqual({ text: 'Sample data: actions are off', action: null }));
  test('not connected', () => expect(generateBlockReason({ ...base, connected: false, campaign: false })).toEqual({ text: 'Connect Arcads first', action: 'connect' }));
  test('no campaign (AC5a.2 wording)', () => expect(generateBlockReason({ ...base, campaign: false })).toEqual({ text: 'Open or create a campaign first', action: 'campaign' }));
  test('lint errors, with the plural', () => {
    expect(generateBlockReason({ ...base, blocking: 1 })).toEqual({ text: 'Fix 1 lint error', action: 'lints' });
    expect(generateBlockReason({ ...base, blocking: 2 })).toEqual({ text: 'Fix 2 lint errors', action: 'lints' });
  });
  test('busy', () => expect(generateBlockReason({ ...base, busy: true })?.action).toBeNull());
});

describe('chipWidths (R4, AC5a.5)', () => {
  test('zero spend: no pink', () => expect(chipWidths(0, 200)).toEqual({ used: 0, left: 100 }));
  test('50 of 200: 25 / 75', () => expect(chipWidths(50, 200)).toEqual({ used: 25, left: 75 }));
  test('at the cap: all used', () => expect(chipWidths(200, 200)).toEqual({ used: 100, left: 0 }));
  test('over the cap clamps', () => expect(chipWidths(450, 200)).toEqual({ used: 100, left: 0 }));
  test('always sums to 100', () => { for (const s of [0, 1, 33, 199, 500]) { const w = chipWidths(s, 200); expect(w.used + w.left).toBe(100); } });
  test('a zero cap does not divide by zero', () => expect(chipWidths(0, 0)).toEqual({ used: 0, left: 100 }));
});

describe('fmtCredits in the readout (X3, C10)', () => {
  test.each([[961.97, '962'], [38.03, '38'], [5763, '5,763'], [2.5, '2.5'], [3, '3']])('%s -> %s', (n, s) => expect(fmtCredits(n)).toBe(s));
});

describe('titleCaseStatus', () => {
  test.each([['pending', 'Pending'], ['IN_PROGRESS', 'In progress'], [null, ''], ['', '']])('%s -> %s', (a, b) => expect(titleCaseStatus(a)).toBe(b));
});

describe('isPresetModified (FR-6)', () => {
  const p = BUILTIN_PRESETS[0].controls;
  const applied = ConsoleControlsSchema.parse({ ...D, ...p });
  test('fresh preset is not edited', () => expect(isPresetModified(p, applied)).toBe(false));
  test('one changed key is edited', () => expect(isPresetModified(p, { ...applied, framing: 'wide' })).toBe(true));
  test('keys the preset does not set never count', () => expect(isPresetModified(p, { ...applied, dialogue: 'anything' })).toBe(false));
});

describe('defaultFor and isModified (FR-17)', () => {
  test('schema default without a preset', () => expect(defaultFor('framing', D)).toBe('medium'));
  test("the applied preset's value wins", () => expect(defaultFor('framing', D, { framing: 'macro' })).toBe('macro'));
  test('modified compares against that value', () => {
    expect(isModified('framing', { ...D, framing: 'wide' }, D)).toBe(true);
    expect(isModified('framing', { ...D, framing: 'macro' }, D, { framing: 'macro' })).toBe(false);
  });
  test('every column key is a real control', () => {
    for (const keys of Object.values(COLUMN_KEYS)) for (const k of keys) expect(k in D).toBe(true);
  });
});

describe('drafts (FR-1)', () => {
  test('one key per campaign, none when absent', () => {
    expect(draftKey('c-1')).toBe('ae-console-draft:c-1');
    expect(draftKey(null)).toBe('ae-console-draft:none');
  });
  test('a valid draft round-trips', () => {
    const raw = JSON.stringify({ v: 1, c: { ...D, framing: 'wide' }, locked: ['camera'], open: ['action', 'bogus'], beatPick: 2, tab: 'references', activePreset: 'UGC selfie', scriptKey: 's1:2' });
    const d = parseDraft(raw, ConsoleControlsSchema);
    expect(d?.c.framing).toBe('wide');
    expect(d?.locked).toEqual(['camera']);
    expect(d?.open).toEqual(['action']);
    expect(d?.beatPick).toBe(2);
    expect(d?.tab).toBe('references');
    expect(d?.scriptKey).toBe('s1:2');
  });
  test('corrupt or foreign drafts are discarded', () => {
    expect(parseDraft('{not json', ConsoleControlsSchema)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, c: D }), ConsoleControlsSchema)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, c: { framing: 'nonsense' } }), ConsoleControlsSchema)).toBeNull();
    expect(parseDraft(null, ConsoleControlsSchema)).toBeNull();
  });
  test('over-long text in a stored draft is clamped, never thrown', () => {
    const d = parseDraft(JSON.stringify({ v: 1, c: { dialogue: 'x'.repeat(2000) }, tab: 'nope' }), ConsoleControlsSchema);
    expect(d?.c.dialogue).toHaveLength(600);
    expect(d?.tab).toBe('scene');
  });
});

describe('shortcutFor (FR-3)', () => {
  test('keys map', () => {
    expect(shortcutFor({ key: '[' }, 'BODY')).toBe('prev');
    expect(shortcutFor({ key: ']' }, 'BUTTON')).toBe('next');
    expect(shortcutFor({ key: 'g' }, 'DIV')).toBe('generate');
    expect(shortcutFor({ key: '/' }, 'DIV')).toBe('describe');
  });
  test('ignored while typing and with modifiers', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(shortcutFor({ key: 'g' }, tag)).toBeNull();
    expect(shortcutFor({ key: 'g' }, 'DIV', true)).toBeNull();
    expect(shortcutFor({ key: 'p', metaKey: true }, 'DIV')).toBeNull();
  });
});

describe('Dialogue toggle (FR-11, AC5a.7)', () => {
  const words = 'I replaced my whole ops team with two agents.';
  test('omitDialogue defaults to false and old presets parse', () => {
    expect(D.omitDialogue).toBe(false);
    expect(ConsoleControlsSchema.parse(BUILTIN_PRESETS[0].controls).omitDialogue).toBe(false);
  });
  test('off: no Dialogue line, no dialogue lints; the text is kept', () => {
    const on = composePrompt({ dialogue: words, duration: 8 });
    const off = composePrompt({ dialogue: words, duration: 8, omitDialogue: true });
    expect(on.prompt).toContain('Dialogue:');
    expect(off.prompt).not.toContain('Dialogue:');
    const tooLong = composePrompt({ dialogue: 'word '.repeat(80), duration: 4, omitDialogue: true });
    expect(tooLong.lints.some((l) => /spoken words/.test(l.message))).toBe(false);
    expect(validateRequest(ConsoleControlsSchema.parse({ model: 'kling-3.0', aspectRatio: '9:16', duration: 5, dialogue: words, omitDialogue: true })).some((l) => l.field === 'dialogue')).toBe(false);
  });
});

describe('references the model takes none of (Q-MC-4: keep with a warning, never send)', () => {
  const c = ConsoleControlsSchema.parse({ model: 'kling-3.0', aspectRatio: '9:16', duration: 5, referenceImages: ['/tmp/a.jpg'], referenceVideos: ['/tmp/v.mp4'] });
  test('a warning, not an error', () => {
    const lints = validateRequest(c);
    expect(lints.filter((l) => l.field === 'referenceImages' || l.field === 'referenceVideos').every((l) => l.level === 'warn')).toBe(true);
    expect(lints.filter((l) => l.level === 'error')).toEqual([]);
  });
  test('stripped before upload and never in the body', () => {
    expect(ignoredRefs(c)).toEqual(['referenceImages', 'referenceVideos']);
    const s = stripIgnoredRefs(c);
    expect(s.referenceImages).toEqual([]);
    expect(c.referenceImages).toEqual(['/tmp/a.jpg']);
    expect(buildVideoBody(c, 'p', 'prod', { referenceImages: ['h1'], referenceVideos: [], referenceAudios: [], startFrame: null, endFrame: null }).referenceImages).toBeUndefined();
  });
  test('too many for a model that takes some is still an error', () => {
    expect(validateRequest(ConsoleControlsSchema.parse({ model: 'veo31', aspectRatio: '9:16', referenceImages: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'] })).some((l) => l.field === 'referenceImages' && l.level === 'error')).toBe(true);
  });
  test('a frame on a model without frames is kept and ignored', () => {
    const f = ConsoleControlsSchema.parse({ model: 'seedance-2.0', startFrame: '/tmp/s.jpg' });
    expect(validateRequest(f).filter((l) => l.level === 'error')).toEqual([]);
    expect(stripIgnoredRefs(f).startFrame).toBeNull();
  });
});

describe('reference checks in the lints (FR-10)', () => {
  const c = ConsoleControlsSchema.parse({ model: 'seedance-2.0', referenceImages: ['/x/missing.jpg', '/x/clip.mp4'] });
  test('paths are listed with the kind they must be', () => expect(referencePaths(c).map((r) => r.kind)).toEqual(['image', 'image']));
  test('missing and wrong-kind files are errors; unchecked paths are not', () => {
    const lints = validateRequest(c, { '/x/missing.jpg': { exists: false, kind: null }, '/x/clip.mp4': { exists: true, kind: 'video' } });
    expect(lints.filter((l) => l.level === 'error').map((l) => l.message)).toEqual(['reference file not found: /x/missing.jpg', '/x/clip.mp4 is video; reference images must be an image']);
    expect(validateRequest(c).filter((l) => l.level === 'error')).toEqual([]);
  });
});

describe('path check helpers and route', () => {
  test('kind from extension', () => {
    expect(assetKindFromPath('/a/b.JPG')).toBe('image');
    expect(assetKindFromPath('/a/b.mov')).toBe('video');
    expect(assetKindFromPath('/a/b.m4a')).toBe('audio');
    expect(assetKindFromPath('/a/b.txt')).toBeNull();
  });
  test('relative paths and .. are refused', () => {
    expect(checkPathProblem('a/b.jpg')).toMatch(/absolute/);
    expect(checkPathProblem('/a/../etc/passwd')).toMatch(/\.\./);
    expect(checkPathProblem('')).toMatch(/required/);
    expect(checkPathProblem('/a/b..c.jpg')).toBeNull();
    expect(checkPathProblem('C:\\media\\frame.png')).toBeNull();
    expect(checkPathProblem('C:/media/frame.png')).toBeNull();
    expect(checkPathProblem('C:\\media\\..\\private.png')).toMatch(/\.\./);
    expect(checkPathProblem('C:relative.png')).toMatch(/absolute/);
  });
  const call = async (p: string) => {
    const res = await assetsGET(new Request(`http://local/api/creative-engine/arcads/assets?check=${encodeURIComponent(p)}`));
    return { status: res.status, body: await res.json() };
  };
  test('route: rejects relative and ..', async () => {
    expect((await call('rel/a.jpg')).status).toBe(400);
    expect((await call('/tmp/../etc/hosts')).status).toBe(400);
  });
  test('route: missing file is exists:false; a real file reports its kind and size', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-check-'));
    const f = path.join(dir, 'frame.png');
    fs.writeFileSync(f, Buffer.from([1, 2, 3]));
    expect((await call(path.join(dir, 'nope.png'))).body).toMatchObject({ exists: false });
    expect((await call(f)).body).toMatchObject({ exists: true, kind: 'image', bytes: 3 });
    expect((await call(dir)).body).toMatchObject({ exists: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
