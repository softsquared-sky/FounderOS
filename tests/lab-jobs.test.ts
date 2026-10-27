import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { LAB_JOB_IDS, type LabJobId } from '@/lib/schemas';
import { LAB_JOBS, runTick, takeLock, type JobResult, type LabJob } from '@/lib/lab/setup/jobs';
import { briefBody, type BriefDeps } from '@/lib/lab/setup/job-bodies';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'GLADOS_TZ', 'APIFY_API_TOKEN', 'LAB_FRAMES', 'LAB_COMMENTS', 'LAB_BRIEF_TELEGRAM'] as const;
let saved: Record<string, string | undefined>;
let dir: string;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-jobs-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  fs.writeFileSync(process.env.GLADOS_ENV_LOCAL, 'APIFY_API_TOKEN=apify_api_TESTONLY\n');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const SYD = 'Australia/Sydney';
/** Sydney wall clock in October 2026 (AEDT, UTC+11, after 4 Oct). */
const syd = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h - 11, m));

function seedSources(store: LabStore) {
  store.sources.upsert({ id: 'own-1', kind: 'owned', platform: 'instagram', handle: 'example.studio', url: null, displayName: 'Example Studio', status: 'active', addedAt: '2026-10-01T00:00:00Z', reason: null, score: null });
}

/** LAB_JOBS with fake bodies: each records its id; `items` per job id. */
function fakeJobs(calls: LabJobId[], items: Partial<Record<LabJobId, number>> = {}, throwing: LabJobId[] = []): LabJob[] {
  return LAB_JOBS.map((j) => ({
    ...j,
    run: async (): Promise<JobResult> => {
      calls.push(j.id);
      if (throwing.includes(j.id)) throw new Error(`${j.id} broke`);
      return { ok: true, detail: 'fake', items: items[j.id] ?? 0 };
    },
  }));
}

async function tick(store: LabStore, at: Date, calls: LabJobId[], o: { items?: Partial<Record<LabJobId, number>>; exists?: (p: string) => boolean; throwing?: LabJobId[]; only?: LabJobId[]; force?: boolean } = {}) {
  const before = calls.length;
  const res = await runTick(store, { now: at, dry: false, jobs: fakeJobs(calls, o.items, o.throwing), lockFile: null, exists: o.exists ?? (() => false), env: { ...process.env, GLADOS_TZ: SYD, GLADOS_AUTOMATION_DIR: '/auto', APIFY_API_TOKEN: 'x' }, only: o.only, force: o.force });
  return { res, ran: calls.slice(before) };
}

describe('AC-08-11: one scheduler', () => {
  test('every LAB_JOBS entry has a unique order 1 to 24 in the 08.5.1 order, an owner and a run function', () => {
    expect(LAB_JOBS.map((j) => j.id)).toEqual([...LAB_JOB_IDS]);
    expect(LAB_JOBS.map((j) => j.order)).toEqual(LAB_JOB_IDS.map((_, k) => k + 1));
    for (const j of LAB_JOBS) expect(typeof j.run).toBe('function');
    const owners = Object.fromEntries(LAB_JOBS.map((j) => [j.id, j.owner]));
    expect(owners).toMatchObject({ advance: '04', health: '08', 'radar.x': '05', brief: '05', snapshots: '04', 'ledger.early': '06', sync: '04', 'gen.embed': '07', intel: '07', ledger: '06' });
    expect(LAB_JOBS.filter((j) => j.pauseScope === 'radar').map((j) => j.order)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  test('sync: 05:50 then 06:05 runs once each slot; 06:20 and 06:35 do not; after a 9-hour sleep it runs once', async () => {
    const store = fresh();
    seedSources(store);
    const calls: LabJobId[] = [];
    const count = async (at: Date) => (await tick(store, at, calls)).ran.filter((x) => x === 'sync').length;
    expect(await count(syd(14, 5, 50))).toBe(1); // first ever tick: the 00:00 slot is owed
    expect(await count(syd(14, 6, 5))).toBe(1);
    expect(await count(syd(14, 6, 20))).toBe(0);
    expect(await count(syd(14, 6, 35))).toBe(0);
    expect(await count(syd(14, 15, 35))).toBe(1); // 12:00 missed; one run, not one per missed slot
    expect(await count(syd(14, 15, 50))).toBe(0);
  });

  test('snapshots every 30 min, radar.vendor every tick, radar.x once in 120 minutes', async () => {
    const store = fresh();
    seedSources(store);
    store.sources.upsert({ id: 'w-1', kind: 'watch', platform: 'x', handle: 'sample_lab', url: null, displayName: 'Sample Lab', status: 'active', addedAt: '2026-10-01T00:00:00Z', reason: null, score: null });
    const calls: LabJobId[] = [];
    const seen: LabJobId[][] = [];
    for (const m of [0, 15, 30, 45, 60, 75, 90, 105, 120]) seen.push((await tick(store, syd(14, 10, m), calls)).ran);
    expect(seen.map((r) => r.includes('snapshots'))).toEqual([true, false, true, false, true, false, true, false, true]);
    expect(seen.every((r) => r.includes('radar.vendor'))).toBe(true);
    expect(seen.map((r) => r.includes('radar.x'))).toEqual([true, false, false, false, false, false, false, false, true]);
  });

  test('brief once a day at the first tick at or after 07:30, ledger at 03:30, in Sydney wall time', async () => {
    const store = fresh();
    const calls: LabJobId[] = [];
    const at = async (d: number, h: number, m: number) => (await tick(store, syd(d, h, m), calls)).ran;
    await at(14, 7, 15); // first ever tick: yesterday's 07:30 slot is owed
    expect((await at(14, 7, 30)).includes('brief')).toBe(true);
    expect((await at(14, 7, 45)).includes('brief')).toBe(false);
    expect((await at(15, 7, 15)).includes('brief')).toBe(false);
    expect((await at(15, 7, 30)).includes('brief')).toBe(true);
    expect((await at(16, 3, 15)).includes('ledger')).toBe(false);
    expect((await at(16, 3, 30)).includes('ledger')).toBe(true);
    expect((await at(16, 3, 45)).includes('ledger')).toBe(false);
  });

  test('measure.verdicts, analyse and gen.frames run only in ticks where advance reported items', async () => {
    process.env.LAB_FRAMES = '1';
    const store = fresh();
    const calls: LabJobId[] = [];
    const quiet = (await tick(store, syd(14, 10, 0), calls)).ran;
    expect(quiet).not.toContain('measure.verdicts');
    expect(quiet).not.toContain('analyse');
    expect(quiet).not.toContain('gen.frames');
    const busy = (await tick(store, syd(14, 10, 15), calls, { items: { advance: 12, analyse: 3 } })).ran;
    expect(busy).toContain('measure.verdicts');
    expect(busy).toContain('analyse');
    expect(busy).toContain('gen.frames');
    expect(busy).toContain('intel');
  });

  test('PAUSED-radar skips the radar scope and sync still runs; PAUSED-lab runs nothing', async () => {
    const store = fresh();
    seedSources(store);
    const calls: LabJobId[] = [];
    const r = await tick(store, syd(14, 6, 5), calls, { exists: (p) => p === path.join('/auto', 'PAUSED-radar') });
    expect(r.ran).toContain('sync');
    expect(r.ran.filter((id) => id.startsWith('radar.') || id === 'brief')).toEqual([]);
    expect(r.res.skipped['radar.vendor']).toBe('Paused by PAUSED-radar');
    const p = await tick(fresh(), syd(14, 6, 5), calls, { exists: (x) => x === path.join('/auto', 'PAUSED-lab') });
    expect(p.ran).toEqual([]);
    expect(p.res.paused).toBe(path.join('/auto', 'PAUSED-lab'));
  });

  test('a throwing job does not stop later jobs; its state counts the failure', async () => {
    const store = fresh();
    seedSources(store);
    const calls: LabJobId[] = [];
    const r = await tick(store, syd(14, 6, 5), calls, { throwing: ['health'] });
    expect(r.ran).toContain('health');
    expect(r.ran).toContain('sync');
    expect(r.res.ran.health).toEqual({ ok: false, detail: 'health broke' });
    expect((store.priors.get('job:health')!.value as { fails: number }).fails).toBe(1);
    expect((store.priors.get('job:tick')!.value as { lastOkAt: string }).lastOkAt).toBeTruthy();
  });

  test('the lock: a live tick younger than 50 minutes holds it; a stale lock is removed and reported', () => {
    const store = fresh();
    const file = path.join(dir, 'lab-tick.lock');
    const now = new Date('2026-10-14T00:00:00Z');
    const release = takeLock(file, now, store)!;
    expect(takeLock(file, new Date(now.getTime() + 10 * 60_000), store)).toBeNull();
    release();
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date(now.getTime() - 60 * 60_000).toISOString() }));
    const again = takeLock(file, now, store);
    expect(again).not.toBeNull();
    expect(store.priors.get('schedule:lock_removed')).toBeTruthy();
    again!();
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('AC-08-19: the Telegram brief is off by default', () => {
  const spies = () => {
    const calls = { compose: 0, send: 0 };
    const deps = (telegram: boolean, alive: boolean): BriefDeps => ({ compose: () => (calls.compose++, { items: 3 }), send: () => void calls.send++, wizardAlive: () => alive, telegramOn: () => telegram });
    return { calls, deps };
  };
  test('unset: the brief is composed and no sender is called', async () => {
    const { calls, deps } = spies();
    await briefBody({ store: fresh(), now: new Date(), scheduled: true, dry: false }, deps(false, true));
    expect(calls).toEqual({ compose: 1, send: 0 });
  });
  test('on and the Wizard alive: sent once', async () => {
    const { calls, deps } = spies();
    await briefBody({ store: fresh(), now: new Date(), scheduled: true, dry: false }, deps(true, true));
    expect(calls).toEqual({ compose: 1, send: 1 });
    await briefBody({ store: fresh(), now: new Date(), scheduled: true, dry: false }, deps(true, false));
    expect(calls).toEqual({ compose: 2, send: 1 });
  });
  test('no radar:brief_telegram string under lib/ or app/', () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('radar:brief_telegram')) hits.push(p);
      }
    };
    walk(path.join(process.cwd(), 'lib'));
    walk(path.join(process.cwd(), 'app'));
    expect(hits).toEqual([]);
  });
});
