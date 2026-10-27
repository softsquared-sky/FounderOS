'use client';
import { useEffect, useRef, useState } from 'react';
import { Network, Search, RefreshCw, ShieldCheck } from 'lucide-react';
import { MemoryForceGraph } from './MemoryForceGraph';
import type { MemoryDetail, MemoryGraph, MemorySearch, MemoryStats } from '@/lib/star/memory-model';
const when = (s: string) => s && Number.isFinite(Date.parse(s)) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)) : '시각 미확인';
type GraphResult = MemoryGraph & { bank: string; checkedAt: string };
async function api(url: string, body?: object) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), cache: 'no-store' });
  const data = await r.json(); if (!r.ok) throw Error(data.error || '기억 조회에 실패했습니다.'); return data;
}
export function MemoryWorkspace() {
  const [stats, setStats] = useState<MemoryStats | null>(null); const [statusError, setStatusError] = useState('');
  const [tab, setTab] = useState('search'); const [query, setQuery] = useState(''); const [type, setType] = useState('all');
  const [graph, setGraph] = useState<GraphResult | null>(null); const [results, setResults] = useState<MemorySearch | null>(null); const [searched, setSearched] = useState('');
  const [detail, setDetail] = useState<MemoryDetail | null>(null); const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const serial = useRef(0); const mounted = useRef(true);
  const check = async () => { setBusy('status'); setStatusError(''); try { const d = await api('/api/star/memory?mode=status'); if (mounted.current) setStats(d); } catch (e) { if (mounted.current) setStatusError((e as Error).message); } finally { if (mounted.current) setBusy(''); } };
  useEffect(() => { mounted.current = true; void check(); return () => { mounted.current = false; serial.current++; }; }, []);
  const run = async () => {
    const id = ++serial.current; setBusy(tab); setError(''); setDetail(null); setSelected('');
    try {
      if (tab === 'search') { const d = await api('/api/star/memory', { query: query.trim(), ...(type === 'all' ? {} : { types: [type] }) }); if (id === serial.current && mounted.current) { setResults(d); setSearched(query.trim()); } }
      else { const p = new URLSearchParams({ mode: 'graph', limit: '120', ...(query.trim() ? { q: query.trim() } : {}), ...(type === 'all' ? {} : { type }) }); const d = await api('/api/star/memory?' + p); if (id === serial.current && mounted.current) setGraph(d); }
    } catch (e) { if (id === serial.current && mounted.current) setError((e as Error).message); }
    finally { if (id === serial.current && mounted.current) setBusy(''); }
  };
  const select = async (id: string) => {
    const request = ++serial.current; setSelected(id); setDetail(null); setBusy('detail'); setError('');
    try { const d = await api('/api/star/memory?mode=detail&id=' + encodeURIComponent(id)); if (request === serial.current && mounted.current) setDetail(d); }
    catch (e) { if (request === serial.current && mounted.current) setError((e as Error).message); }
    finally { if (request === serial.current && mounted.current) setBusy(''); }
  };
  return <section className="star-memory">
    <div className="star-memory-bank"><div><Network size={21}/><div><strong>Hindsight · agent-star</strong><p>기존 스타의 기억 뱅크를 직접 조회합니다.</p></div></div><button className="star-outline" disabled={!!busy} onClick={check}><RefreshCw size={14}/>연결 확인</button></div>
    {statusError && <div className="star-memory-setup" role="alert"><h2>기억 연결을 확인해 주세요.</h2><p>{statusError}</p><p>서버에 기존 연결 파일을 STAR_HINDSIGHT_CREDENTIALS_FILE로 지정하거나, Hindsight API 주소와 키 파일을 설정합니다. 인증값은 서버에서만 읽습니다.</p></div>}
    <div className="star-memory-stats">{[{ value: stats?.nodes, label: '저장된 기억' }, { value: stats?.links, label: '관계' }, { value: stats?.documents, label: '원본 문서' }].map(s => <article key={s.label}><span>{s.label}</span><strong>{s.value?.toLocaleString('ko-KR') ?? '—'}</strong></article>)}<article><span>API 확인</span><p>{stats ? when(stats.checkedAt) : '연결 전'}</p>{stats && <small>마지막 기록 {when(stats.lastWrite)}</small>}</article></div>
    <div className="star-ax-tabs" role="tablist" aria-label="스타 기억 보기"><button role="tab" aria-selected={tab === 'search'} onClick={() => setTab('search')}>기억 검색</button><button role="tab" aria-selected={tab === 'graph'} onClick={() => setTab('graph')}>관계 그래프</button></div>
    <form className="star-memory-query" onSubmit={e => { e.preventDefault(); if (!busy && (tab === 'graph' || query.trim())) void run(); }}><label className="star-search"><Search size={17}/><input aria-label="스타 기억 검색어" value={query} maxLength={tab === 'graph' ? 300 : 500} onChange={e => setQuery(e.target.value)} placeholder={tab === 'search' ? '기억에서 찾을 맥락을 입력하세요' : '그래프의 원문·맥락 키워드 (선택)'}/></label><select aria-label="기억 유형" value={type} onChange={e => setType(e.target.value)}><option value="all">모든 유형</option><option value="world">사실</option><option value="experience">경험</option><option value="observation">종합 관찰</option></select><button className="star-primary" disabled={!!busy || (tab === 'search' && !query.trim())}>{busy ? '조회 중…' : tab === 'search' ? '기억 검색' : '그래프 불러오기'}</button></form>
    {error && <p className="star-refresh-error" role="alert">{error}{graph || results ? ' · 이전 조회 결과는 유지됩니다.' : ''}</p>}
    {tab === 'search' && (results ? <div className="star-memory-results"><p className="star-memory-caption">‘{searched}’ · {results.results.length}개 검색 결과{results.limited ? ' · 응답 범위 제한 있음' : ''}</p>{!results.results.length && <div className="star-empty">현재 검색에 맞는 기억이 없습니다. 다른 표현으로 검색해 보세요.</div>}{results.results.map(r => <article key={r.id}><header><span className={'star-badge memory-' + r.type}>{r.type}</span><time>{when(r.mentionedAt)}</time><span className="star-memory-proof">{r.evidenceComplete ? '원문 조각 포함 · 내용 대조 필요' : '원문 근거 불완전'}</span></header><p className="star-memory-fact">{r.text}</p><small>{r.context}</small><details><summary>출처·근거 확인</summary><code>{r.documentId || '원본 문서 ID 미기록'} / {r.id}</code>{r.supports.map(s => <p key={s.id} className="star-memory-support">근거 사실 · {s.text}</p>)}{r.evidence.map(c => <section key={c.id}><strong>{c.truncated ? '절단된 원문 조각 · 미검증' : '저장된 원문 조각'}</strong><code>{c.documentId || c.id}</code><pre>{c.text}</pre></section>)}{!r.evidence.length && <p>응답에 원문이 없습니다. 이 기억을 확인된 정본으로 취급하지 마세요.</p>}</details><button className="star-text-button" disabled={!!busy} onClick={() => void select(r.id)}>기억 상세 확인</button></article>)}</div> : <div className="star-empty"><Search size={25}/><h2>기억에서 맥락을 찾아보세요.</h2><p>검색할 때만 기존 뱅크를 조회합니다. 결과를 별도 저장소로 복사하지 않습니다.</p></div>)}
    {tab === 'graph' && (graph ? <><p className="star-memory-caption">{graph.nodes.length}개 기억 · {graph.edges.length}개 관계 · {when(graph.checkedAt)} 조회{graph.total !== null && ` · 해당 범위 전체 ${graph.total.toLocaleString('ko-KR')}개`}{graph.limited && ' · 일부 표시'}{graph.omittedEdges > 0 && ` · 표시 노드 밖 관계 ${graph.omittedEdges}개 제외`}</p>{graph.nodes.length ? <MemoryForceGraph graph={graph} selected={selected} onSelect={id => void select(id)}/> : <div className="star-empty">현재 조건에 맞는 그래프 노드가 없습니다.</div>}<label className="star-memory-node-picker">기억 선택<select aria-label="그래프 기억 선택" value={selected} disabled={!!busy} onChange={e => { if (e.target.value) void select(e.target.value); }}><option value="">그래프 또는 목록에서 선택</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{n.text.slice(0, 90)}</option>)}</select></label></> : <div className="star-empty"><Network size={27}/><h2>실제 기억의 관계를 탐색하세요.</h2><p>불러오기를 누르면 최대 120개 노드와 그 사이에 저장된 관계를 표시합니다.</p></div>)}
    {detail && <article className="star-memory-detail"><header><h2>선택한 기억과 근거</h2><span className="star-badge">{detail.fact.type}</span></header><p className="star-memory-fact">{detail.fact.text}</p><dl><dt>문서</dt><dd>{detail.fact.documentId || '미기록'}</dd><dt>언급 시각</dt><dd>{when(detail.fact.mentionedAt)}</dd><dt>발생 시각</dt><dd>{when(detail.fact.occurredAt)}</dd></dl>{detail.chunk ? <details open><summary>저장된 원문 조각</summary><pre>{detail.chunk.text}</pre></details> : <p>직접 연결된 원문 조각이 없습니다. 종합 관찰은 근거 사실과 원문을 따로 대조해야 합니다.</p>}{detail.fact.sourceIds.length > 0 && <details><summary>근거 사실 {detail.fact.sourceIds.length}개</summary>{detail.fact.sourceIds.map(id => <button className="star-text-button" key={id} disabled={!!busy} onClick={() => void select(id)}>{id}</button>)}</details>}</article>}
    <p className="star-ax-boundary"><ShieldCheck size={15}/>기억과 종합 관찰은 해석을 포함합니다. 원문·현재 정본을 대조하세요. 이 연결은 기억 추가·수정·삭제·Reflect를 실행하지 않습니다.</p>
  </section>;
}
