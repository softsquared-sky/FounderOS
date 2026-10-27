import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeStarState, safeDashboardUrl, selectTasks, snapshotOld } from '@/lib/star/model';
import { loadStarSnapshot } from '@/lib/star/source';

const state = {
  personas: [{ id: 'old', name: 'Old', mergedInto: 'ceo' }, { id: 'ceo', name: 'CEO' }],
  projection: { status: 'stale', revision: 2, verifiedAt: '2026-10-01T00:00:00Z' },
  secret: 'never-copy', notifications: [{ preview: 'never-copy' }],
  jobs: [
    { id: 'a', title: '승인 대기', status: 'pending', personaIds: ['old'], prompt: 'never-copy', output: 'never-copy', ticketComments: ['never-copy'], canonicalLinks: [{ state: 'waiting', nextAction: '원본 확인 후 회신', source: { key: 'task:a', revision: 3 } }] },
    { id: 'b', title: '완료한 회신', status: 'completed', canonicalLinks: [{ state: 'waiting' }] },
    { id: 'c', title: '실행 상태 미확인', status: 'needs_review' },
    { id: 'd', title: 'operation', kind: 'operation' }, { id: 'e', title: 'demo', demo: true },
    { id: 'f', title: 'archived', mcpArchived: true }, { id: 'g', title: 'deleted', ownerDeletion: {} },
    { id: 'h', title: 'unreviewed signal', intakeCandidate: { state: 'candidate' } },
  ],
};
const boards = { a: { lane: 'review', label: '확인 대기' }, b: { lane: 'done', label: '완료' } };
const make = () => normalizeStarState(state, boards, 'http://127.0.0.1:8765', new Date('2026-10-27T00:00:00Z'));
afterEach(() => vi.unstubAllEnvs());

describe('Star read-only operator boundary', () => {
  test('exports only business tickets and whitelisted context, preserving IDs and provenance', () => {
    const out = make();
    expect(out.tasks.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(out)).not.toContain('never-copy');
    expect(out.tasks[0]).toMatchObject({ sourceKey: 'task:a', sourceRevision: 3, localStatus: 'pending', canonicalState: 'waiting', roleIds: ['ceo'] });
    expect(out.roles).toEqual([{ id: 'ceo', name: 'CEO' }]);
    expect(out.projection.status).toBe('stale');
  });
  test('missing board evidence remains unknown, never approval or running', () => {
    expect(make().tasks[2]).toMatchObject({ lane: 'unknown', label: '분류 미확인', canonicalState: null });
  });
  test('waiting excludes closed tickets and search plus role filters compose', () => {
    const tasks = make().tasks;
    expect(selectTasks(tasks, 'waiting', 'all', '').map(t => t.id)).toEqual(['a']);
    expect(selectTasks(tasks, 'all', 'ceo', ' 회신 ').map(t => t.id)).toEqual(['a']);
    expect(selectTasks(tasks, 'done', 'all', '').map(t => t.id)).toEqual(['b']);
  });
  test('snapshots have an explicit age boundary, including invalid or future timestamps', () => {
    const now = Date.parse('2026-10-27T00:15:01Z');
    expect(snapshotOld('2026-10-27T00:00:00Z', now)).toBe(true);
    expect(snapshotOld('2026-10-27T00:10:00Z', now)).toBe(false);
    expect(snapshotOld('bad', now)).toBe(true);
    expect(snapshotOld('2026-10-28T00:00:00Z', now)).toBe(true);
  });
  test.each(['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/?token=secret'])('rejects unsafe dashboard URL %s', raw => {
    expect(() => safeDashboardUrl(raw)).toThrow();
  });
  test('unavailable and malformed sources are distinct from a successfully empty snapshot', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'star-test-')), 'snapshot.json');
    vi.stubEnv('STAR_SNAPSHOT_FILE', file);
    expect(loadStarSnapshot().status).toBe('missing');
    writeFileSync(file, '{'); expect(loadStarSnapshot().status).toBe('invalid');
    writeFileSync(file, JSON.stringify({ ...make(), tasks: [] }));
    expect(loadStarSnapshot()).toMatchObject({ status: 'ready', snapshot: { tasks: [] } });
  });
});
