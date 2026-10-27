import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createIdea, makeFromEvent, type EventIdeaAsk } from '@/lib/lab/gen/event-idea';
import { groundingCount } from '@/lib/lab/gen/grounding';
import { recommendAngle } from '@/lib/lab/radar/angles';
import { T, addEvent, addPost, baseWorld, cover } from './lab-gen-helpers';

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return { ...real, execFile: vi.fn(real.execFile) };
});
const cp = await import('node:child_process');

/**
 * Idea creation (07 7.4): Make this (`from_event`) and New idea (`create`), the 2-breakout
 * grounding rule, and the single entry point for user-created ideas. AC-07-11 to AC-07-13,
 * AC-07-59 to AC-07-62. Dry where no model is wanted; live paths use an injected fake.
 */

afterEach(() => {
  delete process.env.LAB_DRY;
});

/** ev1 with `n` tracked breakouts covering it on `angle` (alternating two creators, so 2 per creator holds). */
function seed(n: number, angle: 'comparison' | 'how_to' = 'comparison') {
  const s = baseWorld();
  for (let i = 0; i < n; i++) {
    addPost(s, { id: `p-b${i}`, source: i % 2 ? 'src-c2' : 'src-c1', ratio: 4 + i, hook: `Breakout hook ${i}` });
    cover(s, 'ev1', `p-b${i}`, angle);
  }
  return s;
}

describe('from_event, Make this (7.4.2)', () => {
  test('AC-07-11: an angle is stored in launch_angle; without one the server stores recommendAngle(event)', async () => {
    process.env.LAB_DRY = '1';
    const s = seed(2, 'comparison');
    const r = await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.existing).toBe(false);
    expect(r.href).toBe(`/lab/studio?idea=${r.ideaId}`);
    const idea = s.ideas.get(r.ideaId)!;
    expect(idea).toMatchObject({ launchAngle: 'comparison', eventId: 'ev1', source: 'event', status: 'open', promptVersion: 'dry', timing: 'open', title: 'Sample Kestrel 3: Comparison' });
    expect(idea.evidence.map((e) => e.postId).sort()).toEqual(['p-b0', 'p-b1']);

    // without an angle: the recommendation is called and its angle stored (comparison is taken, so it is not chosen)
    const s2 = seed(2, 'comparison');
    const spy = vi.fn(recommendAngle);
    const r2 = await makeFromEvent(s2, { eventId: 'ev1' }, { now: T, recommend: spy });
    expect(spy).toHaveBeenCalledOnce();
    const rec = spy.mock.results[0].value as ReturnType<typeof recommendAngle>;
    expect(rec.angle).not.toBe('comparison');
    // the recommended angle has no grounding here, so it is refused honestly and writes nothing
    expect(r2).toEqual({ ok: false, status: 422, error: 'Found 0 breakouts on this angle. An idea needs 2 to be grounded.' });

    // a recommendation that is null (05 says never) answers 422 with the all-taken copy and writes nothing
    const before = s2.ideas.all().length;
    const r3 = await makeFromEvent(s2, { eventId: 'ev1' }, { now: T, recommend: (() => null) as never });
    expect(r3).toEqual({ ok: false, status: 422, error: 'Every angle is taken. A depth play (a full course) is the late move that still broke out.' });
    expect(s2.ideas.all().length).toBe(before);
  });

  test('AC-07-12: a second from_event for the same event and angle returns the open idea and calls no model', async () => {
    const s = seed(2, 'comparison');
    const ask: EventIdeaAsk = vi.fn(async () => ({ ok: true as const, data: { title: 'Kestrel 3 against the old flagship', clusterId: null, eventId: 'ev1', seedId: null, angle: 'comparison', angleClass: 'comparison' as const, hookForm: 'contrarian' as const, trigger: 'controversy' as const, tension: null, formatFamily: 'tutorial_walkthrough', evidence: [{ postId: 'p-b0', why: 'it compared them first' }], probability: 0.5 } }));
    const first = await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T, ask });
    expect(first.ok && first.existing).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    const idea = first.ok ? s.ideas.get(first.ideaId)! : null;
    expect(idea).toMatchObject({ title: 'Kestrel 3 against the old flagship', hookForm: 'contrarian', promptVersion: 'event-idea-v1' });
    expect(idea!.evidence.find((e) => e.postId === 'p-b0')?.why).toBe('it compared them first');
    const second = await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T, ask });
    expect(second).toMatchObject({ ok: true, existing: true, ideaId: first.ok ? first.ideaId : '' });
    expect(ask).toHaveBeenCalledOnce();
  });

  test('a reply citing posts outside the grounding is retried once, then refused with nothing saved', async () => {
    const s = seed(2, 'comparison');
    const ask: EventIdeaAsk = vi.fn(async () => ({ ok: true as const, data: { title: 'Invented', clusterId: null, eventId: 'ev1', seedId: null, angle: 'x', angleClass: 'comparison' as const, hookForm: 'other' as const, trigger: 'other' as const, tension: null, formatFamily: 'tutorial_walkthrough', evidence: [{ postId: 'p-nope', why: '' }], probability: 0.5 } }));
    const r = await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T, ask });
    expect(r).toEqual({ ok: false, status: 502, error: "The model's idea cited posts that are not in the Lab. Nothing was saved." });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(s.ideas.all()).toEqual([]);
    const missing: EventIdeaAsk = async () => ({ ok: false, unavailable: true, error: 'spawn claude ENOENT' });
    expect(await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T, ask: missing })).toMatchObject({ ok: false, status: 503 });
  });

  test('AC-07-59: an unknown event and a closed window answer 422 with the 01 copy', async () => {
    process.env.LAB_DRY = '1';
    const s = seed(2);
    expect(await makeFromEvent(s, { eventId: 'nope', angle: 'comparison' }, { now: T })).toEqual({ ok: false, status: 422, error: 'This launch is no longer tracked.' });
    addEvent(s, 'ev-dismissed', { status: 'dismissed' });
    expect(await makeFromEvent(s, { eventId: 'ev-dismissed', angle: 'comparison' }, { now: T })).toMatchObject({ status: 422, error: 'This launch is no longer tracked.' });
    addEvent(s, 'ev-closed', { windowState: 'closed' });
    expect(await makeFromEvent(s, { eventId: 'ev-closed', angle: 'comparison' }, { now: T })).toEqual({ ok: false, status: 422, error: 'This window has closed.' });
    addEvent(s, 'ev-null', { windowState: null });
    expect(await makeFromEvent(s, { eventId: 'ev-null', angle: 'comparison' }, { now: T })).toMatchObject({ error: 'This window has closed.' });
  });
});

describe('the 2-breakout grounding rule (7.4.1; AC-07-13, AC-07-61)', () => {
  test('AC-07-13: from_event and create with 1 or 0 breakouts answer 422 with the exact copy and write nothing; with 2 they store both', async () => {
    process.env.LAB_DRY = '1';
    const one = seed(1);
    expect(await makeFromEvent(one, { eventId: 'ev1', angle: 'comparison' }, { now: T })).toEqual({ ok: false, status: 422, error: 'Found 1 breakout on this angle. An idea needs 2 to be grounded.' });
    expect(createIdea(one, { title: 'Kestrel against last year', angle: 'comparison', eventId: 'ev1' }, { now: T })).toEqual({ ok: false, status: 422, error: 'Found 1 breakout on this angle. An idea needs 2 to be grounded.' });
    const zero = seed(0);
    expect(await makeFromEvent(zero, { eventId: 'ev1', angle: 'comparison' }, { now: T })).toEqual({ ok: false, status: 422, error: 'Found 0 breakouts on this angle. An idea needs 2 to be grounded.' });
    expect(createIdea(zero, { title: 'Kestrel against last year', angle: 'comparison', eventId: 'ev1' }, { now: T })).toMatchObject({ status: 422, error: 'Found 0 breakouts on this angle. An idea needs 2 to be grounded.' });
    expect(one.ideas.all()).toEqual([]);
    expect(zero.ideas.all()).toEqual([]);
    const two = seed(2);
    const made = createIdea(two, { title: 'Kestrel against last year', angle: 'comparison', eventId: 'ev1' }, { now: T });
    expect(made.ok).toBe(true);
    if (made.ok) expect(two.ideas.get(made.ideaId)!.evidence.map((e) => e.postId).sort()).toEqual(['p-b0', 'p-b1']);
  });

  test('AC-07-61: owned posts and low-confidence unconfirmed coverage never count (one of each next to one real breakout: 1, 422)', async () => {
    process.env.LAB_DRY = '1';
    const s = seed(1);
    addPost(s, { id: 'p-own', source: 'src-own', owned: true, ratio: 5 });
    cover(s, 'ev1', 'p-own', 'comparison', { owned: true });
    addPost(s, { id: 'p-low', source: 'src-c3', ratio: 6 });
    cover(s, 'ev1', 'p-low', 'comparison', { confidence: 'low', confirmed: null });
    expect(groundingCount(s, { angle: 'comparison', eventId: 'ev1', query: 'Sample Kestrel 3', now: T }).count).toBe(1);
    expect(await makeFromEvent(s, { eventId: 'ev1', angle: 'comparison' }, { now: T })).toMatchObject({ status: 422, error: 'Found 1 breakout on this angle. An idea needs 2 to be grounded.' });
    // confirming the low row makes it count
    cover(s, 'ev1', 'p-low', 'comparison', { confidence: 'low', confirmed: true });
    expect(groundingCount(s, { angle: 'comparison', eventId: 'ev1', query: 'Sample Kestrel 3', now: T }).count).toBe(2);
  });

  test('grounding without an event: tracked breakouts similar to the text, at most 2 per creator, owned never', () => {
    const s = baseWorld();
    addPost(s, { id: 'q1', source: 'src-c1', ratio: 5, hook: 'I compared voice agents for a week' });
    addPost(s, { id: 'q2', source: 'src-c2', ratio: 4, hook: 'Voice agents compared on real calls' });
    addPost(s, { id: 'q3', source: 'src-own', owned: true, ratio: 9, hook: 'Voice agents compared by me' });
    const g = groundingCount(s, { angle: 'other', query: 'voice agents compared', now: T });
    expect(g.postIds.sort()).toEqual(['q1', 'q2']);
  });
});

describe('create, New idea (7.4.3; AC-07-60)', () => {
  test('AC-07-60: a 7-character title is 400; a valid create calls no model and stores source manual, launch_angle and notes', async () => {
    const s = seed(2, 'how_to');
    expect(createIdea(s, { title: 'Seven c', angle: 'how_to' }, { now: T })).toEqual({ ok: false, status: 400, error: 'Write at least 8 characters.' });
    expect(createIdea(s, { title: 'A long enough title', angle: 'nope' }, { now: T })).toMatchObject({ status: 400 });
    expect(createIdea(s, { title: 'A long enough title', angle: 'how_to', notes: 'x'.repeat(501) }, { now: T })).toMatchObject({ status: 400, error: 'notes: at most 500 characters.' });
    const spy = vi.mocked(cp.execFile);
    spy.mockClear();
    const r = createIdea(s, { title: '  Set up Kestrel   in ten minutes ', angle: 'how_to', eventId: 'ev1', notes: 'Show the config file.' }, { now: T });
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.href).toBe(`/lab/studio?idea=${r.ideaId}`);
    expect(s.ideas.get(r.ideaId)).toMatchObject({ title: 'Set up Kestrel in ten minutes', source: 'manual', launchAngle: 'how_to', angle: 'How-to', notes: 'Show the config file.', eventId: 'ev1', status: 'open', thin: true });
  });

  test("create with angle 'other' and no event grounds on similar breakouts", () => {
    const s = baseWorld();
    addPost(s, { id: 'q1', source: 'src-c1', ratio: 5, hook: 'My cron job writes my newsletter' });
    addPost(s, { id: 'q2', source: 'src-c2', ratio: 4, hook: 'A cron job that writes the newsletter for you' });
    const r = createIdea(s, { title: 'Cron job newsletter writer', angle: 'other', notes: 'newsletter cron job' }, { now: T });
    expect(r.ok).toBe(true);
    if (r.ok) expect(s.ideas.get(r.ideaId)).toMatchObject({ angle: 'Other', launchAngle: 'other', eventId: null });
  });
});

describe('one entry point for user-created ideas (AC-07-62)', () => {
  const ROOT = path.resolve(__dirname, '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

  test('only lib/lab/ideas.ts and lib/lab/gen/{diversity,event-idea,comments}.ts write ideas; /api/lab/radar has no make action', () => {
    const allowed = new Set(['lib/lab/ideas.ts', 'lib/lab/gen/diversity.ts', 'lib/lab/gen/event-idea.ts', 'lib/lab/gen/comments.ts', 'lib/lab/store.ts', 'lib/lab/fixtures/world.ts', 'lib/lab/fixtures/gen.ts']);
    const writers = [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))]
      .filter((f) => /INSERT (OR REPLACE )?INTO lab_ideas|\.ideas\.(insert|upsert)\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    for (const w of writers) expect(allowed.has(w), `${w} writes lab_ideas`).toBe(true);
    // routes never write ideas directly: they call the lib entry points above
    expect(writers.filter((w) => w.startsWith('app/'))).toEqual([]);
    const radar = path.join(ROOT, 'app/api/lab/radar/route.ts');
    if (fs.existsSync(radar)) expect(fs.readFileSync(radar, 'utf8')).not.toMatch(/['"]make['"]/);
  });
});
