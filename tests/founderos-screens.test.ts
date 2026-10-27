import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderWithRouter } from './helpers/render-client';

/**
 * FounderOS on GladOS: a fresh clone opens on the demo company (lib/demo/),
 * and /agents and /social are FounderOS's own screens (founderos/).
 *
 * The demo store is built into a temp project root here, never the repo's.
 */

const root = mkdtempSync(path.join(tmpdir(), 'founderos-demo-'));
let cwd: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('GLADOS_MODE_FILE', path.join(root, '.glados-mode'));
  vi.stubEnv('GLADOS_DEFAULT_MODE', 'demo');
});
afterAll(async () => {
  // Windows cannot unlink an open SQLite file.
  const { getDb } = await import('@/lib/data');
  getDb().close();
  cwd.mockRestore();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('demo mode is the default', () => {
  test('a fresh clone (no choice made) runs on demo-data/', async () => {
    const { filmingMode, invalidateModeCache, dataDir } = await import('@/lib/paths');
    invalidateModeCache();
    expect(filmingMode()).toBe(true);
    expect(dataDir()).toBe(path.join(root, 'demo-data'));
  });

  test("switching to real data in Settings sticks, and GLADOS_DEFAULT_MODE=real starts blank", async () => {
    const { filmingMode, invalidateModeCache } = await import('@/lib/paths');
    fs.writeFileSync(path.join(root, '.glados-mode'), 'real\n');
    invalidateModeCache();
    expect(filmingMode()).toBe(false);
    fs.rmSync(path.join(root, '.glados-mode'));
    vi.stubEnv('GLADOS_DEFAULT_MODE', 'real');
    invalidateModeCache();
    expect(filmingMode()).toBe(false);
    vi.stubEnv('GLADOS_DEFAULT_MODE', 'demo');
    invalidateModeCache();
    expect(filmingMode()).toBe(true);
  });
});

describe('the demo company', () => {
  test('moves exported dates forward by whole days and leaves everything else alone', async () => {
    const { shiftCompanyDates } = await import('@/lib/demo/store');
    const out = shiftCompanyDates({ at: '2026-10-01T09:30:00.000Z', day: '2026-10-01', quarter: '2026-Q4', n: 3, list: ['2026-09-30'] }, 5);
    expect(out).toEqual({ at: '2026-10-06T09:30:00.000Z', day: '2026-10-06', quarter: '2026-Q4', n: 3, list: ['2026-10-05'] });
  });

  test('builds the whole store on first use: database, files and the Optimal Engine', async () => {
    const { ensureDemoStore, demoStoreStale } = await import('@/lib/demo/store');
    expect(demoStoreStale()).toBe(true);
    ensureDemoStore();
    expect(demoStoreStale()).toBe(false);
    const dir = path.join(root, 'demo-data');
    for (const f of ['glados.db', 'adpilot-campaigns.json', 'drift.json', 'wizard/projects.json', 'bdpilot/state.json', 'bin/gbrain']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    const pages = fs.readdirSync(path.join(dir, 'brain'), { recursive: true }).filter((f) => String(f).endsWith('.md'));
    expect(pages.length).toBeGreaterThan(150);

    const { getDb } = await import('@/lib/data');
    const db = getDb();
    const names = db.agents.all().map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['Atlas', 'Vera', 'Quill', 'Conductor']));
    expect(db.agentTasks.all().length).toBeGreaterThan(10);
    expect(db.agentRuns.count()).toBeGreaterThan(100);
    expect(db.skills.all().length).toBeGreaterThan(10);
    expect(db.workflows.all().length).toBeGreaterThan(2);
    // nothing is written to the real data directory
    expect(fs.existsSync(path.join(root, 'data'))).toBe(false);
  }, 30_000);

  test('every date is recent: the newest task and run are within the last few days', async () => {
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    const newest = (xs: string[]) => xs.sort().pop()!;
    const day = 86_400_000;
    expect(Date.now() - Date.parse(newest(db.agentTasks.all().map((t) => t.updatedAt)))).toBeLessThan(4 * day);
    expect(Date.now() - Date.parse(db.agentRuns.latest()!.startedAt)).toBeLessThan(4 * day);
  });
});

describe("FounderOS's own screens", () => {
  test('the Agents board reads the demo company in demo mode, never a remote board', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { paperclipAgents, paperclipIssues, paperclipRuns, paperclipStatus } = await import('@/founderos/lib/connectors/paperclip');
    const [agents, issues, runs, status] = await Promise.all([paperclipAgents(), paperclipIssues(50), paperclipRuns(50), paperclipStatus()]);
    expect(agents.map((a) => a.name)).toContain('Atlas');
    expect(issues.length).toBeGreaterThan(10);
    const lanes = new Set(issues.map((i) => i.status));
    expect(lanes.has('done')).toBe(true);
    expect(lanes.has('in_progress') || lanes.has('todo')).toBe(true);
    expect(runs.length).toBe(50);
    expect(status.state).toBe('connected');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('/agents renders the board with the roster and its lanes', async () => {
    const { default: AgentsPage } = await import('@/app/agents/page');
    const html = renderWithRouter((await AgentsPage()) as ReactElement);
    expect(html).toContain('Real Agents');
    expect(html).toContain('Atlas');
  }, 30_000);

  test('/social renders the demo audience with a status pill from the connector', async () => {
    const { default: SocialPage } = await import('@/app/social/page');
    const html = renderWithRouter((await SocialPage()) as ReactElement);
    expect(html).toContain('Social');
    expect(html).toMatch(/48,210|48\.2K/);
    expect(html).not.toContain('Zernio not configured');
  }, 30_000);
});
