import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabEvent } from '@/lib/schemas';
import { newEvent } from '@/lib/lab/radar/events';
import { composeMorningBrief, EMPTY_BRIEF, MORNING_BRIEF_MAX_ITEMS, selectBriefItems } from '@/lib/lab/radar/morning-brief';
import { briefFilePath, sendMorningBriefToWizard, wizardAlive } from '@/lib/lab/radar/wizard';
import { runBrief, radarCtx } from '@/lib/lab/radar/run';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = new Date('2026-10-12T07:40:00Z');

function launch(s: LabStore, n: number, over: Partial<LabEvent> = {}): LabEvent {
  const t0 = NOW.getTime() - (n + 2) * H;
  const e = newEvent(`Sample Launch ${n}`, iso(t0), NOW, { status: 'confirmed', t0: iso(t0), confirmedAt: iso(t0 + H), novelty: n % 2 ? 'new_category' : 'point_release', windowState: 'open', windowOpensAt: iso(t0), windowClosesAt: iso(t0 + 168 * H), ...over });
  s.events.upsert(e);
  return e;
}

let home: string;
let brainRoot: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-wizard-'));
  brainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-brain-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(brainRoot, { recursive: true, force: true });
});

describe('AC-05-29 composeMorningBrief', () => {
  test('max 5 items, priority order, closed and dismissed excluded', () => {
    const s = fresh();
    for (let n = 1; n <= 7; n++) launch(s, n);
    launch(s, 8, { status: 'dismissed' });
    launch(s, 9, { windowState: 'closed' });
    const b = composeMorningBrief(s, { now: NOW, tz: 'UTC', dry: false, brainRoot });
    expect(b.items).toHaveLength(MORNING_BRIEF_MAX_ITEMS);
    expect(b.items.map((i) => i.priority)).toEqual([...b.items.map((i) => i.priority)].sort((a, c) => a - c));
    expect(b.items.slice(0, 4).every((i) => i.priority === 1)).toBe(true);
    expect(b.items.some((i) => i.line.startsWith('Sample Launch 8') || i.line.startsWith('Sample Launch 9'))).toBe(false);
    expect(b.text.split('\n')[0]).toBe('Morning brief, Monday 12 October. 5 items.');
    expect(b.items[0].line).toMatch(/^Sample Launch \d launched \d+h ago \(New category\)\. 0 of 0 creators in\. Untaken angle: Real examples\.$/);
    expect(fs.readFileSync(path.join(brainRoot, 'lab', 'morning-brief-2026-10-12.md'), 'utf8')).toContain('Morning brief, Monday 12 October.');
  });

  test('dedupe against the last 7 days; re-compose the same day keeps sent_at', () => {
    const s = fresh();
    const e = launch(s, 1);
    s.morningBrief.upsert({ id: 'lbr-2026-10-08', day: '2026-10-08', composedAt: iso(NOW.getTime() - 4 * 24 * H), items: [], dedupeKeys: [`new_launch:${e.id}`], text: '', sentAt: null, sentVia: null, sendError: null, dry: false });
    expect(selectBriefItems(s, NOW, '2026-10-12')).toHaveLength(0);
    const b = composeMorningBrief(s, { now: NOW, tz: 'UTC', dry: false, brainRoot: null });
    expect(b.items).toHaveLength(0);
    expect(b.text).toBe(`Morning brief, Monday 12 October. 0 items.\n${EMPTY_BRIEF}`);
    s.morningBrief.upsert({ ...b, sentAt: '2026-10-12T07:45:00.000Z', sentVia: 'wizard' });
    const again = composeMorningBrief(s, { now: new Date(NOW.getTime() + H), tz: 'UTC', dry: false, brainRoot: null });
    expect(again.sentAt).toBe('2026-10-12T07:45:00.000Z');
  });
});

describe('AC-05-30, AC-05-31 the Wizard hook', () => {
  const alive = (ageMs: number) => {
    const dir = path.join(home, '.config', 'wizard');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'alive');
    fs.writeFileSync(f, '');
    const t = new Date(NOW.getTime() - ageMs);
    fs.utimesSync(f, t, t);
  };
  const files = () => {
    const out: string[] = [];
    const walk = (d: string) => fs.existsSync(d) && fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.relative(home, path.join(d, e.name)).replace(/\\/g, '/'))));
    walk(home);
    return out.sort();
  };

  test('off by default: writes nothing', () => {
    const s = fresh();
    launch(s, 1);
    alive(60_000);
    const b = composeMorningBrief(s, { now: NOW, tz: 'UTC', dry: false, brainRoot: null });
    expect(sendMorningBriefToWizard(s, b, { now: NOW, home, env: {}, dry: false, tz: 'UTC' })).toEqual({ sent: false, reason: 'off' });
    expect(files()).toEqual(['.config/wizard/alive']);
  });

  test('on + alive: one file, atomically, in the 15 shape; never twice for a day', () => {
    const s = fresh();
    launch(s, 1);
    alive(60_000);
    const b = composeMorningBrief(s, { now: NOW, tz: 'UTC', dry: false, brainRoot: null });
    const r = sendMorningBriefToWizard(s, b, { now: NOW, home, env: { LAB_BRIEF_TELEGRAM: '1' }, dry: false, tz: 'UTC' });
    expect(r.sent).toBe(true);
    expect(files()).toEqual(['.config/wizard/alive', '.config/wizard/events/lab-brief-2026-10-12.json']);
    const j = JSON.parse(fs.readFileSync(briefFilePath('2026-10-12', home), 'utf8'));
    expect(Object.keys(j)).toEqual(['kind', 'day', 'composedAt', 'text', 'items', 'href']);
    expect(j).toMatchObject({ kind: 'lab_brief', day: '2026-10-12', href: '/lab/radar' });
    expect(j.items[0]).toEqual({ kind: 'new_launch', line: expect.any(String), href: expect.stringMatching(/^\/lab\/radar\?event=lev-/) });
    const stored = s.morningBrief.get('2026-10-12')!;
    expect(stored).toMatchObject({ sentVia: 'wizard', sentAt: NOW.toISOString() });
    expect(sendMorningBriefToWizard(s, stored, { now: NOW, home, env: { LAB_BRIEF_TELEGRAM: '1' }, dry: false, tz: 'UTC' })).toEqual({ sent: false, reason: 'already sent' });
  });

  test('on + stale alive: send_error set, nothing written', () => {
    const s = fresh();
    alive(11 * 60_000);
    expect(wizardAlive(home, NOW)).toBe(false);
    const b = composeMorningBrief(s, { now: NOW, tz: 'UTC', dry: false, brainRoot: null });
    expect(sendMorningBriefToWizard(s, b, { now: NOW, home, env: { LAB_BRIEF_TELEGRAM: '1' }, dry: false, tz: 'UTC' }).sent).toBe(false);
    expect(s.morningBrief.get('2026-10-12')!.sendError).toBe('Wizard not running');
    expect(files()).toEqual(['.config/wizard/alive']);
  });

  test('AC-05-31 the only file an alert path writes is events/lab-brief-*.json (fs spy)', async () => {
    const s = fresh();
    launch(s, 1);
    alive(60_000);
    const writes: string[] = [];
    const spyW = vi.spyOn(fs, 'writeFileSync').mockImplementation((p) => {
      writes.push(String(p));
    });
    const spyR = vi.spyOn(fs, 'renameSync').mockImplementation((_a, b) => {
      writes.push(String(b));
    });
    try {
      await runBrief(radarCtx(s, { now: NOW, dry: false, dryReason: null, env: { LAB_BRIEF_TELEGRAM: '1' }, home, tz: 'UTC', brainRoot: null }));
    } finally {
      spyW.mockRestore();
      spyR.mockRestore();
    }
    const outside = writes.filter((w) => !/events\/lab-brief-\d{4}-\d{2}-\d{2}\.json(\.\d+\.tmp)?$/.test(w.replace(/\\/g, '/')));
    expect(writes.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });
});

describe('AC-08-19 (05 share) brief job: switch off calls no sender, still composes', () => {
  test('off', async () => {
    const s = fresh();
    launch(s, 1);
    const r = await runBrief(radarCtx(s, { now: NOW, dry: false, dryReason: null, env: {}, home, tz: 'UTC', brainRoot }));
    expect(r).toMatchObject({ sent: false, reason: 'off' });
    expect(s.morningBrief.get('2026-10-12')).not.toBeNull();
    expect(fs.existsSync(path.join(home, '.config'))).toBe(false);
  });
});
