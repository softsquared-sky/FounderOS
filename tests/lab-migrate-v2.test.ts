import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { LAB_DDL, LAB_FORECASTS_TRIGGER_DDL, LAB_SCHEMA_VERSION, LAB_V2_COLUMNS, LAB_V2_DDL, LEDGER_TRIGGERS_DDL, lab_meta_version, migrateLabV2, openDb } from '@/lib/db';
import { LAB_TABLES, labStore } from '@/lib/lab/store';

/**
 * AC-08-22 (and the DDL half of AC-04-34): a v1 database migrates to v2 once, idempotently,
 * keeping every v1 row; v1 apify spend backfills to line apify.sync; schema_version is 2.
 */

/** The v1 LAB_DDL, exactly: LAB_DDL without the v2 tables and triggers S0 appended. */
const V1_DDL = LAB_DDL.replace(LAB_V2_DDL, '').replace(LEDGER_TRIGGERS_DDL, '').replace(LAB_FORECASTS_TRIGGER_DDL, '');

const NEW_TABLES = ['lab_controls', 'lab_events', 'lab_event_pings', 'lab_event_coverage', 'lab_brief', 'lab_predictions', 'lab_evals', 'lab_retention', 'lab_tests', 'lab_embeddings', 'lab_comments', 'lab_forecasts'];

function v1Database() {
  const db = new Database(':memory:');
  db.exec(V1_DDL);
  const ins = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);
  ins("INSERT INTO lab_sources (id, kind, platform, handle, display_name, status, added_at) VALUES ('s1', 'owned', 'tiktok', 'example.studio', 'Example Studio', 'active', '2026-09-01T00:00:00.000Z')");
  ins("INSERT INTO lab_posts (id, source_id, platform, external_id, url, posted_at, caption, is_owned) VALUES ('p1', 's1', 'tiktok', 'x1', 'https://example.com/x1', '2026-10-01T10:00:00.000Z', 'c', 1)");
  ins("INSERT INTO lab_posts (id, source_id, platform, external_id, url, posted_at, caption, is_owned) VALUES ('p2', 's1', 'tiktok', 'x2', 'https://example.com/x2', NULL, 'c', 1)");
  ins("INSERT INTO lab_post_metrics (post_id, captured_at, views, likes, comments, shares, saves) VALUES ('p1', '2026-10-02T10:00:00.000Z', 1000, 50, 5, 2, 1)");
  ins("INSERT INTO lab_post_metrics (post_id, captured_at, views, likes, comments, shares, saves) VALUES ('p1', '2026-10-01T16:00:00.000Z', 400, 20, 2, 1, 0)");
  ins("INSERT INTO lab_post_metrics (post_id, captured_at, views, likes, comments, shares, saves) VALUES ('p2', '2026-10-02T10:00:00.000Z', 10, 1, 0, 0, 0)");
  ins("INSERT INTO lab_measures (post_id, breakout, baseline_n, is_breakout, computed_at) VALUES ('p1', 3.4, 9, 1, '2026-10-03T00:00:00.000Z')");
  ins("INSERT INTO lab_ideas (id, title, format_family, created_at) VALUES ('i1', 'An idea', 'tutorial_walkthrough', '2026-10-03T00:00:00.000Z')");
  ins("INSERT INTO lab_dissections (post_id, format, hook_form, emotional_trigger, hook_channel, structure_type, pacing, pillar, cta_type, model_id, prompt_version, analysed_at) VALUES ('p1', 'talking_head', 'contrarian', 'curiosity', 'spoken', 'hot_take', 'punchy', 'educational', 'follow', 'm', 'dissect-v1', '2026-10-02T00:00:00.000Z')");
  ins("INSERT INTO lab_profiles (id, format_family, version, created_at) VALUES ('pr1', 'talking_head', 1, '2026-10-03T00:00:00.000Z')");
  ins("INSERT INTO lab_runs (id, kind, status, dry, started_at) VALUES ('r1', 'scrape', 'succeeded', 0, '2026-10-02T00:00:00.000Z')");
  ins("INSERT INTO lab_spend (run_id, provider, units, est_usd, actual_usd, dry, at) VALUES ('r1', 'apify', 10, NULL, 0.42, 0, '2026-10-02T00:05:00.000Z')");
  ins("INSERT INTO lab_spend (run_id, provider, units, est_usd, actual_usd, dry, at) VALUES ('r2', 'apify', 10, NULL, NULL, 0, '2026-10-02T01:00:00.000Z')");
  ins("INSERT INTO lab_spend (run_id, provider, units, est_usd, actual_usd, dry, at) VALUES ('r3', 'apify', 10, 0, 0, 1, '2026-10-02T02:00:00.000Z')");
  ins("INSERT INTO lab_spend (run_id, provider, units, est_usd, actual_usd, dry, at) VALUES ('r4', 'stt', 1, NULL, 0.07, 0, '2026-10-02T03:00:00.000Z')");
  return db;
}

const columns = (db: InstanceType<typeof Database>, table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
const snapshot = (db: InstanceType<typeof Database>) => ({
  schema: db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(),
  rows: Object.fromEntries(['lab_posts', 'lab_post_metrics', 'lab_measures', 'lab_ideas', 'lab_spend', 'lab_runs', 'lab_profiles', 'lab_dissections'].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),
  priors: db.prepare("SELECT key, value_json FROM lab_priors ORDER BY key").all(),
});

describe('migrateLabV2 (08.11.2)', () => {
  test('a v1 database migrates once: new tables, every LAB_V2_COLUMNS column, backfills, schema_version 2', () => {
    const db = v1Database();
    expect(lab_meta_version(db)).toBe(1);
    for (const t of NEW_TABLES) expect(columns(db, t).size).toBe(0);
    // what getDb() does: LAB_DDL (adds the new tables) then the one migration
    db.exec(LAB_DDL);
    migrateLabV2(db);
    for (const t of NEW_TABLES) expect(columns(db, t).size).toBeGreaterThan(0);
    for (const c of LAB_V2_COLUMNS) expect(columns(db, c.table).has(c.column), `${c.table}.${c.column}`).toBe(true);
    expect(lab_meta_version(db)).toBe(LAB_SCHEMA_VERSION);
    expect(LAB_SCHEMA_VERSION).toBe(2);

    const spend = db.prepare('SELECT run_id, line, actual_source, settled_at, at FROM lab_spend ORDER BY id').all() as { run_id: string; line: string; actual_source: string | null; settled_at: string | null; at: string }[];
    expect(spend.map((r) => [r.run_id, r.line, r.actual_source])).toEqual([
      ['r1', 'apify.sync', 'provider'],
      ['r2', 'apify.sync', null],
      ['r3', 'apify.sync', 'dry'],
      ['r4', 'stt', 'provider'],
    ]);
    expect(spend[0].settled_at).toBe(spend[0].at);

    // 04: age_h backfilled from posted_at; a post with no posted_at keeps null
    const ages = db.prepare('SELECT post_id, captured_at, age_h, read_kind FROM lab_post_metrics ORDER BY post_id, captured_at').all() as { post_id: string; age_h: number | null; read_kind: string }[];
    expect(ages.map((a) => [a.post_id, a.age_h === null ? null : Math.round(a.age_h * 1000) / 1000, a.read_kind])).toEqual([
      ['p1', 6, 'cycle'],
      ['p1', 24, 'cycle'],
      ['p2', null, 'cycle'],
    ]);
    // indexes on new columns
    const idx = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name));
    for (const name of ['lab_post_metrics_age', 'lab_ideas_batch', 'lab_runs_batch']) expect(idx.has(name)).toBe(true);
  });

  test('a second run is a no-op (schema and every row byte-identical)', () => {
    const db = v1Database();
    db.exec(LAB_DDL);
    migrateLabV2(db);
    const once = snapshot(db);
    db.exec(LAB_DDL);
    migrateLabV2(db);
    expect(snapshot(db)).toEqual(once);
  });

  test('every v1 row still reads through the store, with the v2 defaults filled', () => {
    const db = v1Database();
    db.exec(LAB_DDL);
    const s = labStore(db); // labStore runs the same migration itself
    expect(s.posts.get('p1')).toMatchObject({ id: 'p1', epoch: 'current', exoReason: null });
    expect(s.metrics.forPost('p1')).toHaveLength(2);
    expect(s.metrics.forPost('p1')[0]).toMatchObject({ readKind: 'cycle', ageH: expect.any(Number), targetAgeH: null, quotes: null });
    expect(s.measures.get('p1')).toMatchObject({ breakout: 3.4, isBreakout: true, measureVersion: 'measure-v1', metricBasis: 'views', dualHigh: false, ages: {} });
    expect(s.ideas.get('i1')).toMatchObject({ source: 'sync', eventId: null, launchAngle: null, grounding: { thin: true } });
    expect(s.dissections.get('p1')).toMatchObject({ framesUsed: 0, sheetPath: null });
    expect(s.profiles.get('pr1')).toMatchObject({ method: 'lift_wilson_v1', controlsN: 0 });
    expect(s.runs.get('r1')).toMatchObject({ line: null, job: null, scheduled: false, batchId: null, progress: null });
    expect(s.spend.all().map((r) => r.line)).toEqual(['apify.sync', 'apify.sync', 'apify.sync', 'stt']);
    expect(Object.keys(s.counts()).sort()).toEqual([...LAB_TABLES].sort());
    expect(s.counts().lab_posts).toBe(2);
  });

  test('openDb on a file created by v1 migrates it in place, and reopening changes nothing', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'lab-migrate-'));
    const file = path.join(dir, 'v1.db');
    const v1 = new Database(file);
    v1.exec(V1_DDL);
    v1.prepare("INSERT INTO lab_spend (run_id, provider, units, actual_usd, dry, at) VALUES ('r1', 'apify', 1, 0.5, 0, '2026-10-02T00:00:00.000Z')").run();
    v1.close();
    const a = openDb(file);
    expect(a.lab.spend.all()[0]).toMatchObject({ line: 'apify.sync', actualSource: 'provider' });
    expect(a.lab.priors.get('schema_version')?.value).toEqual({ v: 2 });
    a.close();
    const raw = new Database(file);
    const before = snapshot(raw);
    raw.close();
    const b = openDb(file);
    b.close();
    const raw2 = new Database(file);
    expect(snapshot(raw2)).toEqual(before);
    raw2.close();
  });
});

describe('v2 triggers (06 2.4, 09.6)', () => {
  const pred = (over: Record<string, unknown> = {}) => ({
    id: 'lpr-0000000000000001', origin: 'live' as const, predictor: 'brody', predictorVersion: 'brody-1', kind: 'pre_post' as const, scriptId: 'sc1', scriptVersion: 1, postId: null, sourceId: 's1', platform: 'tiktok' as const,
    surface: 'video', refAgeH: null, asOf: '2026-10-01T00:00:00.000Z', frozenAt: '2026-10-01T00:00:00.000Z', backtestOrigin: null, band: 'above' as const, score: 2, ratioPoint: null, ratioLo: null, ratioHi: null,
    viewsPoint: null, viewsLo: null, viewsHi: null, pBreakout: null, intervalLevel: null, baseline7dViews: null, baselineN: null, inputs: {}, note: '', payloadSha256: 'a'.repeat(64), late: false, status: 'frozen' as const,
    voidReason: null, voidedAt: null, outcomeViews7d: null, outcomeRatio7d: null, outcomeBand: null, outcomeIsBreakout: null, outcomeMethod: null, hitBand: null, inInterval: null, absLogErr: null, testId: null, pairRight: null, gradedAt: null, dry: false,
    ...over,
  });

  test('a live prediction: frozen fields immutable, post link once, grade once, never deleted; clearAll still clears', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(LAB_DDL);
    const t = labStore(sqlite);
    t.predictions.insert(pred());
    expect(() => sqlite.prepare("UPDATE lab_predictions SET band = 'below' WHERE id = ?").run('lpr-0000000000000001')).toThrow(/immutable/);
    expect(t.predictions.linkPost('sc1', 'p1', false)).toBe(1);
    expect(() => sqlite.prepare("UPDATE lab_predictions SET post_id = 'p2' WHERE id = ?").run('lpr-0000000000000001')).toThrow(/set once/);
    const grade = { outcomeViews7d: 1000, outcomeRatio7d: 2.1, outcomeBand: 'above' as const, outcomeIsBreakout: false, outcomeMethod: 'bracket' as const, hitBand: true, inInterval: null, absLogErr: 0.1, status: 'graded' as const, gradedAt: '2026-10-09T00:00:00.000Z' };
    expect(t.predictions.grade('lpr-0000000000000001', grade)).toBe(true);
    expect(() => t.predictions.grade('lpr-0000000000000001', grade)).toThrow(/written once/);
    expect(() => sqlite.prepare('DELETE FROM lab_predictions').run()).toThrow(/never deleted/);
    t.clearAll();
    expect(t.counts().lab_predictions).toBe(0);
    // the trigger is back after clearAll
    t.predictions.insert(pred());
    expect(() => sqlite.prepare('DELETE FROM lab_predictions').run()).toThrow(/never deleted/);
    // backtest rows are replaced freely
    t.predictions.replaceBacktest('sh_24h', 'sh-1', [pred({ id: 'lpr-0000000000000002', predictor: 'sh_24h', predictorVersion: 'sh-1', origin: 'backtest', backtestOrigin: '2026-09-07' })]);
    t.predictions.replaceBacktest('sh_24h', 'sh-1', []);
    expect(t.predictions.list({ origin: 'backtest' })).toHaveLength(0);
  });

  test('lab_forecasts_lock: graded rows are immutable; a late row is re-graded once', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(LAB_DDL);
    const t = labStore(sqlite);
    const f = { id: 'lfc-0000000000000001', kind: 'gate_eta' as const, subject: 'baseline_24h:instagram', frozenAt: '2026-10-05T07:00:00.000Z', inputs: {}, predicted: 9, lo: 6, hi: 14, expectedItems: null, actual: null, actualItems: null, status: 'open' as const, gradedAt: null, dry: false };
    t.forecasts.insert(f);
    expect(t.forecasts.grade(f.id, { actual: null, status: 'late', gradedAt: '2026-10-19T07:00:00.000Z' })).toBe(true);
    expect(() => t.forecasts.grade(f.id, { actual: null, status: 'late', gradedAt: '2026-10-20T07:00:00.000Z' })).toThrow(/immutable/);
    expect(t.forecasts.grade(f.id, { actual: 16, status: 'graded', gradedAt: '2026-10-21T07:00:00.000Z' })).toBe(true);
    expect(() => t.forecasts.grade(f.id, { actual: 17, status: 'graded', gradedAt: '2026-10-22T07:00:00.000Z' })).toThrow(/immutable/);
    expect(t.forecasts.get(f.id)).toMatchObject({ status: 'graded', actual: 16 });
  });
});

describe('one migration, one place (08.11.2 grep test)', () => {
  const ROOT = path.resolve(__dirname, '..');
  const files = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [path.join(dir, e.name)] : []))
      : [];
  const source = ['lib', 'app', 'scripts', 'components'].flatMap((d) => files(path.join(ROOT, d)));

  test('exactly one function migrateLabV2, and no ALTER TABLE lab_ outside lib/db.ts', () => {
    const defs = source.filter((f) => /function migrateLabV2\b/.test(fs.readFileSync(f, 'utf8')));
    expect(defs.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))).toEqual(['lib/db.ts']);
    const alters = source.filter((f) => path.relative(ROOT, f).replace(/\\/g, '/') !== 'lib/db.ts' && /ALTER TABLE lab_/.test(fs.readFileSync(f, 'utf8')));
    expect(alters.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))).toEqual([]);
  });
});
