import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL, LAB_V2_COLUMNS, migrateLabV2 } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { setLabFetchImpl } from '@/lib/lab/net';
import type { ApifyClient } from '@/lib/lab/apify-client';
import { LAB_JOBS } from '@/lib/lab/setup/jobs';
import { pausedBy } from '@/lib/lab/schedule';
import { RADAR_JOBS, RADAR_CADENCE, cadenceDue, xPollMinutes } from '@/lib/lab/radar/jobs';
import { radarCtx, runRadarEvents, runRadarNow, runSource } from '@/lib/lab/radar/run';
import { X_ACTOR } from '@/lib/lab/radar/config';
import { advanceRuns } from '@/lib/lab/sync';
import { radarView, windowCardView, NEVER_RUN_SENTENCE } from '@/lib/lab/radar/view';
import { newEvent } from '@/lib/lab/radar/events';
import { seedLabFixtures } from '@/lib/lab/fixtures';
import { persistRadarFixtures } from '@/lib/lab/radar/fixtures';
import { TWEETS } from './fixtures/radar/samples';

const KEYS = ['GLADOS_DB', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'LAB_DRY', 'APIFY_API_TOKEN', 'GITHUB_TOKEN', 'PRODUCTHUNT_TOKEN', 'GLADOS_AUTOMATION_DIR'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-radar-'));
  for (const k of KEYS) delete process.env[k];
  process.env.GLADOS_DB = path.join(dir, 'test.db');
  fs.writeFileSync(path.join(dir, '.env.local'), 'APIFY_API_TOKEN=\nGITHUB_TOKEN=\nPRODUCTHUNT_TOKEN=\n');
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.GLADOS_AUTOMATION_DIR = path.join(dir, 'Automation');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
  // Finish the cold route transform after hermetic environment setup. The API
  // assertion retains its normal deadline and never calls a live provider.
  await import('@/app/api/lab/radar/route');
}, 120_000);
afterAll(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
  setLabFetchImpl(null);
});
beforeEach(() => delete process.env.LAB_DRY);
afterEach(() => setLabFetchImpl(null));

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = new Date('2026-10-11T10:00:00Z');
const radarRows = (s: LabStore) => ({ events: s.events.all().length, pings: s.eventPings.all().length, coverage: s.eventCoverage.all().length });
const OPTS = { dry: false, sample: false, paused: null, tz: 'UTC', apifyConfigured: false, githubToken: false, phToken: false, env: {} };

describe('AC-05-3 dry: zero fetch calls, nothing written to lab_event*', () => {
  test('runRadarNow and every radar job body', async () => {
    process.env.LAB_DRY = '1';
    const spy = vi.fn(async () => {
      throw new Error('network');
    });
    setLabFetchImpl(spy);
    const global = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network');
    });
    try {
      const s = fresh();
      const r = await runRadarNow(s, { now: NOW, paused: null, apifyToken: 'token', ask: {} });
      expect(r.dry).toBe(true);
      expect(r.errors).toEqual([]);
      for (const job of RADAR_JOBS.filter((j) => j.id !== 'brief')) await job.run({ store: s, now: NOW, scheduled: true, dry: true });
      expect(spy).not.toHaveBeenCalled();
      expect(global).not.toHaveBeenCalled();
      expect(radarRows(s)).toEqual({ events: 0, pings: 0, coverage: 0 });
      // runs are logged with dry = 1
      const runs = s.runs.recent(100).filter((x) => x.kind === 'radar');
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every((x) => x.dry)).toBe(true);
    } finally {
      global.mockRestore();
    }
  });
});

describe('AC-05-4 Filming: fixtures persist with dry = 1', () => {
  test('a Filming run on an empty world persists the 05 18 fixtures; the full world pings are dry', async () => {
    const s = fresh();
    const r = await runSource(radarCtx(s, { now: NOW, dry: true, dryReason: 'filming' }), 'hn');
    expect(r.status).toBe('ran');
    expect(s.events.all().map((e) => e.name).sort()).toEqual(['Sample 6.1', 'Sample Agent Kit', 'Sample Model 7', 'Sample Plugin']);
    expect(s.eventPings.all().every((p) => p.dry)).toBe(true);
    expect(persistRadarFixtures(s, NOW)).toEqual({ events: 0, pings: 0 });
    const w = fresh();
    seedLabFixtures(w, NOW);
    expect(w.eventPings.all().every((p) => p.dry)).toBe(true);
    expect(w.morningBrief.latest()!.dry).toBe(true);
  });
});

describe('AC-05-5 cadences equal the radar rows of LAB_JOBS', () => {
  test('registered rows 4 to 14, owner 05, pause scope radar', () => {
    const radar = LAB_JOBS.filter((j) => j.owner === '05');
    expect(radar.map((j) => [j.id, j.order])).toEqual([
      ['radar.vendor', 4], ['radar.hn', 5], ['radar.hf_models', 6], ['radar.hf_spaces', 7], ['radar.github', 8], ['radar.x', 9],
      ['radar.producthunt', 10], ['radar.tiktok_cc', 11], ['radar.wikipedia', 12], ['radar.events', 13], ['brief', 14],
    ]);
    expect(radar.every((j) => j.pauseScope === 'radar')).toBe(true);
    expect(LAB_JOBS.find((j) => j.id === 'radar.x')!.lines).toEqual(['apify.radar_x']);
  });
  test('every N minutes (60 s slack) and daily after HH:MM local', () => {
    const st = (lastAt: string | null) => ({ lastAt, lastOkAt: lastAt, lastDetail: '', fails: 0, skippedReason: null });
    const t = Date.parse('2026-10-11T10:00:00Z');
    const due = (s: 'vendor' | 'hn' | 'hf_models' | 'github' | 'x', mins: number) => cadenceDue(s, st(iso(t - mins * 60_000)), new Date(t), { tz: 'UTC', env: {} });
    expect(RADAR_CADENCE).toMatchObject({ vendor: { everyMin: 15 }, hn: { everyMin: 30 }, hf_models: { everyMin: 60 }, hf_spaces: { everyMin: 60 }, github: { everyMin: 60 } });
    expect([due('vendor', 14), due('vendor', 15)]).toEqual([true, true]);
    expect([due('vendor', 13), due('hn', 29), due('hn', 30), due('hf_models', 58), due('github', 60)]).toEqual([false, true, true, false, true]);
    expect([due('x', 118), due('x', 120)]).toEqual([false, true]);
    expect(xPollMinutes(null, { LAB_X_POLL_MIN: '30' })).toBe(60);
    expect(xPollMinutes(null, {})).toBe(120);
    expect(xPollMinutes({ mode: 'interval', everyMin: 240 }, {})).toBe(240);
    const daily = (s: 'producthunt' | 'tiktok_cc' | 'wikipedia', at: string, last: string | null) => cadenceDue(s, st(last), new Date(at), { tz: 'Australia/Sydney', env: {} });
    // 09:00 Sydney = 22:00Z the day before (AEDT, UTC+11)
    expect(daily('producthunt', '2026-10-11T21:50:00Z', '2026-10-10T22:05:00Z')).toBe(false);
    expect(daily('producthunt', '2026-10-11T22:05:00Z', '2026-10-10T22:05:00Z')).toBe(true);
    expect(daily('producthunt', '2026-10-11T22:20:00Z', '2026-10-11T22:05:00Z')).toBe(false);
    expect(daily('wikipedia', '2026-10-11T20:05:00Z', null)).toBe(true);
  });
});

describe('AC-05-7 pause scopes', () => {
  test('PAUSED-radar stops radar, not the sync; PAUSED-lab stops all', async () => {
    const dirs = ['/auto'];
    const only = (f: string) => (p: string) => p === path.join('/auto', f);
    expect(pausedBy(dirs, only('PAUSED-radar'), 'radar')).toBe(path.join('/auto', 'PAUSED-radar'));
    expect(pausedBy(dirs, only('PAUSED-radar'), 'lab')).toBeNull();
    expect(pausedBy(dirs, only('PAUSED-lab'), 'lab')).toBe(path.join('/auto', 'PAUSED-lab'));
    expect(pausedBy(dirs, only('PAUSED-lab'), 'radar')).toBe(path.join('/auto', 'PAUSED-lab'));
    const s = fresh();
    const r = await runRadarNow(s, { now: NOW, paused: '/auto/PAUSED-radar' });
    expect(r.ran).toEqual([]);
    expect(r.skipped[0].reason).toBe('Paused by PAUSED-radar');
    expect(radarView(s, NOW, { ...OPTS, paused: '/auto/PAUSED-radar' }).sources.every((x) => x.status === 'paused')).toBe(true);
  });
});

describe('AC-05-32 paid sources through the gate', () => {
  test('at the line cap a scheduled tick records blocked and the free sources still run', async () => {
    const s = fresh();
    s.spend.add({ runId: null, provider: 'apify', line: 'apify.radar_tiktok', units: 0, estUsd: 3, actualUsd: 3, dry: false, at: iso(NOW.getTime() - H) });
    const client = { startRun: vi.fn() } as unknown as ApifyClient;
    const ctx = radarCtx(s, { now: NOW, dry: false, dryReason: null, scheduled: true, apifyToken: 'token', client, fetch: async () => ({ ok: true, status: 200, json: async () => ({ hits: [], nbPages: 1 }), text: async () => '' }) });
    const paid = await runSource(ctx, 'tiktok_cc');
    expect(paid.status).toBe('blocked');
    expect(client.startRun).not.toHaveBeenCalled();
    const blocked = s.runs.recent(10).find((r) => r.status === 'blocked')!;
    expect(blocked).toMatchObject({ kind: 'radar', line: 'apify.radar_tiktok', actor: 'rastriq/tiktok-trends-scraper', scheduled: true });
    expect((await runSource(ctx, 'hn')).status).toBe('ran');
  });

  test('a paid start sends line and kind radar, and the run stays pending for advance', async () => {
    const s = fresh();
    s.sources.upsert({ id: 'w1', kind: 'watch', platform: 'x', handle: 'samplelabs', url: null, displayName: 'samplelabs', status: 'active', addedAt: iso(NOW.getTime()), reason: null, score: null });
    const startRun = vi.fn(async () => ({ id: 'apify-run-1', actId: null, status: 'RUNNING' as const, startedAt: null, finishedAt: null, defaultDatasetId: 'ds-1', usageTotalUsd: null, itemCount: null }));
    const client = { startRun } as unknown as ApifyClient;
    const r = await runSource(radarCtx(s, { now: NOW, dry: false, dryReason: null, scheduled: true, apifyToken: 'token', client }), 'x');
    expect(r.status).toBe('ran');
    expect(startRun).toHaveBeenCalledWith(X_ACTOR, { searchTerms: ['(from:samplelabs) -filter:replies'], maxItems: 100, sort: 'Latest' }, expect.objectContaining({ maxItems: 100 }));
    const run = s.runs.get(r.runId!)!;
    expect(run).toMatchObject({ kind: 'radar', line: 'apify.radar_x', status: 'running', apifyRunId: 'apify-run-1' });
    // single-run guard: a second X poll defers with no run row
    const again = await runSource(radarCtx(s, { now: NOW, dry: false, dryReason: null, scheduled: true, apifyToken: 'token', client }), 'x');
    expect(again.status).toBe('deferred');
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  test('the API answers 402 without override', async () => {
    const { getDb } = await import('@/lib/data');
    const store = getDb().lab;
    store.spend.add({ runId: null, provider: 'apify', line: 'apify.radar_tiktok', units: 0, estUsd: 3, actualUsd: 3, dry: false, at: new Date().toISOString() });
    fs.writeFileSync(process.env.GLADOS_ENV_LOCAL!, 'APIFY_API_TOKEN=test-token-not-real\nGITHUB_TOKEN=\nPRODUCTHUNT_TOKEN=\n');
    fs.mkdirSync(process.env.GLADOS_AUTOMATION_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.GLADOS_AUTOMATION_DIR!, 'PAUSED-radar'), '');
    const { POST } = await import('@/app/api/lab/radar/route');
    try {
      // paused: nothing runs, nothing is spent (the route stays honest without a network)
      const paused = await POST(new Request('http://localhost/api/lab/radar', { method: 'POST', body: JSON.stringify({ action: 'run' }) }));
      expect(paused.status).toBe(200);
      fs.rmSync(path.join(process.env.GLADOS_AUTOMATION_DIR!, 'PAUSED-radar'));
      // every source off except tiktok so the run makes no network call
      for (const src of ['hn', 'hf_models', 'hf_spaces', 'github', 'vendor', 'x', 'producthunt', 'wikipedia']) {
        await POST(new Request('http://localhost/api/lab/radar', { method: 'POST', body: JSON.stringify({ action: 'disable', source: src }) }));
      }
      setLabFetchImpl(async () => {
        throw new Error('no network in tests');
      });
      const res = await POST(new Request('http://localhost/api/lab/radar', { method: 'POST', body: JSON.stringify({ action: 'run' }) }));
      expect(res.status).toBe(402);
      const j = await res.json();
      expect(j).toMatchObject({ cap: true, line: 'apify.radar_tiktok' });
    } finally {
      fs.writeFileSync(process.env.GLADOS_ENV_LOCAL!, 'APIFY_API_TOKEN=\nGITHUB_TOKEN=\nPRODUCTHUNT_TOKEN=\n');
    }
  });
});

describe('AC-05-33 advanceRuns routes radar actors to ingestRadarRun', () => {
  test('a finished X watch run becomes pings, not posts, and settles', async () => {
    const s = fresh();
    s.runs.insert({ id: 'lrun-x', kind: 'radar', apifyRunId: 'ar-1', datasetId: 'ds-1', actor: X_ACTOR, input: {}, status: 'running', items: null, costUsd: null, dry: false, startedAt: iso(NOW.getTime() - H), finishedAt: null, error: null, line: 'apify.radar_x', job: 'radar.x', scheduled: true, batchId: null, progress: null });
    s.spend.add({ runId: 'lrun-x', provider: 'apify', line: 'apify.radar_x', units: 0, estUsd: null, actualUsd: null, dry: false, at: iso(NOW.getTime() - H) });
    const client = {
      getRun: async () => ({ id: 'ar-1', actId: null, status: 'SUCCEEDED' as const, startedAt: null, finishedAt: null, defaultDatasetId: 'ds-1', usageTotalUsd: 0.04, itemCount: 2 }),
      datasetItems: async () => TWEETS,
    } as unknown as ApifyClient;
    const r = await advanceRuns(s, client, { now: NOW });
    expect(r.finished).toBe(1);
    expect(s.posts.count()).toBe(0);
    expect(s.eventPings.all().map((p) => p.id).sort()).toEqual(['x:1900000000000000001', 'x:1900000000000000002']);
    expect(s.eventPings.get('x:1900000000000000001')).toMatchObject({ family: 'vendor', isLaunch: true, qualifies: true });
    expect(s.runs.get('lrun-x')).toMatchObject({ status: 'succeeded', costUsd: 0.04 });
  });
});

describe('AC-05-35, AC-05-36 views', () => {
  test('blank store: never_run everywhere', () => {
    const s = fresh();
    const v = radarView(s, NOW, OPTS);
    expect(v).toMatchObject({ state: 'never_run', events: [], candidates: [], liveAlerts: 0 });
    expect(windowCardView(s, NOW, OPTS)).toEqual({ kind: 'never_run', sentence: NEVER_RUN_SENTENCE, setupHref: '/lab?setup=sources' });
  });
  test('fixture events never show outside dry, Filming or sample', () => {
    const s = fresh();
    persistRadarFixtures(s, NOW);
    expect(radarView(s, NOW, OPTS).events).toEqual([]);
    expect(radarView(s, NOW, { ...OPTS, dry: true }).events.map((e) => e.name)).toEqual(['Sample Agent Kit', 'Sample Model 7', 'Sample 6.1']);
    expect(radarView(s, NOW, { ...OPTS, sample: true }).state).toBe('sample');
  });
  test('windowCardView none, open, closing with the 17.2 copy', () => {
    const s = fresh();
    s.priors.set({ key: 'job:radar.vendor', value: { lastAt: iso(NOW.getTime() - 5 * 60_000), lastOkAt: null, lastDetail: '', fails: 0, skippedReason: null }, n: 0, supersedesDefault: false, updatedAt: iso(NOW.getTime()) });
    expect(windowCardView(s, NOW, OPTS)).toEqual({ kind: 'none', sentence: 'No open windows. Next check 10:15.' });
    const t0 = NOW.getTime() - 9 * H;
    const e = newEvent('Sample Model 7', iso(t0), NOW, { status: 'confirmed', t0: iso(t0), windowState: 'open', windowOpensAt: iso(t0), windowClosingAt: iso(t0 + 72 * H), windowClosesAt: iso(t0 + 168 * H) });
    s.events.upsert(e);
    const open = windowCardView(s, NOW, OPTS);
    expect(open).toMatchObject({ kind: 'open', eventId: e.id, sentence: 'Sample Model 7 shipped 9h ago. 0 of 0 creators have covered it. Window open.', action: { label: 'Make this', href: `/lab/radar?event=${e.id}` } });
    s.events.upsert({ ...e, windowState: 'closing' });
    expect(windowCardView(s, NOW, OPTS)).toMatchObject({ kind: 'closing', sentence: 'Sample Model 7 is 9h old. 0 of 0 creators are in. Window closing.' });
  });
});

describe('AC-05-37, AC-05-34 routes', () => {
  test('make is an unknown action (400); GET answers 200 never_run on a blank DB', async () => {
    const { POST, GET } = await import('@/app/api/lab/radar/route');
    const res = await POST(new Request('http://localhost/api/lab/radar', { method: 'POST', body: JSON.stringify({ action: 'make', id: 'x' }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown action: make');
    const brief = await (await import('@/app/api/lab/morning-brief/route')).GET(new Request('http://localhost/api/lab/morning-brief'));
    expect(brief.status).toBe(200);
    expect(await brief.json()).toMatchObject({ state: 'never_run', items: [] });
    const g = await GET(new Request('http://localhost/api/lab/radar'));
    expect(g.status).toBe(200);
  });
});

describe('AC-05-38 not configured sources carry a SetupLink href', () => {
  test('X without watch rows, Apify sources without a token, GitHub without a token', () => {
    const s = fresh();
    const src = new Map(radarView(s, NOW, OPTS).sources.map((x) => [x.source, x]));
    expect(src.get('x')).toMatchObject({ status: 'not_configured', note: 'Apify: Not configured', setupHref: expect.stringContaining('apify') });
    expect(src.get('tiktok_cc')).toMatchObject({ status: 'not_configured', note: 'Apify: Not configured' });
    expect(src.get('github')).toMatchObject({ note: expect.stringMatching(/^GitHub token: Not configured\./), setupHref: '/lab?setup=keys' });
    const withApify = new Map(radarView(s, NOW, { ...OPTS, apifyConfigured: true }).sources.map((x) => [x.source, x]));
    expect(withApify.get('x')).toMatchObject({ status: 'not_configured', note: 'X watch list: Not configured', setupHref: '/lab?setup=sources' });
    expect(withApify.get('tiktok_cc')!.status).toBe('never_run');
  });
});

describe('AC-05-39 lab_ideas migration is idempotent', () => {
  test('event_id and launch_angle are v2 columns; migrating twice is a no-op', () => {
    expect(LAB_V2_COLUMNS.some((c) => c.table === 'lab_ideas' && c.column === 'event_id')).toBe(true);
    expect(LAB_V2_COLUMNS.some((c) => c.table === 'lab_ideas' && c.column === 'launch_angle')).toBe(true);
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    migrateLabV2(db);
    migrateLabV2(db);
    const cols = (db.prepare('PRAGMA table_info(lab_ideas)').all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === 'event_id' || c === 'launch_angle')).toEqual(['event_id', 'launch_angle']);
  });
});

describe('the event pipeline end to end (live branch, injected fetch)', () => {
  test('HN plus HF confirm an event; coverage and the view follow', async () => {
    const s = fresh();
    const hn = { hits: [{ objectID: '1', title: 'Sample Model 7: an open-weights LLM', url: 'https://example.com/m7', points: 400, created_at: iso(NOW.getTime() - 2 * H) }], nbPages: 1 };
    const hf = [{ id: 'samplelab/Sample-Model-7-32B', trendingScore: 900, createdAt: iso(NOW.getTime() - 24 * H) }];
    const f = async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes('algolia') ? hn : hf), text: async () => '' });
    const ctx = radarCtx(s, { now: NOW, dry: false, dryReason: null, fetch: f, ask: {} });
    await runSource(ctx, 'hn');
    await runSource(ctx, 'hf_models');
    const r = await runRadarEvents(ctx);
    expect(r.created).toBe(1);
    expect(r.confirmed).toBe(1);
    const e = s.events.all()[0];
    expect(e).toMatchObject({ key: 'sample-7', status: 'confirmed', t0Rule: 'two_sources', windowState: 'open', novelty: null });
    const v = radarView(s, NOW, OPTS);
    expect(v.state).toBe('ok');
    expect(v.events[0]).toMatchObject({ name: 'Sample Model 7', classLabel: 'Class decided at 96h', coverage: { label: '0 of 0 creators' } });
  });
});
