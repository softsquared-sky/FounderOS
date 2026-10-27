'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Search, RefreshCw, Inbox, Clock3, CheckCheck, LayoutDashboard, Network, BookOpen, Settings2, X, Copy, ArrowRight, CircleHelp, GitBranch } from 'lucide-react';
import { AxFlowView } from './AxFlowView';
import { selectTasks, snapshotOld, type StarLoad, type StarTask } from '@/lib/star/model';
import './star.css';

const filters = [{ id: 'all', label: '열린 업무', icon: LayoutDashboard }, { id: 'review', label: '확인할 일', icon: Inbox }, { id: 'running', label: '진행 중', icon: ArrowRight }, { id: 'waiting', label: '대기·예정', icon: Clock3 }, { id: 'done', label: '완료', icon: CheckCheck }];
const date = (s: string | null) => s && Number.isFinite(Date.parse(s)) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : '시각 미확인';
export function StarWorkspace({ initial }: { initial: StarLoad }) {
  const router = useRouter();
  const [filter, setFilter] = useState('all'); const [role, setRole] = useState('all'); const [query, setQuery] = useState('');
  const [section, setSection] = useState('tasks'); const [selected, setSelected] = useState<StarTask | null>(null); const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false); const [refreshError, setRefreshError] = useState('');
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true); setRefreshError('');
    try {
      const response = await fetch('/api/star/refresh', { method: 'POST' });
      if (!response.ok) throw new Error('refresh');
      router.refresh();
    } catch { setRefreshError('새 사본을 가져오지 못했습니다. 이전 사본을 유지합니다. 연결·설정을 확인해 주세요.'); }
    finally { setRefreshing(false); }
  };
  const snapshot = initial.snapshot; const tasks = snapshot?.tasks ?? []; const roles = snapshot?.roles ?? [];
  const rows = selectTasks(tasks, filter, role, query); const old = snapshot ? snapshotOld(snapshot.capturedAt) : false;
  const go = (id: string) => { setSection('tasks'); setFilter(id); };
  const count = (id: string) => selectTasks(tasks, id, 'all', '').length;
  const links = snapshot?.dashboardUrl ?? '';
  return <div className="star-app">
    <aside className="star-sidebar">
      <a className="star-brand" href="/star"><span className="star-mark">S</span><span>STAR<span className="star-brand-sub">하늘의 비서실</span></span></a>
      <div className="star-sidebar-caption">WORKSPACE <span>01</span></div>
      <nav aria-label="업무 보기">{filters.map(f => <button key={f.id} className={section === 'tasks' && filter === f.id ? 'active' : ''} onClick={() => go(f.id)}><f.icon size={17}/><span>{f.label}</span><small>{snapshot ? count(f.id) : '—'}</small></button>)}</nav>
      <nav aria-label="AX 계보"><button className={section === 'ax' ? 'active' : ''} onClick={() => setSection('ax')}><GitBranch size={17}/><span>AX 플로우</span></button></nav>
      <div className="star-sidebar-caption star-sidebar-caption-second">CONTEXT</div>
      <nav aria-label="업무 맥락"><button className={section === 'roles' ? 'active' : ''} onClick={() => setSection('roles')}><Network size={17}/>역할별 보기</button><button className={section === 'knowledge' ? 'active' : ''} onClick={() => setSection('knowledge')}><BookOpen size={17}/>지식·자료</button><button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}><Settings2 size={17}/>연결·설정</button></nav>
      <div className="star-sidebar-bottom"><span className="star-avatar">H</span><div>하늘<span>Asia / Seoul</span></div><span className="star-version">v0.1</span></div>
    </aside>
    <div className="star-main">
      <header className="star-topbar"><div>비서실 <span>/</span> {section === 'tasks' ? filters.find(f => f.id === filter)?.label : ({ ax: 'AX 플로우', roles: '역할별 보기', knowledge: '지식·자료', settings: '연결·설정' } as Record<string, string>)[section]}</div><span className="star-top-status"><i/>로컬 작업공간</span></header>
      <main className="star-content">
        <div className="star-eyebrow">YOUR WORK, WITH CONTEXT</div>
        <div className="star-heading"><div><h1>{section === 'tasks' ? '하늘님, 지금 볼 일부터.' : ({ ax: '맥락에서 판단으로, 실행에서 배움으로.', roles: '역할이 바뀌어도, 맥락은 이어지게.', knowledge: '필요한 자료로 바로.', settings: '연결 상태를 있는 그대로.' } as Record<string, string>)[section]}</h1><p>{section === 'ax' ? '계보·운영 흐름·설계 요건을 실제 근거와 구분해 봅니다.' : '판단할 일과 진행 중인 일을 한곳에서 확인하세요.'}</p></div><button className="star-outline" onClick={refresh} disabled={refreshing} aria-label={refreshing ? '스타 사본 가져오는 중' : '스타에서 가져오기'}><RefreshCw size={15}/>{refreshing ? '가져오는 중…' : '스타에서 가져오기'}</button></div>
        {refreshError && <p className="star-refresh-error" role="alert">{refreshError}</p>}
        <div className="star-source-strip"><span className={'star-source-dot ' + (snapshot && !old ? 'ready' : '')}/><strong>{snapshot ? (old ? '이전 사본' : '스타 사본 연결됨') : '연결 전'}</strong><span>{snapshot ? `${date(snapshot.capturedAt)} 가져옴 · 실시간 감시 아님` : '기존 스타의 읽기 전용 사본을 연결하면 업무가 표시됩니다.'}</span>{snapshot?.projection.status !== 'verified' && snapshot && <span className="star-warning">역할 정본 최신성 {snapshot.projection.status === 'stale' ? '재확인 필요' : '미확인'}</span>}</div>
        {!snapshot && <div className="star-empty"><CircleHelp size={28}/><h2>{initial.status === 'invalid' ? '사본 형식을 확인해 주세요.' : '데모 대신, 실제 업무를 기다립니다.'}</h2><p>연결·설정에서 기존 스타 사본을 가져오는 방법을 확인할 수 있습니다.</p><button className="star-primary" onClick={() => setSection('settings')}>연결 방법 보기</button></div>}
        {section === 'tasks' && <>
          <div className="star-stats">{[{ id: 'review', label: '내 확인이 필요한 일', detail: '승인 · 답변 · 결과 검토', icon: Inbox }, { id: 'running', label: '진행 중인 일', detail: '실행 · 순서 대기', icon: ArrowRight }, { id: 'waiting', label: '대기·예정된 일', detail: '회신 · 도움 · 예약 확인', icon: Clock3 }].map((f, i) => <button key={f.id} className={'star-stat star-stat-' + i} onClick={() => go(f.id)}><div><f.icon size={18}/><span>{f.label}</span><ArrowUpRight size={15}/></div><strong>{snapshot ? count(f.id) : '—'}</strong><small>{f.detail}</small></button>)}</div>
          <section className="star-work"><div className="star-work-heading"><div><h2>{filters.find(f => f.id === filter)?.label}</h2><span>{rows.length}개 업무</span></div><button className="star-text-button" onClick={() => { go('all'); setQuery('회신'); }}>회신 관련 찾기 <ArrowUpRight size={14}/></button></div>
            <div className="star-toolbar"><label className="star-search"><Search size={17}/><input aria-label="업무 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="업무, 다음 행동, 티켓 ID로 검색"/>{query && <button aria-label="검색 지우기" onClick={() => setQuery('')}><X size={14}/></button>}</label><select aria-label="담당 역할" value={role} onChange={e => setRole(e.target.value)}><option value="all">모든 역할</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div className="star-table-head"><span>업무와 다음 행동</span><span>역할</span><span>현재 상태</span><span>갱신</span></div>
            <div className="star-task-list">{rows.map(t => <button className="star-task-row" key={t.id} onClick={() => { setSelected(t); setCopied(false); }}><div className="star-task-title"><h3>{t.title}</h3><p>{t.nextAction || '다음 행동은 원본 티켓에서 확인하세요.'}</p></div><span className="star-role-name">{t.roleIds.map(id => roles.find(r => r.id === id)?.name ?? '역할 미확인').join(' · ') || '역할 미확인'}</span><span className={'star-badge star-lane-' + t.lane}>{t.label}</span><time>{date(t.updatedAt)}</time><ArrowUpRight className="star-row-arrow" size={15}/></button>)}</div>
            {!rows.length && snapshot && <div className="star-no-results">현재 조건에 맞는 업무가 없습니다.<button onClick={() => { setFilter('all'); setRole('all'); setQuery(''); }}>필터 초기화</button></div>}
          </section>
          <div className="star-footnote">대기·예정은 다른 보기와 겹칠 수 있습니다. 정본의 대기·도움·예약 상태만 모으며, 승인·발송·완료 처리는 기존 스타에서 이어갑니다.</div>
        </>}
        {section === 'roles' && <div className="star-role-grid">{roles.map((r, i) => <button key={r.id} onClick={() => { setRole(r.id); setQuery(''); go('all'); }}><span className="star-role-index">{String(i + 1).padStart(2, '0')}</span><Network size={21}/><h2>{r.name}</h2><p>열린 업무 {selectTasks(tasks, 'all', r.id, '').length}개</p><span className="star-text-button">업무 보기 <ArrowUpRight size={15}/></span></button>)}</div>}
        {section === 'knowledge' && <div className="star-info-grid"><article><BookOpen size={23}/><h2>기존 스타 브리핑·원문</h2><p>자료와 판단의 원본은 기존 스타에서 확인합니다. 이 화면은 업무 검색만 제공합니다.</p>{links && <a className="star-outline" href={links.replace(/#.*$/, '#briefing')} target="_blank" rel="noreferrer">스타 브리핑 열기 <ArrowUpRight size={15}/></a>}</article><article><Search size={23}/><h2>업무 맥락 찾기</h2><p>티켓 제목·다음 행동·정본 키를 검색하고, 역할로 범위를 좁힐 수 있습니다.</p><button className="star-outline" onClick={() => { setQuery(''); go('all'); }}>업무 검색으로 <ArrowRight size={15}/></button></article><article><Network size={23}/><h2>공유 기억</h2><p>Star의 기억은 기존 agent-star에 유지합니다. FounderOS의 별도 에이전트나 기억 복사본은 만들지 않았습니다.</p><span className="star-badge">기존 연결에서 사용</span></article></div>}
        {section === 'settings' && <div className="star-settings"><article><h2>현재 연결</h2><dl><dt>스타 업무 사본</dt><dd>{snapshot ? `${tasks.length}개 티켓 · ${date(snapshot.capturedAt)}` : '미연결'}</dd><dt>정본 역할 사본</dt><dd>{snapshot?.projection.status ?? '미연결'} · {date(snapshot?.projection.verifiedAt ?? null)}</dd><dt>자동 갱신·수집</dt><dd>사용하지 않음 · 수동 가져오기</dd><dt>모델·외부 발송</dt><dd>새 연결 없음 · 기존 스타에서 실행</dd></dl>{links && <a className="star-primary" href={links} target="_blank" rel="noreferrer">기존 스타 열기 <ArrowUpRight size={15}/></a>}</article><article><h2>사본 가져오기</h2><p>로컬 환경의 STAR_DASHBOARD_DIR을 기존 dashboard 폴더로 지정한 뒤 실행합니다. 기존 인증 클라이언트는 읽기 전용으로만 호출합니다.</p><code>npm run star:sync</code><p>화면의 ‘스타에서 가져오기’로도 갱신할 수 있습니다. 명령으로 가져온 뒤에는 페이지를 새로고침하세요. 실패하면 이전 사본을 유지하며, 15분이 지난 사본은 표시합니다.</p><h3>원본 FounderOS</h3><a className="star-text-button" href="/setup">원본 설정 열기 <ArrowUpRight size={14}/></a><p>영업·광고·콘텐츠 기능은 원본 경로에 보존했습니다. 이 비서실은 기존 스타 업무를 보는 전용 입구입니다.</p></article></div>}
        {section === 'ax' && <AxFlowView source={snapshot?.ax} onView={view => view === 'knowledge' ? setSection('knowledge') : go(view)} />}
        <footer className="star-footer"><span>STAR <span>/</span> FounderOS fork</span><span>판단은 명확하게. 실행은 이어지게.</span></footer>
      </main>
    </div>
    {selected && <div className="star-modal-backdrop" onClick={() => setSelected(null)}><section className="star-modal" role="dialog" aria-modal="true" aria-labelledby="star-detail-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelected(null); }}><button className="star-modal-close" aria-label="상세 닫기" onClick={() => setSelected(null)} autoFocus><X size={21}/></button><div className="star-eyebrow">TICKET CONTEXT</div><h2 id="star-detail-title">{selected.title}</h2><span className={'star-badge star-lane-' + selected.lane}>{selected.label}</span><h3>다음 행동</h3><p className="star-detail-action">{selected.nextAction || '사본에 다음 행동이 없습니다. 원본 티켓을 확인해 주세요.'}</p><dl><dt>티켓 저장 상태</dt><dd>{selected.localStatus}</dd><dt>정본 연결 상태</dt><dd>{selected.canonicalState ?? '미연결'}</dd><dt>정본</dt><dd className="star-source-key">{selected.sourceKey ?? '미연결'}{selected.sourceRevision !== null && ` @${selected.sourceRevision}`}</dd><dt>연결 확인 시각</dt><dd>{date(selected.verifiedAt)}</dd></dl><div className="star-detail-actions"><button className="star-outline" onClick={async () => { try { await navigator.clipboard.writeText(selected.id); setCopied(true); } catch { setCopied(false); } }}><Copy size={15}/>{copied ? '복사됨' : '티켓 ID 복사'}</button>{links && <a className="star-primary" href={links} target="_blank" rel="noreferrer">기존 스타에서 이어가기 <ArrowUpRight size={15}/></a>}</div><small>기존 스타의 업무 목록에서 같은 제목이나 티켓 ID로 찾아주세요.</small></section></div>}
  </div>;
}
