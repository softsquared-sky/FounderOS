import { afterEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, retireTables } from '@/lib/db';

// SPEC S12 §5.3: the Reference Model (domains) and Personas tables are
// exported to retired/<table>-<date>.json, then dropped. Fictional rows only
// (SPEC §3.4, G7): the real exports never leave data/, demo-data/, filming/.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      fs.chmodSync(path.join(d, 'retired'), 0o755);
    } catch {}
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-retire-'));
  dirs.push(dir);
  return { dir, file: path.join(dir, 'glados.db') };
}

/** An old-schema store: the two tables as the pre-S12 DDL made them. */
function seedLegacy(file: string, { domains = 0, personas = 0 } = {}) {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE IF NOT EXISTS domains (id TEXT PRIMARY KEY, number INTEGER NOT NULL, title TEXT NOT NULL, color TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, name TEXT NOT NULL, archetype TEXT NOT NULL,
      tagline TEXT NOT NULL, summary TEXT NOT NULL, accent TEXT NOT NULL, north_star TEXT NOT NULL, pillars TEXT NOT NULL DEFAULT '[]',
      connectors TEXT NOT NULL DEFAULT '[]', metrics TEXT NOT NULL DEFAULT '[]', brain_use TEXT NOT NULL, signature_play TEXT NOT NULL);
  `);
  const d = raw.prepare('INSERT INTO domains (id, number, title, color, items) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= domains; i++) d.run(`dom-${i}`, i, `Kestrel area ${i}`, 'token', '["Orbit Labs ledger"]');
  const p = raw.prepare(
    'INSERT INTO personas (id, ord, name, archetype, tagline, summary, accent, north_star, brain_use, signature_play) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (let i = 1; i <= personas; i++) p.run(`persona-${i}`, i, `Lumen Desk ${i}`, 'Maker', 'Lamps', 'Desk lamps', 'token', 'Ship', 'Notes', 'Launch');
  raw.close();
}

const tableNames = (file: string) => {
  const raw = new Database(file, { readonly: true });
  const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  raw.close();
  return names;
};

const retiredFiles = (dir: string) => {
  const r = path.join(dir, 'retired');
  return fs.existsSync(r) ? fs.readdirSync(r).sort() : [];
};

describe('retireTables (SPEC S12 §5.3)', () => {
  test('(a) tables with rows: every row exported to retired/<table>-<date>.json, then dropped', () => {
    const { dir, file } = tempDb();
    seedLegacy(file, { domains: 3, personas: 2 });
    const db = openDb(file);
    db.close();
    expect(tableNames(file)).not.toContain('domains');
    expect(tableNames(file)).not.toContain('personas');
    const files = retiredFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => /^(domains|personas)-\d{4}-\d{2}-\d{2}\.json$/.test(f))).toBe(true);
    const dom = JSON.parse(fs.readFileSync(path.join(dir, 'retired', files.find((f) => f.startsWith('domains'))!), 'utf8'));
    expect(dom.table).toBe('domains');
    expect(dom.reason).toBe('spec 12: page removed');
    expect(dom.rows.map((r: { id: string }) => r.id)).toEqual(['dom-1', 'dom-2', 'dom-3']);
    // Raw columns, JSON-text columns left as stored.
    expect(dom.rows[0].items).toBe('["Orbit Labs ledger"]');
    const per = JSON.parse(fs.readFileSync(path.join(dir, 'retired', files.find((f) => f.startsWith('personas'))!), 'utf8'));
    expect(per.rows).toHaveLength(2);
  });

  test('(b) empty tables: dropped, no file written', () => {
    const { dir, file } = tempDb();
    seedLegacy(file);
    openDb(file).close();
    expect(tableNames(file)).not.toContain('domains');
    expect(tableNames(file)).not.toContain('personas');
    expect(retiredFiles(dir)).toEqual([]);
  });

  test('(c) unwritable retired/: tables kept, one warning each, no throw, the app still opens', () => {
    const { dir, file } = tempDb();
    seedLegacy(file, { domains: 2, personas: 1 });
    fs.mkdirSync(path.join(dir, 'retired'));
    // Unix chmod is not a write-denial mechanism on Windows or under root.
    const originalWrite = fs.writeFileSync;
    const deny = vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).startsWith(path.join(dir, 'retired') + path.sep)) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return originalWrite(...args);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let db: ReturnType<typeof openDb> | undefined;
    expect(() => {
      db = openDb(file);
    }).not.toThrow();
    expect(db!.departments.all()).toEqual([]);
    db!.close();
    deny.mockRestore();
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(msgs.filter((m) => m.startsWith('[db] retire domains skipped'))).toHaveLength(1);
    expect(msgs.filter((m) => m.startsWith('[db] retire personas skipped'))).toHaveLength(1);
    expect(tableNames(file)).toEqual(expect.arrayContaining(['domains', 'personas']));
    expect(retiredFiles(dir)).toEqual([]);
  });

  test('(d) an old snapshot restored with the same ids reuses the earlier export (no second file)', () => {
    const { dir, file } = tempDb();
    seedLegacy(file, { domains: 2 });
    openDb(file).close();
    expect(retiredFiles(dir)).toHaveLength(1);
    // Restore: the table comes back with the same rows, on a later day.
    seedLegacy(file, { domains: 2 });
    const raw = new Database(file);
    const out = retireTables(raw, file, { now: new Date(2031, 0, 2) });
    raw.close();
    expect(out.find((o) => o.table === 'domains')).toMatchObject({ action: 'exported', rows: 2 });
    expect(retiredFiles(dir).filter((f) => f.startsWith('domains'))).toHaveLength(1);
    expect(tableNames(file)).not.toContain('domains');
  });

  test('(d2) different rows on the same day get a -2 file, never overwrite', () => {
    const { dir, file } = tempDb();
    const now = new Date(2031, 4, 6);
    seedLegacy(file, { domains: 1 });
    let raw = new Database(file);
    retireTables(raw, file, { now });
    raw.close();
    seedLegacy(file, { domains: 3 });
    raw = new Database(file);
    retireTables(raw, file, { now });
    raw.close();
    expect(retiredFiles(dir).filter((f) => f.startsWith('domains'))).toEqual(['domains-2031-05-06-2.json', 'domains-2031-05-06.json']);
  });

  test('(e) missing tables: no-op', () => {
    const { dir, file } = tempDb();
    openDb(file).close();
    const raw = new Database(file);
    const out = retireTables(raw, file);
    raw.close();
    expect(out.map((o) => o.action)).toEqual(['absent', 'absent']);
    expect(retiredFiles(dir)).toEqual([]);
  });

  test('a fresh store never creates the retired tables', () => {
    const { file } = tempDb();
    openDb(file).close();
    expect(tableNames(file)).not.toContain('domains');
    expect(tableNames(file)).not.toContain('personas');
  });
});
