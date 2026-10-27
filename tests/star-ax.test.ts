import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAxSources } from '@/lib/star/ax-model';
import { loadAxSource } from '@/lib/star/ax-source';

const catalog = { as_of: '2026-10-25', scope: 'partial', limitations: ['not live'], nodes: [{ id: 'a', name: 'Memory', kind: 'store', responsibility: 'keep context', verification: 'proposed', evidence: 'never-copy' }, { id: 'b', name: 'Work', kind: 'app' }], relations: [{ from: 'a', to: 'b', label: 'read', verification: 'documented' }] };
const lineage = '# History\n```mermaid\nflowchart LR\n a["Context"] --> b["Work"]\n a --> c["Signal"]\n c --> b\n```';
const stages = '---\nstatus: conceptual-not-graduation\n---\n\n| 1 | Small task | No full task boundary |\n| 2 | Delegate task | Human still carries context |\n\n이 1→10은 조건부 설계 논증이다.\n\n## 두 방향과 실제 결과\n\nTop down sets scope; bottom up needs review and adoption.\n\nv0.4는 current selected thought experiment.';

describe('AX source boundaries', () => {
  test('preserves branch edges, design requirements and reported verification without promoting them to execution', () => {
    const out = parseAxSources(catalog, lineage, stages, []);
    expect(out.history.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'b' }]);
    expect(out.stages[1].nextRequirement).toContain('Human still carries context');
    expect(out.stageStatus).toBe('conceptual-not-graduation');
    expect(out.nodes[0].verification).toBe('proposed');
    expect(out.dualFlowNote).toContain('review and adoption');
    expect(JSON.stringify(out)).not.toContain('never-copy');
  });
  test('refuses dangling system edges instead of inventing a connected component', () => {
    expect(() => parseAxSources({ ...catalog, relations: [{ from: 'a', to: 'missing' }] }, lineage, stages, [])).toThrow();
  });
  test('optional or missing AX source is not a successful empty model', () => {
    expect(loadAxSource(undefined)).toEqual({ status: 'missing', data: null });
    expect(loadAxSource('relative')).toEqual({ status: 'invalid', data: null });
  });
  test('local import records all three source hashes and does not read other files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-ax-'));
    const files = { 'architecture/catalog.json': JSON.stringify(catalog), 'maps/lineage.md': lineage, 'records/2026/10/ax-20261021-ten-stage-ax-model.md': stages };
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    const result = loadAxSource(dir); expect(result.status).toBe('ready');
    expect(result.data?.sources.map(s => s.path)).toEqual(Object.keys(files));
    expect(result.data?.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
    fs.writeFileSync(path.join(dir, 'architecture/catalog.json'), '{}');
    expect(loadAxSource(dir).status).toBe('invalid');
  });
});
