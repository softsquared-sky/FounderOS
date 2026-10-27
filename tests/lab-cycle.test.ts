import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabSource } from '@/lib/schemas';
import { invalidateModeCache } from '@/lib/paths';
import { analyse, discover, discoveryDue, scrape } from '@/lib/lab/pipeline';
import { buildLabView } from '@/lib/lab/view';
import { automationDirs, markScheduled, nextRunAt, pausedBy, scheduleLabel, SYNC_HOURS, touchSchedule } from '@/lib/lab/schedule';

/**
 * The dry end-to-end cycle (AC6): LAB_DRY=1, a blank store, owned and tracked sources on
 * three platforms. Scrape → transcribe → dissect → measure → discover → sample a suggestion
 * → rescore, twice, with zero paid calls: every run and ledger row is dry and 0-cost, and
 * the view builds from the result.
 */
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-cycle-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  process.env.LAB_DRY = '1';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const T0 = new Date('2026-10-10T06:00:00.000Z');
const src = (id: string, kind: LabSource['kind'], platform: LabSource['platform'], handle: string): LabSource => ({ id, kind, platform, handle, url: null, displayName: handle, status: 'active', addedAt: T0.toISOString(), reason: null, score: null });

function world(): LabStore {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  const s = labStore(db);
  s.sources.upsert(src('o-tt', 'owned', 'tiktok', 'studio.one'));
  s.sources.upsert(src('o-yt', 'owned', 'youtube', 'studioone'));
  s.sources.upsert(src('o-ig', 'owned', 'instagram', 'studio.one'));
  for (let i = 0; i < 3; i++) s.sources.upsert(src(`t-${i}`, 'tracked', 'tiktok', `maker.${i}`));
  return s;
}

describe('dry end-to-end cycle', () => {
  test('first cycle: 50 posts a source, profiles, transcripts, dissections, measures; every charge dry and 0', async () => {
    const s = world();
    const out = await scrape({ store: s, client: null, now: T0, scheduled: true });
    expect(out.runs.map((r) => [r.run.kind, r.run.actor, r.run.status])).toEqual([
      ['scrape', 'apify/instagram-post-scraper', 'succeeded'],
      ['scrape', 'clockworks/tiktok-scraper', 'succeeded'],
      ['scrape', 'streamers/youtube-scraper', 'succeeded'],
      ['profile', 'apify/instagram-profile-scraper', 'succeeded'],
    ]);
    expect(s.posts.count()).toBe(6 * 50);
    // one follower snapshot per source this cycle (TikTok and YouTube from the author block, Instagram from the profile run)
    expect(s.creatorSnapshots.all()).toHaveLength(6);

    const a = await analyse({ store: s, dry: true, stt: null, now: T0, scheduled: true, dissectLimit: 400, transcribeLimit: 400 });
    // v2 (04 5.2): a first cycle has no verdicts yet, so only owned posts are dissected
    expect(a.dissect.done).toBe(s.posts.all().filter((p) => p.isOwned).length);
    expect(a.dissect.failed).toBe(0);
    expect(a.transcribe.done).toBeGreaterThan(0);
    // owned posts all have a transcript row; YouTube's came free with the item
    const owned = s.posts.all().filter((p) => p.isOwned);
    expect(owned.every((p) => s.transcripts.get(p.id) !== null)).toBe(true);
    expect(s.transcripts.all().some((t) => t.provider === 'youtube-subtitles' && t.status === 'done')).toBe(true);
    // v2 (04 3.3): one read per post at a random age gives few age-matched ratios on a first cycle; every post still gets a row
    expect(a.measures.posts).toBe(300);
    expect(s.measures.all()).toHaveLength(300);
    expect(s.measures.all().every((m) => m.measureVersion === 'measure-v2')).toBe(true);
    expect(s.dissections.all().every((d) => d.promptVersion === 'dissect-v1.1' && d.modelId === 'dry-fixture')).toBe(true);

    expect(s.runs.recent(1000).every((r) => r.dry)).toBe(true);
    expect(s.spend.all().every((r) => r.dry && r.actualUsd === 0)).toBe(true);
    expect(s.runs.open()).toHaveLength(0);
  });

  test('second cycle six hours later: owned re-read (metrics appended, no new posts), tracked not due; discovery samples a suggestion', async () => {
    const s = world();
    await scrape({ store: s, client: null, now: T0, scheduled: true });
    await analyse({ store: s, dry: true, stt: null, now: T0, scheduled: true, dissectLimit: 400 });
    const reads = s.counts().lab_post_metrics;

    const T1 = new Date(T0.getTime() + 6 * 3_600_000);
    const second = await scrape({ store: s, client: null, now: T1, scheduled: true });
    expect(second.plan.scrapes.flatMap((g) => g.sources.map((x) => x.id)).sort()).toEqual(['o-ig', 'o-tt', 'o-yt']);
    // posts under 14 days old drive the depth: every one of them is re-read
    expect(second.plan.scrapes.every((g) => g.limit >= 15)).toBe(true);
    expect(s.posts.count()).toBe(300);
    expect(s.counts().lab_post_metrics).toBeGreaterThan(reads);

    expect(discoveryDue(s, T1)).toBe(true);
    const d = await discover({ store: s, client: null, now: T1, scheduled: true });
    expect(d.terms.length).toBeGreaterThan(0);
    const suggested = s.sources.all('suggested');
    expect(suggested.length).toBeGreaterThan(0);
    expect(discoveryDue(s, T1)).toBe(false);

    // the next cycle samples each suggestion once at 10 posts, then rescoring explains it
    const T2 = new Date(T1.getTime() + 6 * 3_600_000);
    const third = await scrape({ store: s, client: null, now: T2, scheduled: true });
    const sampled = third.plan.scrapes.filter((g) => g.limit === 10).flatMap((g) => g.sources);
    expect(sampled.map((x) => x.id).sort()).toEqual(suggested.map((x) => x.id).sort());
    expect(s.posts.bySource(suggested[0].id)).toHaveLength(10);
    await analyse({ store: s, dry: true, stt: null, now: T2, scheduled: true, dissectLimit: 400 });
    expect(s.sources.get(suggested[0].id)?.reason).toMatch(/of 10 sampled posts|10 posts sampled/);
    const T3 = new Date(T2.getTime() + 6 * 3_600_000);
    expect((await scrape({ store: s, client: null, now: T3, scheduled: true })).plan.scrapes.some((g) => g.limit === 10)).toBe(false);

    expect(s.spend.all().every((r) => r.dry && r.actualUsd === 0)).toBe(true);
  });

  test('the view builds from a dry-synced store: sources, runs, a run strip, ladders', async () => {
    const s = world();
    await scrape({ store: s, client: null, now: T0, scheduled: true });
    await analyse({ store: s, dry: true, stt: null, now: T0, scheduled: true, dissectLimit: 400 });
    const v = buildLabView(s, { configured: true, setupHref: '/integrations#apify', tab: 'all', now: T0, dry: true, dryReason: 'env', dryLabel: 'LAB_DRY=1 · fixtures, no charges' });
    expect(v.mode.state).not.toBe('not_configured');
    expect(v.sources?.owned).toHaveLength(3);
    expect(v.sources?.runs.length).toBeGreaterThan(4);
    expect(v.sources?.runs.every((r) => r.costText === 'dry')).toBe(true);
    expect(v.runStrip?.lanes.map((l) => l.id)).toEqual(expect.arrayContaining(['tiktok', 'youtube', 'instagram', 'transcribe', 'dissect']));
    expect(v.sources?.schedule.installed).toBe(false);
  });
});

describe('schedule and kill switch', () => {
  test('PAUSED or PAUSED-lab in any Automation folder stops the job', () => {
    const dirs = automationDirs({ GLADOS_AUTOMATION_DIR: '/auto' }, '/home/x');
    expect(dirs).toEqual(['/auto', path.join('/home/x', 'Sync/brain/Automation'), path.join('/home/x', 'Desktop/brain/Automation')]);
    expect(pausedBy(dirs, () => false)).toBeNull();
    expect(pausedBy(dirs, (p) => p === path.join('/home/x', 'Sync/brain/Automation/PAUSED-lab'))).toBe(path.join('/home/x', 'Sync/brain/Automation/PAUSED-lab'));
    expect(pausedBy(dirs, (p) => p === path.join('/auto', 'PAUSED'))).toBe(path.join('/auto', 'PAUSED'));
  });

  test('next fire time is the next listed local hour', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 10, h, m);
    expect(nextRunAt(at(5, 59)).getHours()).toBe(6);
    expect(nextRunAt(at(6, 0)).getHours()).toBe(12);
    const late = nextRunAt(at(23, 10));
    expect([late.getDate(), late.getHours()]).toEqual([11, 0]);
    expect(scheduleLabel(SYNC_HOURS)).toBe('Every 6 hours on this machine (00:00, 06:00, 12:00, 18:00)');
    expect(scheduleLabel()).toBe('Every 15 minutes on this machine');
  });

  test('mark-scheduled makes the Sources tab say installed; a sync moves nextAt forward', () => {
    const s = world();
    markScheduled(s, T0);
    const v = buildLabView(s, { configured: true, setupHref: '/integrations#apify', tab: 'sources', now: T0 });
    expect(v.sources?.schedule).toMatchObject({ installed: true, agent: 'glados.agent.lab', label: scheduleLabel() });
    const before = (s.priors.get('schedule')!.value as { nextAt: string }).nextAt;
    touchSchedule(s, new Date(T0.getTime() + 8 * 3_600_000));
    expect((s.priors.get('schedule')!.value as { nextAt: string }).nextAt > before).toBe(true);
  });

  // The plist template is private to the operator's host and not part of the public release.
  test.skipIf(!fs.existsSync(path.join(__dirname, '..', 'deploy', 'glados.agent.lab.plist')))('the plist template (v2 08.5.5): label, every 900 s, no calendar hours, no home path, not run at load', () => {
    const plist = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'glados.agent.lab.plist'), 'utf8');
    expect(plist).toContain('<string>glados.agent.lab</string>');
    expect(plist).toMatch(/<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
    expect(plist).not.toContain('StartCalendarInterval');
    expect(plist).toContain('__HOME__/projects/glados/deploy/lab-sync.sh');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
    expect(plist).not.toMatch(/\/Users\//);
    expect(fs.readFileSync(path.join(__dirname, '..', 'deploy', 'lab-sync.sh'), 'utf8')).toContain('scripts/lab-sync.ts tick');
  });
});
