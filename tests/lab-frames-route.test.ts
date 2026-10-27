/**
 * The frames gate route is standalone (02 section 16, AC-02-43): every FRAME_STATES value renders, an unknown
 * state 404s, and nothing in the route's import graph reaches the store, the DB, fixtures or app/lab/.
 * Also checks the 23-file list of 16.3 (AC-02-42 is the `lab-frames.mjs --check` exit code).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { FRAME_SHEET_MID_MS, FRAME_STATES, frameToday } from '@/lib/lab/view/frames';
import { LAB_DUR } from '@/lib/lab/motion';

const ROOT = process.cwd();
const PAGE = join(ROOT, 'app/lab-frames/[state]/page.tsx');
const ROUTER = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as unknown as React.ContextType<typeof AppRouterContext>;

const realError = console.error;
const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a); });
afterAll(() => spy.mockRestore());

function renderPage(el: ReactElement, search = ''): string {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: ROUTER },
      h(PathnameContext.Provider, { value: '/lab-frames/x' },
        h(SearchParamsContext.Provider, { value: new URLSearchParams(search) as never }, el))),
  );
}

describe('AC-02-43 /lab-frames/<state>', () => {
  it.each([...FRAME_STATES])('%s renders with no DB file present', async (state) => {
    const prev = process.env.GLADOS_DB;
    process.env.GLADOS_DB = join(ROOT, 'does-not-exist', 'never.db');
    try {
      const { default: Page } = await import('@/app/lab-frames/[state]/page');
      const out = renderPage(Page({ params: { state } }) as ReactElement);
      expect(out).toContain(`data-lab-frame="${state}"`);
      expect(out.match(/class="lab2-aurora"/g)?.length).toBe(1);
      if (state !== 'not-configured') expect(out).toContain('Sample data');
      expect(existsSync(process.env.GLADOS_DB)).toBe(false);
    } finally {
      process.env.GLADOS_DB = prev;
    }
  }, 20_000);

  it('an unknown state calls notFound()', async () => {
    const { default: Page, generateStaticParams } = await import('@/app/lab-frames/[state]/page');
    expect(() => Page({ params: { state: 'nope' } })).toThrow();
    expect(generateStaticParams().map((p) => p.state)).toEqual([...FRAME_STATES]);
  });

  it('the import graph stays clear of the store, the DB, fixtures and app/lab', () => {
    const seen = new Set<string>();
    const resolveImport = (from: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
      else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
      else return null;
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext) && !base.endsWith('/') && (ext || /\.(t|j)sx?$/.test(base))) return base + ext;
      return null;
    };
    const visit = (f: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        // type-only imports are erased at build time and pull nothing into the route (U1: Sheet takes 01's SheetKind)
        if (/^(?:import|export)\s+type\s/.test(m[0])) continue;
        const r = resolveImport(f, m[1] ?? m[2]);
        if (r) visit(r);
      }
    };
    visit(PAGE);
    const rel = [...seen].map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));
    expect(rel).toContain('lib/lab/view/frames.ts');
    for (const f of rel) {
      expect(f, f).not.toMatch(/^(lib\/lab\/store|lib\/db|lib\/data|lib\/lab\/fixtures|app\/lab\/)/);
      // frames.ts, plus 01's pure formatter: 03.1 has lib/lab/motion.ts (COUNT_FORMAT) format numbers through it
      if (f.startsWith('lib/lab/view/')) expect(['lib/lab/view/frames.ts', 'lib/lab/view/format.ts']).toContain(f);
    }
  });

  it('opens the post sheet on ?post= and uses the frame fixtures', async () => {
    const { FrameTodayView } = await import('@/app/lab-frames/[state]/FrameToday');
    const out = renderPage(h(FrameTodayView, { state: 'default', data: frameToday('default') }), 'post=frame-1');
    expect(out).toContain('role="dialog"');
    expect(FRAME_SHEET_MID_MS).toBe(LAB_DUR.m / 2);
  });
});

describe('AC-02-42 the 16.3 frame list', () => {
  it('lab-frames.mjs captures exactly the 23 files', async () => {
    const src = readFileSync(join(ROOT, 'scripts/lab-frames.mjs'), 'utf8');
    expect(src).not.toMatch(/\b130\b/); // the mid pause is read from LAB_DUR.m, never hard-coded
    const { FRAMES } = await import('../scripts/lab-frames.mjs');
    expect(FRAMES.length).toBe(23);
    expect(new Set(FRAMES.map((f: { file: string }) => f.file)).size).toBe(23);
  });
});
