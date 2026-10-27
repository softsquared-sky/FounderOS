'use client';
import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, GitBranch, Network, ShieldCheck } from 'lucide-react';
import type { AxLoad } from '@/lib/star/ax-model';

// This is a navigation map of the existing Star contract, never an executor or a grant.
const LOOP = [
  { title: '상황 수신', subtitle: '알림 · 상세 전사 · 직접 요청', detail: '수신한 사건을 단서로 보존합니다. 알림 수신 자체를 사실 확인이나 신규 업무로 바꾸지 않습니다.', view: 'knowledge' },
  { title: '원문·기억 대조', subtitle: '기존 맥락 · 정본 · 같은 티켓', detail: '원래 채널과 최신 정본을 대조하고, 이미 진행하던 업무를 찾습니다. 회의는 상세 전사만 확인합니다.', view: 'knowledge' },
  { title: '판단·업무 연결', subtitle: '검수 · 근거 · 다음 행동', detail: '맥락과 관련성, 구체 행동, 시점, 기존 업무 관계, 사실과 불확실성을 구분합니다. 같은 업무를 이어갑니다.', view: 'review' },
  { title: '최종안 승인', subtitle: '대상 · 본문 · 첨부 · 영향', detail: '준비된 최종안을 사람이 검토합니다. 판단에 대한 동의와 실제 외부 실행 승인은 별개입니다.', view: 'review' },
  { title: '기존 업무 실행', subtitle: '고정 티켓 · 소유 세션', detail: '승인된 범위 안에서 기존 티켓과 세션을 이어갑니다. 새 작업이 접수된 상태와 실제 실행 완료를 구분합니다.', view: 'running' },
  { title: '검증·후속·교정', subtitle: '영수증 · 회신 조건 · 배움', detail: '원본과 사본, 실제 결과를 따로 확인합니다. 외부 인터랙션 뒤 회신 감지를 연결하고, 해결된 조건만 닫습니다. 교정은 검토·재시험·채택 뒤 정본에 반영합니다.', view: 'waiting' },
];
const kst = (s: string) => Number.isFinite(Date.parse(s)) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(s)) : '시각 미확인';

export function AxFlowView({ source, onView }: { source: AxLoad | undefined; onView: (view: string) => void }) {
  const [tab, setTab] = useState('loop'); const [step, setStep] = useState(0); const [nodeId, setNodeId] = useState('agentos');
  const data = source?.data; const node = data?.nodes.find(n => n.id === nodeId) ?? data?.nodes[0];
  return <section className="star-ax">
    <div className="star-ax-tabs" role="tablist" aria-label="AX 흐름 보기">{[{ id: 'loop', label: '운영 루프' }, { id: 'history', label: '발전 계보' }, { id: 'stages', label: '1→10 설계' }, { id: 'system', label: '시스템 연결' }].map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
    {tab === 'loop' && <>
      <div className="star-ax-intro"><GitBranch size={21}/><div><h2>받고, 판단하고, 실행하고, 다시 배우는 흐름</h2><p>각 단계는 별도의 근거와 승인 조건을 갖습니다. 이 포크에서는 기존 스타의 업무를 읽고 해당 보기로 연결합니다.</p></div></div>
      <div className="star-loop">{LOOP.map((s, i) => <div className="star-loop-cell" key={s.title}><button className={step === i ? 'selected' : ''} onClick={() => setStep(i)} aria-pressed={step === i}><small>{String(i + 1).padStart(2, '0')}</small><strong>{s.title}</strong><span>{s.subtitle}</span></button>{i < LOOP.length - 1 && <ArrowRight size={15} aria-hidden/>}</div>)}</div>
      <div className="star-loop-return"><ArrowDown size={14}/>실제 회신·실패·교정은 원문 대조와 다음 판단으로 돌아갑니다.</div>
      <article className="star-flow-detail"><div><span className="star-eyebrow">SELECTED STEP / {String(step + 1).padStart(2, '0')}</span><h3>{LOOP[step].title}</h3><p>{LOOP[step].detail}</p></div><button className="star-outline" onClick={() => onView(LOOP[step].view)}>관련 보기 열기 <ArrowUpRight size={14}/></button></article>
      <div className="star-dual-flow"><article><span>TOP DOWN</span><h3>목적·원칙을 업무 조건으로</h3><p>목적·합의된 기준 <ChevronRight size={12}/> 책임·권한·보상 <ChevronRight size={12}/> 위임 범위·실행 조건</p></article><article><span>BOTTOM UP</span><h3>현장 근거를 검토해 새 버전으로</h3><p>요청·수행·실패·반론 <ChevronRight size={12}/> 근거 검토·채택 <ChevronRight size={12}/> 정본의 새 버전</p></article></div>
      <p className="star-ax-boundary"><ShieldCheck size={15}/>실행 승인과 정본 채택은 서로 다른 결정입니다. 이 화면은 새 자동 실행·위임을 활성화하지 않습니다.</p>
    </>}
    {!data && tab !== 'loop' && <div className="star-empty"><Network size={26}/><h2>AX 계보 원본을 연결해 주세요.</h2><p>{source?.status === 'invalid' ? '원본 구조를 읽을 수 없습니다.' : '로컬 STAR_AX_DIR 설정 후 스타에서 가져오기를 누르면 계보와 설계 원문을 표시합니다.'}</p></div>}
    {data && <>
      {tab === 'history' && <><div className="star-ax-intro"><GitBranch size={21}/><div><h2>하늘의 AX가 이어진 계보</h2><p>화살표는 기록에 채택된 기능 확장 관계입니다. 기술 호출이나 모든 사람의 필수 도입 순서를 뜻하지 않습니다.</p></div></div><div className="star-lineage">{data.history.nodes.map(n => <article key={n.id}><span className="star-lineage-id">{n.id.toUpperCase()}</span><h3>{n.name}</h3><div>{data.history.edges.filter(e => e.from === n.id).map(e => <p key={e.to}><ArrowRight size={12}/>{data.history.nodes.find(x => x.id === e.to)?.name}</p>)}</div></article>)}</div></>}
      {tab === 'stages' && <><div className="star-ax-intro"><Network size={21}/><div><h2>앞 구성의 한계가, 다음 구성을 요구하는 이유</h2><p>{data.stageNote}</p></div></div><div className="star-stage-list">{data.stages.map(s => <details key={s.number}><summary><span>{String(s.number).padStart(2, '0')}</span><strong>{s.title}</strong><ChevronRight size={16}/></summary><div><small>남는 한계 · 다음 요건</small><p>{s.nextRequirement}</p>{s.number < data.stages.length && <span className="star-stage-next">다음 구성 <ArrowRight size={13}/>{data.stages.find(t => t.number === s.number + 1)?.title}</span>}</div></details>)}</div><details className="star-ax-notes"><summary>판본 선택과 해석 범위</summary><p>{data.versionNote}</p><code>{data.stageStatus}</code></details></>}
      {tab === 'system' && <><div className="star-ax-intro"><Network size={21}/><div><h2>같은 스타, 서로 다른 실행 환경과 저장소</h2><p>기록 기준 {kst(data.asOf)} · 연결의 검증 수준과 시각은 원본 그대로 표시합니다. 실시간 가동 상태가 아닙니다.</p></div></div><label className="star-ax-select">구성요소<select aria-label="AX 구성요소" value={node?.id ?? ''} onChange={e => setNodeId(e.target.value)}>{data.nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>{node && <article className="star-system-detail"><h3>{node.name}</h3><p>{node.responsibility}</p><div><span className="star-badge">{node.verification}</span><small>{kst(node.asOf)}</small></div><h4>연결된 흐름</h4>{data.relations.filter(r => r.from === node.id || r.to === node.id).map((r, i) => <button key={i} onClick={() => setNodeId(r.from === node.id ? r.to : r.from)}><strong>{data.nodes.find(n => n.id === r.from)?.name}<ArrowRight size={13}/>{data.nodes.find(n => n.id === r.to)?.name}</strong><span>{r.label}</span><small>{r.verification}</small></button>)}</article>}</>}
      <details className="star-ax-notes"><summary>AX 원본과 확인 범위</summary><p>{data.dualFlowNote}</p><p>아래 파일을 로컬에서 읽은 사본입니다. 개인 계보 원문은 공개 포크에 포함하지 않습니다.</p>{data.sources.map(s => <div className="star-ax-source" key={s.path}><span>{s.path}</span><code>{s.sha256}</code></div>)}{data.limitations.map((l, i) => <p key={i}>{l}</p>)}</details>
    </>}
  </section>;
}
