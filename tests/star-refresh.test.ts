import { afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/star/refresh', () => ({ refreshStarSnapshot: mocks.refresh }));
import { POST } from '@/app/api/star/refresh/route';
afterEach(() => { vi.unstubAllEnvs(); mocks.refresh.mockReset(); });
test('an unconfigured install does not start any local client', async () => {
  vi.stubEnv('FOUNDEROS_PROFILE', '');
  expect((await POST()).status).toBe(503); expect(mocks.refresh).not.toHaveBeenCalled();
});
test('explicit manual refresh returns only a receipt, never task data or credentials', async () => {
  vi.stubEnv('FOUNDEROS_PROFILE', 'star'); vi.stubEnv('STAR_DASHBOARD_DIR', '/existing/dashboard');
  mocks.refresh.mockResolvedValue();
  expect(await (await POST()).json()).toEqual({ status: 'saved' });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
test('uncertain client failure preserves the old snapshot and hides error details', async () => {
  vi.stubEnv('FOUNDEROS_PROFILE', 'star'); vi.stubEnv('STAR_DASHBOARD_DIR', '/existing/dashboard');
  mocks.refresh.mockRejectedValue(new Error('credential=do-not-expose'));
  const response = await POST(); expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('do-not-expose');
});
