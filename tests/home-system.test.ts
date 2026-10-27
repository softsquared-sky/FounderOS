import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import fs, { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderWithRouter } from './helpers/render-client';

/**
 * fo/home-system (founderos-ui pages/feature-additions.md): F1 (G-Brain health
 * leaves Home, H-1, H-2), F2 (interject, Needs you, Done today, H-3, H-4),
 * F11 (Connections browser, I-1) and F12 (the content crew card on /social),
 * in the GladOS and Classic trees (Legacy renders the Classic tree).
 */

// Every subprocess entry point is wrapped so a Home render can prove it starts none (H-2).
const spawned: string[] = [];
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const wrap = <F extends (...a: any[]) => any>(name: string, fn: F) =>
    ((...a: Parameters<F>) => {
      spawned.push(`${name} ${String(a[0])}`);
      if (process.env.HS_TRACE) console.log(name, String(a[0]), new Error().stack);
      return fn(...a);
    }) as F;
  const wrapped = {
    ...real,
    execFile: wrap('execFile', real.execFile),
    exec: wrap('exec', real.exec),
    spawn: wrap('spawn', real.spawn),
    execFileSync: wrap('execFileSync', real.execFileSync),
    execSync: wrap('execSync', real.execSync),
    spawnSync: wrap('spawnSync', real.spawnSync),
  };
  return { ...wrapped, default: wrapped };
});

let appearance = 'glados.ice.dark';
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: () => {
    const all = [{ name: 'glados-appearance', value: appearance }];
    return { get: (n: string) => all.find((c) => c.name === n), getAll: () => all, has: (n: string) => all.some((c) => c.name === n) };
  },
  headers: () => new Headers({ host: 'localhost:4491' }),
}));

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
let root = '';

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'glados-home-system-'));
  process.env.GLADOS_DB = path.join(root, 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.GBRAIN_BIN = path.join(root, 'no-gbrain-cli');
  process.env.GBRAIN_STORE = path.join(root, 'brain-store');
  process.env.BRAIN_PROVIDER = 'stub';
  fs.mkdirSync(process.env.GBRAIN_STORE, { recursive: true });
  // Vite's cold server-module transform is fixture setup, not a Home render.
  // Keep the existing per-render deadlines and subprocess assertions intact.
  await import('@/components/Home6Console');
}, 120_000);
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  appearance = 'glados.ice.dark';
});

async function renderHome(cookie: string): Promise<string> {
  appearance = cookie;
  // app/page.tsx renders <Home6Console />, an async server component: invoke it directly
  const { Home6Console } = await import('@/components/Home6Console');
  return renderWithRouter((await Home6Console()) as ReactElement);
}

async function seedTasks() {
  const { getDb } = await import('@/lib/data');
  const db = getDb();
  const now = new Date();
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const base = { detail: '', dueAt: null, horizon: null, runId: null };
  db.agentTasks.insert({ ...base, id: 'hs-blocked-1', agentId: null, ownerKind: 'me', title: 'Approve the send batch', status: 'blocked', priority: 'high', createdAt: iso(7_200_000), updatedAt: iso(3_600_000) });
  db.agentTasks.insert({ ...base, id: 'hs-blocked-2', agentId: null, ownerKind: 'me', title: 'Sign off the retention answer', status: 'blocked', priority: 'normal', createdAt: iso(7_200_000), updatedAt: iso(120_000) });
  db.agentTasks.insert({ ...base, id: 'hs-open', agentId: null, ownerKind: 'me', title: 'An open task', status: 'open', priority: 'normal', createdAt: iso(60_000), updatedAt: iso(60_000) });
  db.agentTasks.insert({ ...base, id: 'hs-done', agentId: null, ownerKind: 'me', title: 'Filed the invoice', status: 'done', priority: 'normal', createdAt: iso(600_000), updatedAt: iso(30_000) });
}

/* ── F1: G-Brain health leaves Home ─────────────────────────────────── */

describe('F1: no G-Brain health on Home (H-1, H-2, AC-4)', () => {
  test('neither tree reads the doctor or shows a health score (source)', () => {
    const G = read('components/home/HomeG.tsx');
    const C = read('components/Home6Console.tsx');
    for (const src of [G, C]) {
      expect(src).not.toMatch(/\.overview\(\)/);
      expect(src).not.toMatch(/healthScore|doctor\.connected|G-Brain doctor/);
      expect(src).not.toMatch(/>\s*G-Brain health\s*</);
      expect(src).toContain('title="Overall status from failed runs and connectors"');
    }
    expect(G).not.toContain('function SystemCard');
    expect(C).toContain('createGBrainProvider().localStats()');
    // the page count stays: it is a count, not health
    expect(G).toContain('label="brain pages"');
  });

  test.each([
    ['GladOS', 'glados.ice.dark'],
    ['Classic', 'classic.ice.dark'],
    ['Legacy (Classic tree under the skin)', 'legacy.mono.dark'],
  ])('%s Home renders no "G-Brain health" and no "doctor" (H-1)', async (_name, cookie) => {
    const html = await renderHome(cookie);
    expect(html).not.toMatch(/G-Brain health/i);
    expect(html).not.toMatch(/doctor/i);
    expect(html).toContain('Overall status from failed runs and connectors');
  }, 30_000);

  test('Home never runs the gbrain CLI, even with every cache off (H-2)', async () => {
    // BRAIN_PROVIDER=stub keeps the gbrain connector off the CLI; the old Home called
    // createGBrainProvider().overview() directly, which spawned `gbrain doctor` regardless
    for (const cookie of ['glados.ice.dark', 'classic.ice.dark']) {
      spawned.length = 0;
      await renderHome(cookie);
      expect(spawned.filter((c) => c.includes('gbrain')), cookie).toEqual([]);
    }
  }, 30_000);

  test('a Home render starts no subprocess with the shared reads warm (H-2)', async () => {
    // As served: lib/swr.ts on (it is off under vitest), the connector board warmed as at boot,
    // every cached G-Brain read dropped (a doctor from Home would have to spawn now), and a home
    // directory with no WhatsApp desktop store (its feed read is a child process, not Home's own)
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('HOME', root);
    try {
      const { allConnectorStatuses } = await import('@/lib/connectors');
      const { invalidateSwr } = await import('@/lib/swr');
      await allConnectorStatuses();
      invalidateSwr('brain:');
      for (const cookie of ['glados.ice.dark', 'classic.ice.dark']) {
        spawned.length = 0;
        await renderHome(cookie);
        expect(spawned, cookie).toEqual([]);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
});

/* ── F2: Interject, Needs you, Done today ───────────────────────────── */

describe('F2 data: needsYou and doneToday', () => {
  test('Needs you is the blocked set, high priority first, then the longest waiting; top five', async () => {
    const { needsYou } = await import('@/lib/home-today');
    const now = new Date('2026-10-12T15:00:00');
    const t = (id: string, status: string, priority: string, updatedAt: string) =>
      ({ id, title: id, status, priority, updatedAt, createdAt: updatedAt, agentId: null, ownerKind: 'me', detail: '', dueAt: null, horizon: null, runId: null }) as never;
    const tasks = [
      t('a', 'blocked', 'normal', '2026-10-12T10:00:00'),
      t('b', 'blocked', 'high', '2026-10-12T14:00:00'),
      t('c', 'open', 'high', '2026-10-12T09:00:00'),
      t('d', 'blocked', 'normal', '2026-10-11T10:00:00'),
      ...['e', 'f', 'g', 'h'].map((id) => t(id, 'blocked', 'low', '2026-10-12T12:00:00')),
    ];
    const n = needsYou(tasks, now);
    expect(n.total).toBe(7);
    expect(n.rows.map((r) => r.id)).toEqual(['b', 'd', 'a', 'e', 'f']);
    expect(n.rows[0]).toMatchObject({ href: '/tasks?task=b', age: '1h' });
    expect(needsYou([], now)).toEqual({ total: 0, rows: [] });
  });

  test('Done today counts tasks and runs finished since local midnight, newest three shown', async () => {
    const { doneToday, doneCaption, localMidnight } = await import('@/lib/home-today');
    const now = new Date('2026-10-12T15:00:00');
    expect(new Date(localMidnight(now)).getHours()).toBe(0);
    const task = (id: string, status: string, updatedAt: string) =>
      ({ id, title: `task ${id}`, status, priority: 'normal', updatedAt, createdAt: updatedAt, agentId: null, ownerKind: 'me', detail: '', dueAt: null, horizon: null, runId: null }) as never;
    const run = (id: string, finishedAt: string, ok = true) => ({ id, agentId: 'comms-agent', startedAt: finishedAt, finishedAt, ok, summary: `run ${id}` });
    const d = doneToday(
      [task('t1', 'done', '2026-10-12T09:00:00'), task('t2', 'done', '2026-10-11T23:59:00'), task('t3', 'open', '2026-10-12T10:00:00')],
      [run('r1', '2026-10-12T14:00:00'), run('r2', '2026-10-12T00:00:01', false), run('r3', '2026-10-11T22:00:00')],
      now,
    );
    expect(d).toMatchObject({ count: 3, tasks: 1, runs: 2, failed: 1 });
    expect(d.rows.map((r) => r.id)).toEqual(['r1', 't1', 'r2']);
    expect(d.rows[0].href).toBe('/agents?agent=comms-agent');
    expect(d.rows[1].href).toBe('/tasks?task=t1');
    expect(doneCaption(d)).toBe('1 task · 2 runs since midnight');
    expect(doneToday([], [], now).count).toBe(0);
  });
});

describe('F2 on Home: both trees', () => {
  test.each([
    ['GladOS', 'glados.ice.dark'],
    ['Classic', 'classic.ice.dark'],
  ])('%s: empty states say what will appear', async (_n, cookie) => {
    const html = await renderHome(cookie);
    expect(html).toContain('data-interject');
    expect(html).toContain('Tell an agent, add a task or note');
    expect(html).toContain('Nothing waiting on you.');
    expect(html).toContain('Nothing finished yet today.');
  }, 30_000);

  test.each([
    ['GladOS', 'glados.ice.dark'],
    ['Classic', 'classic.ice.dark'],
  ])('%s: Needs you lists the blocked tasks, each linking to the board; Done today counts', async (_n, cookie) => {
    await seedTasks();
    const html = await renderHome(cookie);
    const needs = html.slice(html.indexOf('data-home-needs'), html.indexOf('data-home-done'));
    expect(needs).toContain('Approve the send batch');
    expect(needs).toContain('Sign off the retention answer');
    expect(needs).not.toContain('An open task');
    expect(needs).toContain('href="/tasks?task=hs-blocked-1"');
    expect(needs.indexOf('Approve the send batch')).toBeLessThan(needs.indexOf('Sign off the retention answer'));
    const done = html.slice(html.indexOf('data-home-done'));
    expect(done).toContain('Filed the invoice');
    expect(done).toContain('1 task since midnight');
  }, 30_000);

  test('GladOS: the composer sits under the heroes and the stats, before the chart (wireframe)', () => {
    const G = read('components/home/HomeG.tsx');
    const at = (s: string) => G.indexOf(s);
    expect(at('<Stats stats={data.stats} />')).toBeLessThan(at('<InterjectG />'));
    expect(at('<InterjectG />')).toBeLessThan(at('<NeedsYouCard'));
    expect(at('<DoneTodayCard')).toBeLessThan(at('<ActivityCard'));
    expect(read('components/home/Interject.tsx')).toContain('<GAsk');
    expect(read('components/home/Interject.tsx')).toContain('INTERJECT_UNDO_MS');
  });

  test('Classic: Needs you and Done today take the health tile\'s slot in the right rail', () => {
    const C = read('components/Home6Console.tsx');
    const rail = C.slice(C.indexOf('h6-col h6-col-right'));
    expect(rail.indexOf('<NeedsYouCard')).toBeGreaterThan(-1);
    expect(rail.indexOf('<DoneTodayCard')).toBeGreaterThan(rail.indexOf('<NeedsYouCard'));
    expect(C).toContain('<InterjectClassic />');
  });
});

describe('F2 interject: each intent lands in its store, Undo removes (H-3, H-4)', () => {
  const req = (method: string, body: unknown) => new Request('http://localhost/api/interject', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('task, relay, note', async () => {
    const { POST, DELETE } = await import('@/app/api/interject/route');
    const { getDb } = await import('@/lib/data');
    const task = await (await POST(req('POST', { text: 'Call the bank about the wire' }))).json();
    expect(task).toMatchObject({ kind: 'task', href: `/tasks?task=${task.id}`, undo: true });
    expect(getDb().agentTasks.get(task.id)).toMatchObject({ ownerKind: 'me', agentId: null, status: 'open' });

    const relay = await (await POST(req('POST', { text: 'ask Daily Briefing to add the Q3 numbers' }))).json();
    expect(relay).toMatchObject({ kind: 'relay', agentId: 'daily-briefing' });
    expect(getDb().agentTasks.get(relay.id)).toMatchObject({ ownerKind: 'agent', agentId: 'daily-briefing', title: 'add the Q3 numbers' });

    const noteRes = await POST(req('POST', { text: 'note: the launch moves to May' }));
    expect(noteRes.status).toBe(201);
    const note = await noteRes.json();
    expect(note).toMatchObject({ kind: 'note', undo: false });
    const file = path.join(process.env.GBRAIN_STORE!, note.id);
    expect(fs.readFileSync(file, 'utf8')).toContain('the launch moves to May');
    expect(getDb().agentTasks.all().some((t) => t.title.includes('launch moves'))).toBe(false);

    for (const id of [task.id, relay.id]) {
      expect((await DELETE(req('DELETE', { id }))).status).toBe(200);
      expect(getDb().agentTasks.get(id)).toBeNull();
    }
  });
});

/* ── F11: Connections browser ───────────────────────────────────────── */

describe('F11: search and filter the catalogue', () => {
  test('query words, categories and states all narrow; order is kept', async () => {
    const { filterBrowse, browseState, isFiltering, EMPTY_FILTER, resultCaption } = await import('@/lib/integration-browser');
    const items = [
      { slug: 'slack', name: 'Slack', tagline: 'Channels & DMs', category: 'Communication', state: 'connected' as const },
      { slug: 'plaud', name: 'Plaud', tagline: 'In-room recordings', category: 'Communication', state: 'not-connected' as const },
      { slug: 'fathom', name: 'Fathom', tagline: 'Call recordings & summaries', category: 'Communication', state: 'key-saved' as const },
      { slug: 'phantom', name: 'Phantom', tagline: 'Solana wallet balance', category: 'Finance', state: 'not-connected' as const },
    ];
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(filterBrowse(items, EMPTY_FILTER)).toHaveLength(4);
    expect(filterBrowse(items, { ...EMPTY_FILTER, q: 'recordings' }).map((i) => i.slug)).toEqual(['plaud', 'fathom']);
    expect(filterBrowse(items, { ...EMPTY_FILTER, q: 'call RECORD' }).map((i) => i.slug)).toEqual(['fathom']);
    expect(filterBrowse(items, { ...EMPTY_FILTER, q: 'finance' }).map((i) => i.slug)).toEqual(['phantom']);
    expect(filterBrowse(items, { ...EMPTY_FILTER, states: ['not-connected'] }).map((i) => i.slug)).toEqual(['plaud', 'phantom']);
    expect(filterBrowse(items, { q: '', categories: ['Communication'], states: ['connected', 'key-saved'] }).map((i) => i.slug)).toEqual(['slack', 'fathom']);
    expect(filterBrowse(items, { ...EMPTY_FILTER, q: 'zzz' })).toEqual([]);
    expect(browseState({ connected: true, keySaved: false })).toBe('connected');
    expect(browseState({ connected: false, keySaved: true })).toBe('key-saved');
    expect(browseState({ connected: false, keySaved: false })).toBe('not-connected');
    expect(resultCaption(0, 4)).toMatch(/No tools match/);
    expect(resultCaption(2, 4)).toBe('2 of 4 tools');
  });

  test('every FounderOS connector is in the catalogue with a setupHrefFor deep link (I-1)', async () => {
    const { INTEGRATIONS, setupHrefFor } = await import('@/lib/integrations-catalog');
    for (const slug of ['robinhood', 'phantom', 'plaud', 'fathom', 'vidalytics', 'superset']) {
      const entry = INTEGRATIONS.find((i) => i.slug === slug);
      expect(entry, slug).toBeTruthy();
      expect(setupHrefFor(entry!.connectorId ?? slug), slug).toBe(`/integrations#${slug}`);
    }
    // vidalytics is a catalogue entry only: it can hold a key but never claims connected
    const vid = INTEGRATIONS.find((i) => i.slug === 'vidalytics')!;
    expect(vid.connectorId).toBeUndefined();
    expect(vid.envKeys).toEqual(['VIDALYTICS_API_KEY']);
    expect(read('.env.example')).toMatch(/^#?\s*VIDALYTICS_API_KEY=/m);
  });

  test.each([
    ['GladOS', 'glados.ice.dark'],
    ['Classic', 'classic.ice.dark'],
  ])('%s: the browser sits above the categories with search, state and category filters', async (_n, cookie) => {
    appearance = cookie;
    const { default: Page } = await import('@/app/integrations/page');
    const html = renderWithRouter((await Page()) as ReactElement);
    const browse = html.slice(html.indexOf('data-integration-browser'));
    expect(browse).toContain('Search tools');
    expect(browse).toContain('aria-label="Filter by state"');
    expect(browse).toContain('aria-label="Filter by category"');
    for (const label of ['Connected', 'Key saved', 'Not connected', 'Communication', 'Finance']) expect(browse).toContain(label);
    if (cookie.startsWith('glados')) {
      expect(browse).toContain('data-g="GSearch"');
      expect(browse).toContain('data-g="GChip"');
    } else {
      expect(browse).not.toContain('data-g=');
    }
  }, 30_000);
});

/* ── F12: content crew card on /social ──────────────────────────────── */

describe('F12: the content crew card', () => {
  test('Growth agents, runs in 30 days, the busiest and the last post age', async () => {
    const { contentCrew, lastPostAt, growthDepartment, postAgeText, CREW_HREF } = await import('@/lib/social-crew');
    const now = new Date('2026-10-12T15:00:00Z');
    const departments = [
      { id: 'dept-sales', name: 'Sales', slug: 'sales', tagline: '', color: 'x', order: 1 },
      { id: 'dept-marketing-growth', name: 'Marketing/Growth', slug: 'marketing-growth', tagline: '', color: 'x', order: 2 },
    ];
    expect(growthDepartment(departments)?.id).toBe('dept-marketing-growth');
    const agent = (id: string, departmentId: string) => ({ id, name: id.toUpperCase(), departmentId, role: 'Writer', status: 'active' }) as never;
    const run = (agentId: string, daysAgo: number, ok = true) => ({ id: `${agentId}-${daysAgo}`, agentId, startedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), finishedAt: now.toISOString(), ok, summary: '' });
    const runs: Record<string, ReturnType<typeof run>[]> = {
      social: [run('social', 1), run('social', 2, false), run('social', 40)],
      clipper: [run('clipper', 3), run('clipper', 4), run('clipper', 5)],
      closer: [run('closer', 1)],
    };
    const crew = contentCrew({
      departments,
      agents: [agent('social', 'dept-marketing-growth'), agent('clipper', 'dept-marketing-growth'), agent('closer', 'dept-sales')],
      runsByAgent: (id) => runs[id] ?? [],
      lastPostAt: '2026-10-12T12:00:00Z',
      now,
    });
    expect(crew.agents.map((a) => [a.id, a.runs, a.failed])).toEqual([['clipper', 3, 0], ['social', 2, 1]]);
    expect(crew).toMatchObject({ runs: 5, failed: 1, lastPostAge: '3h', href: CREW_HREF });
    expect(crew.busiest?.id).toBe('clipper');
    expect(CREW_HREF).toBe('/agents?dept=growth');
    expect(postAgeText(crew.lastPostAge)).toBe('3h ago');
    expect(postAgeText(null)).toBe('No post on record');

    const idle = contentCrew({ departments, agents: [agent('social', 'dept-marketing-growth')], runsByAgent: () => [], lastPostAt: null, now });
    expect(idle.busiest).toBeNull();
    expect(contentCrew({ departments: [], agents: [], runsByAgent: () => [], lastPostAt: null, now }).department).toBeNull();

    expect(lastPostAt({ live: [{ publishedAt: null }, { publishedAt: '2026-10-11T08:00:00Z' }, { publishedAt: '2026-10-12T08:00:00Z' }] })).toBe('2026-10-12T08:00:00Z');
    expect(lastPostAt({ days: [{ date: '2026-10-10', platforms: ['tiktok'] }, { date: '2026-10-11', platforms: [] }] })?.slice(0, 10)).toMatch(/2026-10-(09|10)/);
    expect(lastPostAt({ local: [{ status: 'queued', createdAt: '2026-10-12T01:00:00Z', scheduledFor: null }] })).toBeNull();
    // a future-dated entry never reads as "just now"
    expect(lastPostAt({ live: [{ publishedAt: '2026-10-13T08:00:00Z' }, { publishedAt: '2026-10-12T08:00:00Z' }] }, now)).toBe('2026-10-12T08:00:00Z');
  });

  // The card rendered on GladOS's /social. FounderOS keeps its own /agents and /social (founderos/, tests/founderos-screens.test.ts).
});
