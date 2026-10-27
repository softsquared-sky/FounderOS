import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ status:vi.fn(), graph:vi.fn(), detail:vi.fn(), search:vi.fn(), filming:vi.fn(()=>false) }));
vi.mock('@/lib/paths', () => ({ filmingMode:mocks.filming }));
vi.mock('@/lib/star/memory-server', async importOriginal => ({ ...(await importOriginal<any>()), memoryStatus:mocks.status, readMemoryGraph:mocks.graph, readMemoryDetail:mocks.detail, searchMemory:mocks.search }));
import { GET, POST } from '@/app/api/star/memory/route';
beforeEach(() => { vi.stubEnv('FOUNDEROS_PROFILE','star'); Object.values(mocks).forEach(m=>m.mockReset()); mocks.filming.mockReturnValue(false); });
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown) => new NextRequest('http://localhost/api/star/memory',{ method:'POST', body:JSON.stringify(body) });
test('rejects browser-selected banks and destinations before using any client', async () => {
  expect((await POST(request({ query:'메모리', bank_id:'person-hanul' }))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/star/memory?mode=graph&url=https://other.test'))).status).toBe(400);
  [mocks.status,mocks.graph,mocks.detail,mocks.search].forEach(m=>expect(m).not.toHaveBeenCalled());
});
test('bounds an incoming stream even without a content-length header', async () => {
  expect((await POST(request({ query:'x'.repeat(5000) }))).status).toBe(400); expect(mocks.search).not.toHaveBeenCalled();
});
test('only the explicitly selected read runs and results cannot be cached by the browser', async () => {
  mocks.graph.mockResolvedValue({ nodes:[],edges:[],bank:'agent-star' });
  const r=await GET(new NextRequest('http://localhost/api/star/memory?mode=graph&limit=30&q=FounderOS'));
  expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
  expect(mocks.graph).toHaveBeenCalledWith(expect.objectContaining({ limit:30,q:'FounderOS' })); expect(mocks.status).not.toHaveBeenCalled();
});
test('a disabled profile does not create a connection', async () => {
  vi.stubEnv('FOUNDEROS_PROFILE',''); expect((await GET(new NextRequest('http://localhost/api/star/memory'))).status).toBe(503); expect(mocks.status).not.toHaveBeenCalled();
});
test('Filming/demo cannot query the real Star bank', async () => {
  mocks.filming.mockReturnValue(true); expect((await GET(new NextRequest('http://localhost/api/star/memory'))).status).toBe(503); expect(mocks.status).not.toHaveBeenCalled();
});
