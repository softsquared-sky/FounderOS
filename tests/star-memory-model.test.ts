import { expect, test } from 'vitest';
import { MemoryQuery, MemoryRead, memoryGraph, memorySearch } from '@/lib/star/memory-model';

test('accepts bounded queries and refuses caller-selected banks, hosts and paths', () => {
  expect(MemoryQuery.safeParse({ query: '검토', bank_id: 'person-hanul' }).success).toBe(false);
  expect(MemoryRead.safeParse({ mode: 'graph', url: 'https://other.test' }).success).toBe(false);
  expect(MemoryRead.safeParse({ mode: 'graph', limit: 181 }).success).toBe(false);
  expect(MemoryRead.safeParse({ mode: 'detail', id: '../person-hanul' }).success).toBe(false);
  expect(MemoryQuery.safeParse({ query: ' '.repeat(100) }).success).toBe(false);
});
test('keeps actual edge types and weights from the Cytoscape API; never invents dangling edges', () => {
  const graph = memoryGraph({ nodes: [{ data: { id: 'a', text: '원문', fact_type: 'world' } }, { data: { id: 'b', text: '관찰', type: 'observation' } }], edges: [{ data: { source: 'a', target: 'b', linkType: 'semantic', weight: .7 } }, { data: { source: 'a', target: 'missing', linkType: 'entity' } }], total_units: 20 }, 120);
  expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'semantic', weight: .7 }]);
  expect(graph).toMatchObject({ total: 20, limited: true, omittedEdges: 1 });
  expect(() => memoryGraph({ nodes: [{ data: { id: 'a' } }, { data: { id: 'a' } }], edges: [] }, 120)).toThrow();
});
test('complete source evidence preserves negation, document and source facts', () => {
  const out = memorySearch({ results: [{ id: 'o', text: '승인은 실행 완료가 아니다.', type: 'observation', source_fact_ids: ['f'] }], source_facts: { f: { id: 'f', text: '제안만 했다.', chunk_id: 'c' } }, chunks: { c: { text: '아직 발송하지 않았다.', document_id: 'doc', truncated: false } } });
  expect(out.results[0]).toMatchObject({ evidenceComplete: true, text: '승인은 실행 완료가 아니다.', evidence: [{ text: '아직 발송하지 않았다.', documentId: 'doc', truncated: false }] });
});
test('joins missing graph types by exact memory ID, never text similarity or row order', () => {
  const g = memoryGraph({ nodes:[{data:{id:'b',text:'같은 문구'}},{data:{id:'a',text:'같은 문구'}}], edges:[], type_rows:[{id:'a',fact_type:'experience'},{id:'other',fact_type:'world'}] },120);
  expect(g.nodes.map(n=>n.type)).toEqual(['unknown','experience']);
});
test('missing, empty, truncated or omitted supporting originals stay unverified', () => {
  for (const chunks of [{}, { c: { text: '일부', truncated: true } }, { c: { text: '' , truncated: false } }]) {
    expect(memorySearch({ results: [{ id: 'a', chunk_id: 'c' }], chunks }).results[0].evidenceComplete).toBe(false);
  }
  expect(memorySearch({ results: [{ id: 'o', source_fact_ids: ['missing'], chunk_id: 'c' }], chunks: { c: { text: '원문', truncated: false } }, source_facts_truncated: true })).toMatchObject({ limited: true, results: [{ evidenceComplete: false }] });
});
