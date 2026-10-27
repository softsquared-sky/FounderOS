import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ status:vi.fn(), search:vi.fn() }));
vi.mock('@/lib/star/memory-server', async importOriginal => ({ ...(await importOriginal<any>()), memoryStatus:mocks.status, searchMemory:mocks.search }));
import { getBrainProvider } from '@/lib/brain';
import { invalidateModeCache } from '@/lib/paths';
import { POST as dump } from '@/app/api/brain/dump/route';
beforeEach(() => { vi.stubEnv('BRAIN_PROVIDER','hindsight-star'); vi.stubEnv('GLADOS_DEFAULT_MODE','real'); vi.stubEnv('DEMO_MODE','0'); invalidateModeCache(); mocks.status.mockReset(); mocks.search.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); invalidateModeCache(); });
test('native Optimal Engine selects the explicit Hindsight provider', async () => {
  mocks.status.mockResolvedValue({nodes:7}); const provider=getBrainProvider(); expect(provider.name).toBe('hindsight-star'); expect(await provider.status()).toMatchObject({connected:true,provider:'hindsight-star'});
});
test('the compact native search omits unbacked facts rather than losing their uncertainty label', async () => {
  mocks.search.mockResolvedValue({results:[{id:'a',text:'아직 발송하지 않았다.',documentId:'doc',context:'결정',evidenceComplete:true},{id:'b',text:'근거 없음',evidenceComplete:false}]});
  const results=await getBrainProvider().search('무엇을 했나'); expect(results).toHaveLength(1); expect(results[0].snippet).toBe('아직 발송하지 않았다.'); expect(results[0].source).toContain('agent-star');
});
test('Hindsight selection cannot ingest a BrainDump', async () => {
  expect((await dump(new Request('http://localhost/api/brain/dump',{method:'POST',body:'{}'}))).status).toBe(405); expect(mocks.search).not.toHaveBeenCalled();
});
test('Filming keeps the upstream demo provider even when the real provider is configured', () => {
  vi.stubEnv('DEMO_MODE','1'); invalidateModeCache(); expect(getBrainProvider().name).not.toBe('hindsight-star'); expect(mocks.status).not.toHaveBeenCalled();
});
