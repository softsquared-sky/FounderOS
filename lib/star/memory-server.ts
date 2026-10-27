import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STAR_MEMORY_BANK, memoryFact, memoryGraph, memorySearch, type MemoryStats } from './memory-model';

export class MemoryConnectionError extends Error {
  constructor(public code: 'not_configured' | 'invalid_config' | 'authentication_required' | 'unavailable' | 'invalid_response' | 'not_found', public stage?: string, public upstreamStatus?: number) { super(code); }
}
export function memoryConnection() {
  const credentialFile = process.env.STAR_HINDSIGHT_CREDENTIALS_FILE;
  let shared: Record<string, string> = {};
  if (credentialFile) {
    try {
      if (!path.isAbsolute(credentialFile) || fs.statSync(credentialFile).size > 8192) throw Error();
      for (const line of fs.readFileSync(credentialFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) shared[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch { throw new MemoryConnectionError('invalid_config'); }
  }
  const controlPlane = Boolean(credentialFile);
  const raw = controlPlane ? shared.HINDSIGHT_DASHBOARD_URL : process.env.STAR_HINDSIGHT_URL;
  if (!raw) throw new MemoryConnectionError('not_configured');
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error();
    let key = controlPlane ? shared.HINDSIGHT_DASHBOARD_ACCESS_KEY : process.env.STAR_HINDSIGHT_API_KEY ?? '';
    if (controlPlane && !key) throw Error();
    const file = process.env.STAR_HINDSIGHT_API_KEY_FILE;
    if (!controlPlane && file) { if (!path.isAbsolute(file) || fs.statSync(file).size > 8192) throw Error(); key = fs.readFileSync(file, 'utf8').trim(); }
    if (key.length > 8192 || /[\r\n]/.test(key)) throw Error();
    return { base: url.href.replace(/\/$/, ''), key, controlPlane };
  } catch { throw new MemoryConnectionError('invalid_config'); }
}

let session: { signature: string; cookie: string; expires: number } | null = null;
let authenticating: { signature: string; promise: Promise<string> } | null = null;
async function controlPlaneCookie(base: string, key: string): Promise<string> {
  const signature = createHash('sha256').update(base + '\0' + key).digest('hex');
  if (session?.signature === signature && session.expires > Date.now()) return session.cookie;
  if (authenticating?.signature === signature) return authenticating.promise;
  const promise = (async () => {
    let r: Response;
    try { r = await fetch(base + '/api/auth/login', { method: 'POST', body: JSON.stringify({ key }), headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw new MemoryConnectionError('unavailable', 'authentication'); }
    if (!r.ok) throw new MemoryConnectionError(r.status === 401 || r.status === 403 ? 'authentication_required' : 'unavailable', 'authentication', r.status);
    try { if ((await r.json()).success !== true) throw Error(); } catch { throw new MemoryConnectionError('authentication_required'); }
    const values = r.headers.getSetCookie();
    const cookie = values.map(v => v.split(';')[0]).filter(v => /^[\w-]+=[^\r\n;]+$/.test(v)).join('; ');
    if (!cookie) throw new MemoryConnectionError('authentication_required');
    session = { signature, cookie, expires: Date.now() + 10 * 60_000 }; return cookie;
  })();
  authenticating = { signature, promise };
  try { return await promise; } finally { if (authenticating?.promise === promise) authenticating = null; }
}

/** Read-only allowlist. Browser input can never choose a host, bank or method. */
async function request(suffix: string, body?: object, chunk = false): Promise<Record<string, any>> {
  const { base, key, controlPlane } = memoryConnection();
  let target = (chunk ? '/v1/default/chunks/' : `/v1/default/banks/${STAR_MEMORY_BANK}/`) + suffix;
  let payload = body;
  const auth: Record<string, string> = {};
  if (controlPlane) {
    auth.Cookie = await controlPlaneCookie(base, key);
    if (chunk) target = '/api/chunks?chunk_id=' + suffix;
    else if (suffix === 'stats') target = '/api/stats/' + STAR_MEMORY_BANK;
    else if (suffix.startsWith('graph?')) target = '/api/graph?bank_id=' + STAR_MEMORY_BANK + '&' + suffix.slice(6);
    else if (suffix.startsWith('memories/list?')) target = '/api/list?bank_id=' + STAR_MEMORY_BANK + '&' + suffix.slice(14);
    else if (suffix === 'memories/recall') { target = '/api/recall'; payload = { ...body, bank_id: STAR_MEMORY_BANK }; }
    else if (suffix.startsWith('memories/')) target = '/api/' + suffix + '?bank_id=' + STAR_MEMORY_BANK;
    else throw new MemoryConnectionError('invalid_config');
  } else if (key) auth.Authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(base + target,
      { method: payload ? 'POST' : 'GET', body: payload ? JSON.stringify(payload) : undefined, headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}), ...auth }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(payload ? 45000 : 20000) });
    // Older control planes used /api/chunks/[chunkId] (upstream #4772).
    // This is a scoped source ID from a verified bank fact, never user input.
    if (chunk && controlPlane && response.status === 404) {
      await response.body?.cancel();
      response = await fetch(base + '/api/chunks/' + suffix, { headers: { Accept: 'application/json', ...auth }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    }
  } catch { throw new MemoryConnectionError('unavailable', 'read'); }
  if (response.status === 401 || response.status === 403) { if (controlPlane) session = null; throw new MemoryConnectionError('authentication_required'); }
  if (response.status === 404) throw new MemoryConnectionError('not_found', chunk ? 'source_chunk' : suffix.startsWith('memories/') ? 'memory_detail' : 'read');
  if (!response.ok) throw new MemoryConnectionError('unavailable', 'read', response.status);
  try {
    // Bound bytes while streaming; no persistent cache or raw upstream logging.
    const reader = response.body?.getReader(); if (!reader) throw Error();
    const parts: Uint8Array[] = []; let bytes = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; if (bytes > 4_000_000) { await reader.cancel(); throw Error(); } parts.push(r.value); }
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.bank_id && data.bank_id !== STAR_MEMORY_BANK)) throw Error();
    return data;
  } catch { throw new MemoryConnectionError('invalid_response'); }
}

export async function memoryStatus(): Promise<MemoryStats> {
  const s = await request('stats');
  if (s.bank_id !== STAR_MEMORY_BANK || ![s.total_nodes, s.total_links, s.total_documents].every(n => Number.isInteger(n) && n >= 0)) throw new MemoryConnectionError('invalid_response');
  return { bank: STAR_MEMORY_BANK, nodes: s.total_nodes, links: s.total_links, documents: s.total_documents, types: Object.fromEntries(Object.entries(s.nodes_by_fact_type ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>, lastWrite: typeof s.last_memory_write_at === 'string' ? s.last_memory_write_at : '', checkedAt: new Date().toISOString() };
}
export async function readMemoryGraph(input: { q?: string; type?: string; limit: number }) {
  const q = new URLSearchParams({ limit: String(input.limit) }); if (input.q) q.set('q', input.q); if (input.type) q.set('type', input.type);
  try {
    const raw = await request('graph?' + q);
    // Older graph responses omit fact types. Join only exact IDs from a bank-
    // scoped, equally bounded list; failed enrichment leaves types unknown.
    let rows: unknown[] = [];
    if (Array.isArray(raw.nodes) && raw.nodes.length) {
      try { const listed = await request('memories/list?' + q); if (Array.isArray(listed.items)) rows = listed.items; } catch { /* the graph remains valid without optional type labels */ }
    }
    return { ...memoryGraph({ ...raw, type_rows: rows }, input.limit), bank: STAR_MEMORY_BANK, checkedAt: new Date().toISOString() };
  }
  catch (e) { if (e instanceof MemoryConnectionError) throw e; throw new MemoryConnectionError('invalid_response'); }
}
export async function searchMemory(input: { query: string; types?: string[] }) {
  try {
    const raw = await request('memories/recall', { query: input.query, ...(input.types?.length ? { types: input.types } : {}), budget: 'low', max_tokens: 3000, include: { chunks: { max_tokens: 10000 }, source_facts: { max_tokens: 3000 } } });
    return { ...memorySearch(raw), bank: STAR_MEMORY_BANK, checkedAt: new Date().toISOString() };
  } catch (e) { if (e instanceof MemoryConnectionError) throw e; throw new MemoryConnectionError('invalid_response'); }
}
export async function readMemoryDetail(id: string) {
  const raw = await request('memories/' + encodeURIComponent(id));
  if (raw.id !== id) throw new MemoryConnectionError('invalid_response');
  const fact = memoryFact(raw); let chunk = null;
  if (fact.chunkId) {
    // A chunk ID comes only from a bank-scoped fact, never a browser parameter.
    const c = await request(encodeURIComponent(fact.chunkId), undefined, true);
    if (c.bank_id !== STAR_MEMORY_BANK || c.document_id !== fact.documentId || typeof c.chunk_text !== 'string') throw new MemoryConnectionError('invalid_response');
    chunk = { id: fact.chunkId, text: c.chunk_text, documentId: fact.documentId, truncated: false };
  }
  return { fact, chunk, checkedAt: new Date().toISOString() };
}
