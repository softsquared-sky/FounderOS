import { z } from 'zod';

export const AxSnapshotSchema = z.object({
  asOf: z.string(), scope: z.string(), limitations: z.array(z.string()),
  sources: z.array(z.object({ path: z.string(), sha256: z.string() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), responsibility: z.string(), verification: z.string(), asOf: z.string() })),
  relations: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), verification: z.string() })),
  history: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })), edges: z.array(z.object({ from: z.string(), to: z.string() })) }),
  stages: z.array(z.object({ number: z.number(), title: z.string(), nextRequirement: z.string() })),
  stageStatus: z.string(), stageNote: z.string(), dualFlowNote: z.string(), versionNote: z.string(),
});
export const AxLoadSchema = z.object({ status: z.enum(['ready', 'missing', 'invalid']), data: AxSnapshotSchema.nullable() });
export type AxSnapshot = z.infer<typeof AxSnapshotSchema>;
export type AxLoad = z.infer<typeof AxLoadSchema>;

/** Markdown is parsed as data, never executed or passed to a model. */
export function parseAxSources(catalog: Record<string, any>, lineage: string, stages: string, sources: AxSnapshot['sources']): AxSnapshot {
  const graph = lineage.match(/```mermaid\s+([\s\S]*?)```/)?.[1] ?? '';
  const historyNodes = [...graph.matchAll(/\b(\w+)\["([^"]+)"\]/g)].map(m => ({ id: m[1], name: m[2] }));
  const unique = [...new Map(historyNodes.map(n => [n.id, n])).values()];
  const ids = new Set(unique.map(n => n.id));
  const edges = [...graph.matchAll(/\b(\w+)(?:\["[^"]+"\])?\s*-->\s*(\w+)(?:\["[^"]+"\])?/g)]
    .map(m => ({ from: m[1], to: m[2] })).filter(e => ids.has(e.from) && ids.has(e.to));
  const rows = stages.split(/\r?\n/).filter(line => /^\|\s*\d+\s*\|/.test(line)).map(line => {
    const cells = line.split('|').map(c => c.trim());
    return { number: Number(cells[1]), title: cells[2], nextRequirement: cells[3] };
  });
  const paragraph = (heading: string) => stages.split(heading)[1]?.trim().split(/\r?\n\r?\n/)[0] ?? '';
  const stageNote = stages.split(/\r?\n\r?\n/).find(p => p.startsWith('이 1→10은')) ?? '';
  const versionNote = stages.split(/\r?\n\r?\n/).find(p => p.startsWith('v0.4는')) ?? '';
  const nodes = (catalog.nodes ?? []).map((n: Record<string, any>) => ({ id: n.id, name: n.name, kind: n.kind ?? '', responsibility: n.responsibility ?? '', verification: n.verification ?? 'unknown', asOf: n.evidence_as_of ?? '' }));
  const nodeIds = new Set(nodes.map((n: { id: string }) => n.id));
  const relations = (catalog.relations ?? []).map((r: Record<string, any>) => ({ from: r.from, to: r.to, label: r.label ?? '', verification: r.verification ?? 'unknown' }));
  if (!nodes.length || !unique.length || !rows.length || relations.some((r: { from: string; to: string }) => !nodeIds.has(r.from) || !nodeIds.has(r.to))) throw new Error('AX source structure incomplete');
  return AxSnapshotSchema.parse({ asOf: catalog.as_of ?? '', scope: catalog.scope ?? '', limitations: catalog.limitations ?? [], sources, nodes, relations, history: { nodes: unique, edges }, stages: rows, stageStatus: stages.match(/^status:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown', stageNote, dualFlowNote: paragraph('## 두 방향과 실제 결과'), versionNote });
}
