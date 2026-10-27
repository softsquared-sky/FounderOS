import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryConnection, memoryStatus, readMemoryDetail, readMemoryGraph, searchMemory } from '@/lib/star/memory-server';
let sequence = 0; const fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); for (const key of ['STAR_HINDSIGHT_URL','STAR_HINDSIGHT_API_KEY','STAR_HINDSIGHT_API_KEY_FILE','STAR_HINDSIGHT_CREDENTIALS_FILE']) vi.stubEnv(key,''); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const stats = { bank_id: 'agent-star', total_nodes: 2, total_links: 1, total_documents: 1, secret: 'never-return' };
function controlPlane() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'star-memory-')), 'credentials.env');
  fs.writeFileSync(file, `HINDSIGHT_DASHBOARD_URL=https://memory.test\nHINDSIGHT_DASHBOARD_ACCESS_KEY=fixture-${++sequence}\n`);
  vi.stubEnv('STAR_HINDSIGHT_CREDENTIALS_FILE', file);
  return file;
}
test('missing and malformed configuration do not make an upstream request', async () => {
  await expect(memoryStatus()).rejects.toMatchObject({ code: 'not_configured' });
  vi.stubEnv('STAR_HINDSIGHT_URL','https://user:pass@memory.test'); expect(() => memoryConnection()).toThrow();
  vi.stubEnv('STAR_HINDSIGHT_URL','http://public.test'); expect(() => memoryConnection()).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
test('dataplane reads only agent-star and drops unrelated response fields', async () => {
  vi.stubEnv('STAR_HINDSIGHT_URL','https://memory.test'); vi.stubEnv('STAR_HINDSIGHT_API_KEY','fixture-key');
  fetcher.mockResolvedValue(json(stats));
  const out = await memoryStatus(); expect(JSON.stringify(out)).not.toContain('never-return');
  expect(fetcher.mock.calls[0][0]).toBe('https://memory.test/v1/default/banks/agent-star/stats');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer fixture-key' } });
});
test('uses the existing control-plane login; keeps its session server-side and coalesces concurrent login', async () => {
  controlPlane();
  fetcher.mockImplementation(async (url: string) => url.endsWith('/api/auth/login') ? json({ success: true },200,{ 'Set-Cookie':'hindsight_session=fixture-session; HttpOnly; Secure; SameSite=Lax' }) : json(stats));
  const results = await Promise.all([memoryStatus(), memoryStatus()]);
  expect(fetcher.mock.calls.filter(c => c[0].endsWith('/api/auth/login'))).toHaveLength(1);
  const read = fetcher.mock.calls.find(c => c[0].endsWith('/api/stats/agent-star'))!;
  expect(read[1].headers.Cookie).toBe('hindsight_session=fixture-session');
  expect(JSON.stringify(results)).not.toMatch(/fixture-session|fixture-\d/);
});
test('authentication failure is distinct from an empty bank and never includes the upstream error body', async () => {
  controlPlane(); fetcher.mockResolvedValue(json({ secret: 'upstream-credential' },401));
  await expect(memoryStatus()).rejects.toMatchObject({ code: 'authentication_required', message: 'authentication_required' });
});
test('read-only recall binds the bank on the server and requests original chunks and source facts', async () => {
  controlPlane(); fetcher.mockImplementation(async (url: string) => url.endsWith('/api/auth/login') ? json({ success: true },200,{ 'Set-Cookie':'hindsight_session=search-session; HttpOnly' }) : json({ results: [], chunks: {}, source_facts: {} }));
  await searchMemory({ query:'원문을 확인해줘' });
  const call = fetcher.mock.calls.find(c => c[0].endsWith('/api/recall'))!;
  expect(JSON.parse(call[1].body)).toMatchObject({ bank_id:'agent-star', include: { chunks: { max_tokens:10000 }, source_facts: { max_tokens:3000 } } });
  expect(fetcher.mock.calls.map(c => c[0]).join(' ')).not.toMatch(/retain|reflect|consolidate|delete/);
});
test('refuses a foreign bank response and a chunk that does not belong to the scoped fact', async () => {
  vi.stubEnv('STAR_HINDSIGHT_URL','https://memory.test');
  fetcher.mockResolvedValueOnce(json({ ...stats, bank_id:'person-hanul' }));
  await expect(memoryStatus()).rejects.toMatchObject({ code:'invalid_response' });
  fetcher.mockResolvedValueOnce(json({ id:'fact', document_id:'doc', chunk_id:'chunk' })).mockResolvedValueOnce(json({ bank_id:'agent-star', document_id:'other', chunk_text:'private text' }));
  await expect(readMemoryDetail('fact')).rejects.toMatchObject({ code:'invalid_response' });
});
test('closes oversized upstream streams and never treats them as an empty successful graph', async () => {
  vi.stubEnv('STAR_HINDSIGHT_URL','https://memory.test'); fetcher.mockResolvedValue(new Response('x'.repeat(4_000_001)));
  await expect(readMemoryGraph({ limit:120 })).rejects.toMatchObject({ code:'invalid_response' });
});
test('older control-plane source route is retried only on a 404 and remains bound to the fact document', async () => {
  controlPlane();
  fetcher.mockImplementation(async (url:string) => {
    if(url.endsWith('/api/auth/login')) return json({success:true},200,{'Set-Cookie':'hindsight_session=source-session; HttpOnly'});
    if(url.includes('/api/memories/fact?')) return json({id:'fact',document_id:'doc',chunk_id:'chunk'});
    if(url.includes('/api/chunks?')) return json({error:'not found'},404);
    if(url.endsWith('/api/chunks/chunk')) return json({bank_id:'agent-star',document_id:'doc',chunk_text:'아직 보내지 않았다.'});
    throw Error('unexpected route');
  });
  const result = await readMemoryDetail('fact'); expect(result.chunk?.text).toBe('아직 보내지 않았다.');
  expect(fetcher.mock.calls.filter(c=>String(c[0]).includes('/api/chunks'))).toHaveLength(2);
});
