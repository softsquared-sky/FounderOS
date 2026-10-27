'use client';
import { useMemo, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';
import type { MemoryGraph } from '@/lib/star/memory-model';

type Node = MemoryGraph['nodes'][number] & SimulationNodeDatum;
const colour = (type: string) => type === 'world' ? 'var(--star-accent)' : type === 'experience' ? 'var(--star-memory-purple)' : type === 'observation' ? 'var(--star-amber)' : 'var(--star-muted)';
export function MemoryForceGraph({ graph, selected, onSelect }: { graph: MemoryGraph; selected: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const layout = useMemo(() => {
    const nodes: Node[] = graph.nodes.map(n => ({ ...n }));
    const edges = graph.edges.map(e => ({ ...e }));
    const sim = forceSimulation(nodes).force('link', forceLink<Node, any>(edges).id(n => n.id).distance(65).strength(.15)).force('charge', forceManyBody().strength(-85)).force('collision', forceCollide(12)).force('center', forceCenter(0, 0)).stop();
    sim.tick(170); sim.stop();
    const extent = Math.max(.01, ...nodes.map(n => Math.max(Math.abs(n.x ?? 0) / 400, Math.abs(n.y ?? 0) / 230)));
    for (const n of nodes) { n.x = (n.x ?? 0) / extent; n.y = (n.y ?? 0) / extent; }
    return { nodes, edges: edges as unknown as { source: Node; target: Node; type: string }[] };
  }, [graph]);
  const connected = new Set(graph.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target]));
  return <div className="star-memory-canvas">
    <div className="star-memory-zoom"><button aria-label="그래프 축소" onClick={() => setZoom(z => Math.max(.5, z - .25))}>−</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="그래프 확대" onClick={() => setZoom(z => Math.min(2, z + .25))}>＋</button></div>
    <svg viewBox={`${-450 / zoom} ${-280 / zoom} ${900 / zoom} ${560 / zoom}`} role="img" aria-label={`스타 기억 ${graph.nodes.length}개와 실제 관계 ${graph.edges.length}개`}>
      {layout.edges.map((e, i) => <line key={i} x1={e.source.x} y1={e.source.y} x2={e.target.x} y2={e.target.y} className={'star-memory-edge ' + (selected && [e.source.id, e.target.id].includes(selected) ? 'focused' : '')} strokeDasharray={e.type === 'temporal' ? '4 4' : undefined}><title>{e.type}</title></line>)}
      {layout.nodes.map(n => <g key={n.id} transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0} aria-label={'기억 열기: ' + n.text.slice(0, 80)} aria-pressed={n.id === selected} onClick={() => onSelect(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id); } }} opacity={!selected || n.id === selected || connected.has(n.id) ? 1 : .25}>
        <circle r={n.id === selected ? 9 : 6} fill={colour(n.type)} stroke={n.id === selected ? 'var(--star-text)' : 'var(--star-surface)'} strokeWidth={2}/><title>{n.text}</title>{(n.id === selected || graph.nodes.length <= 6) && <text x={12} y={4}>{n.text.slice(0, 30)}{n.text.length > 30 ? '…' : ''}</text>}
      </g>)}
    </svg>
    <div className="star-memory-legend"><span><i style={{ background: colour('world') }}/>사실</span><span><i style={{ background: colour('experience') }}/>경험</span><span><i style={{ background: colour('observation') }}/>종합 관찰</span><span><i style={{ background: colour('unknown') }}/>유형 미확인</span><small>선은 저장된 의미·시간·개체 관계입니다. 배치는 보기용입니다.</small></div>
  </div>;
}
