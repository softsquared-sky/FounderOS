import { z } from 'zod';

export const STAR_MEMORY_BANK = 'agent-star';
export const MemoryType = z.enum(['world', 'experience', 'observation']);
export const MemoryQuery = z.object({ query: z.string().trim().min(1).max(500), types: z.array(MemoryType).max(3).optional() }).strict();
export const MemoryRead = z.object({ mode: z.enum(['status', 'graph', 'detail']).default('status'), q: z.string().max(300).optional(), type: MemoryType.optional(), limit: z.coerce.number().int().min(1).max(180).default(120), id: z.string().regex(/^[\w-]{1,160}$/).optional() }).strict();
type Dict = Record<string, any>;
const str = (v: unknown) => typeof v === 'string' ? v : '';
export function memoryFact(raw: Dict) {
  return { id: str(raw.id), text: str(raw.text), type: str(raw.type ?? raw.fact_type) || 'unknown', context: str(raw.context), documentId: str(raw.document_id), chunkId: str(raw.chunk_id), mentionedAt: str(raw.mentioned_at), occurredAt: str(raw.occurred_start), sourceIds: Array.isArray(raw.source_fact_ids) ? raw.source_fact_ids.filter((x: unknown) => typeof x === 'string') as string[] : [] };
}
export type MemoryFact = ReturnType<typeof memoryFact>;
export type MemoryChunk = { id: string; text: string; documentId: string; truncated: boolean };
export function memoryGraph(raw: Dict, limit: number) {
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw Error('invalid graph');
  const rows = [...(Array.isArray(raw.table_rows) ? raw.table_rows : []), ...(Array.isArray(raw.type_rows) ? raw.type_rows : [])];
  const types = new Map(rows.filter((r: Dict) => MemoryType.safeParse(r.fact_type ?? r.type).success).map((r: Dict) => [r.id, r.fact_type ?? r.type]));
  // The HTTP API returns Cytoscape {data: ...}; older exports use flat objects.
  const nodes = raw.nodes.slice(0, limit).map((n: Dict) => {
    const d = n.data ?? n; const type = d.fact_type ?? d.factType ?? d.type;
    return { id: str(d.id), text: str(d.text ?? d.label), type: MemoryType.safeParse(type).success ? type as string : types.get(d.id) ?? 'unknown' };
  });
  if (nodes.some((n: { id: string }) => !n.id) || new Set(nodes.map((n: { id: string }) => n.id)).size !== nodes.length) throw Error('invalid nodes');
  const ids = new Set(nodes.map((n: { id: string }) => n.id));
  const edges = raw.edges.map((e: Dict) => {
    const d = e.data ?? e; return { source: str(d.source), target: str(d.target), type: str(d.linkType ?? d.link_type ?? d.type) || 'unknown', weight: typeof d.weight === 'number' && Number.isFinite(d.weight) ? d.weight : null };
  }).filter((e: { source: string; target: string }) => ids.has(e.source) && ids.has(e.target)).slice(0, 3000);
  return { nodes, edges, total: Number.isInteger(raw.total_units) ? raw.total_units as number : null, limited: raw.nodes.length >= limit || raw.total_units > nodes.length, omittedEdges: raw.edges.length - edges.length };
}
export type MemoryGraph = ReturnType<typeof memoryGraph>;
export function memorySearch(raw: Dict) {
  if (!Array.isArray(raw.results)) throw Error('invalid recall');
  const chunks: Record<string, MemoryChunk> = {};
  for (const [id, value] of Object.entries(raw.chunks ?? {}) as [string, Dict][]) chunks[id] = { id, text: str(value.text ?? value.chunk_text), documentId: str(value.document_id), truncated: value.truncated !== false };
  const sources: Record<string, MemoryFact> = {};
  for (const [id, value] of Object.entries(raw.source_facts ?? {}) as [string, Dict][]) sources[id] = memoryFact({ ...value, id });
  const results = raw.results.slice(0, 25).map((r: Dict) => {
    const fact = memoryFact(r); const supports = fact.sourceIds.map(id => sources[id]).filter(Boolean);
    const chunkIds = [...new Set([fact.chunkId, ...supports.map(s => s.chunkId)].filter(Boolean))];
    const evidence = chunkIds.map(id => chunks[id]).filter(Boolean);
    const complete = evidence.length > 0 && supports.length === fact.sourceIds.length && chunkIds.length === evidence.length && evidence.every(c => c.text && !c.truncated);
    return { ...fact, evidence, supports, evidenceComplete: complete };
  });
  return { results, limited: raw.results.length > results.length || raw.source_facts_truncated === true };
}
export type MemorySearch = ReturnType<typeof memorySearch>;
export type MemoryStats = { bank: string; nodes: number; links: number; documents: number; types: Record<string, number>; lastWrite: string; checkedAt: string };
export type MemoryDetail = { fact: MemoryFact; chunk: MemoryChunk | null; checkedAt: string };
