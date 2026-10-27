import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// SPEC S06 FR-c (T6, T7) and §5 C1/C2: page grounds are painted by html/body
// or a fixed full-viewport .page-ground layer, never by a box sized to the
// content; the Creative Engine paper follows the app mode on html[data-mode]
// (glados-ui SPEC S00 FR-9 to FR-11, C10).

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const css = read('app/globals.css');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
/** The dark paper base rule (glados-ui S00 FR-9): keyed on html[data-mode]. */
const DARK_PAPER = ":where(:root[data-mode='dark']) .ae-paper, :where(:root:not([data-mode]):not([data-theme='light'])) .ae-paper";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name).replace(/\\/g, '/');
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/** Declarations of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(cssNoComments);
  return m ? m[1] : '';
}

describe('T6 page grounds: no content-sized ground boxes', () => {
  const sources = [...walk('app').filter((f) => f.endsWith('page.tsx')), ...walk('components')];

  test('no element paints a ground with negative vertical insets sized to the content', () => {
    const offenders: string[] = [];
    for (const f of sources) {
      read(f).split('\n').forEach((line, i) => {
        if (line.includes('absolute -inset-x-8 -inset-y-6')) offenders.push(`${f}:${i + 1}`);
        if (/-inset-y-\d/.test(line) && /(background|bg-|ae-ground|ap-ground)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('.page-ground is a fixed, full-viewport layer behind content', () => {
    const body = ruleBody('.page-ground');
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/z-index:\s*-1/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  test('.ae-ground is only ever used together with .page-ground', () => {
    const uses = sources.flatMap((f) => (read(f).match(/className="[^"]*\bae-ground\b[^"]*"/g) ?? []).map((m) => `${f}: ${m}`));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/\bpage-ground\b/);
  });

  test('AdPilot: solid ground is a .page-ground, dot grid cancels main padding exactly (FR-c4)', () => {
    const src = read('app/adpilot/page.tsx');
    expect(src).toMatch(/className="ap-ground page-ground"/);
    const dots = /className="ap-dots ([^"]*)"/.exec(src)?.[1] ?? '';
    for (const cls of ['absolute', 'inset-0', '-mx-8', '-mt-7', '-mb-16', 'wide:-mx-10', 'ultra:-mx-12']) expect(dots.split(' ')).toContain(cls);
    // ...and those numbers are main's padding in the layout.
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/<main className="[^"]*\bpx-8 pb-16 pt-7 wide:px-10 ultra:px-12\b/);
    expect(ruleBody('.ap-ground')).toMatch(/background:\s*var\(--ap-ground\)/);
  });

  test('html paints the theme ground; body isolates so a z-index:-1 layer sits above its background', () => {
    expect(ruleBody('html')).toMatch(/background:\s*var\(--bg\)/);
    expect(cssNoComments).toMatch(/(^|\})\s*body\s*\{[^}]*isolation:\s*isolate/m);
  });

  test('no page root hard-codes a background colour', () => {
    const pages = walk('app').filter((f) => f.endsWith('page.tsx') && !f.startsWith(join('app', 'design')));
    const offenders = pages.filter((f) => /style=\{\{\s*background:\s*'#|bg-\[#/.test(read(f)));
    expect(offenders.map((f) => relative(root, join(root, f)))).toEqual([]);
  });
});

describe('T7 nothing traps the fixed ground', () => {
  const layout = read('app/layout.tsx');
  const banned = /\b(transform|filter|backdrop-filter|contain|will-change|transform-gpu|blur|isolate)\b/;

  test('main, .os-shell and the max-w container carry no transform/filter/contain/will-change utilities', () => {
    const shell = /className="(os-shell[^"]*)"/.exec(layout)?.[1];
    const main = /<main className="([^"]*)"/.exec(layout)?.[1];
    const container = /className="(mx-auto max-w-[^"]*)"/.exec(layout)?.[1];
    for (const cls of [shell, main, container]) {
      expect(cls).toBeTruthy();
      for (const c of (cls as string).split(/\s+/)) expect(c, c).not.toMatch(banned);
    }
  });

  test('no CSS rule gives .os-shell, main or the paper wrappers a containing block for fixed children', () => {
    const rule = /([^{}]+)\{([^}]*)\}/g;
    const offenders: string[] = [];
    for (const m of cssNoComments.matchAll(rule)) {
      const sel = m[1].trim();
      if (!/(\.os-shell|\bmain\b|\.ae-paper|\[data-creative-engine\]|\[data-adpilot\])/.test(sel)) continue;
      if (/\.ae-octane|\.ae-sheet|\.ae-o-/.test(sel)) continue; // overlays and sheets are their own fixed layers
      if (/(^|;|\s)(transform|filter|contain|will-change|perspective)\s*:/.test(m[2])) offenders.push(sel);
    }
    expect(offenders).toEqual([]);
  });
});

describe('S06 FR-a: Creative Engine ground follows the OS ground', () => {
  test('--os-bg is declared on :root only (custom-property cycle guard, edge 3)', () => {
    const decls = [...cssNoComments.matchAll(/([^{}]+)\{[^}]*--os-bg\s*:/g)].map((m) => m[1].trim());
    expect(decls).toEqual([':root']);
    expect(ruleBody(':root')).toBeDefined();
    expect(cssNoComments).toMatch(/:root\s*\{\s*--os-bg:\s*var\(--bg\);\s*\}/);
  });

  test('dark paper ground is the OS ground, or --ae-dark-ground where one is defined', () => {
    const start = cssNoComments.indexOf(`${DARK_PAPER} {`);
    expect(start).toBeGreaterThan(-1);
    const block = cssNoComments.slice(start, cssNoComments.indexOf('}', start));
    expect(block).toMatch(/--p-bg:\s*var\(--ae-dark-ground,\s*var\(--os-bg\)\)/);
    expect(block).not.toMatch(/#0e0e10/);
  });

  test('only White (and its Daylight copy, L0.2) defines --ae-dark-ground (#0b0b0d)', () => {
    const decls = [...cssNoComments.matchAll(/([^{}]+)\{([^}]*--ae-dark-ground\s*:[^}]*)\}/g)];
    expect(decls.map((m) => m[1].trim())).toEqual([":root[data-theme='light']", ":root[data-theme='daylight']"]);
    expect(decls[1][2]).toMatch(/--ae-dark-ground:\s*#0b0b0d/);
    expect(decls[0][2]).toMatch(/--ae-dark-ground:\s*#0b0b0d/);
  });
});

describe('S00 FR-9 to FR-11 (C10): the paper follows the app mode, no engine switch', () => {
  const DARK = ":where(:root[data-mode='dark'], :root:not([data-mode]):not([data-theme='light']))";

  test('AC00.7: no engine mode control, no paper-mode module, no per-page mode attribute', () => {
    const page = read('app/creative-engine/page.tsx');
    expect(page).toMatch(/<div className="ae-paper relative" data-creative-engine>/);
    // ?mode= and the ae-mode cleanup live in the global pre-paint script (tests/appearance.test.ts
    // covers both); the engine-only bridge is gone and the page renders no script of its own.
    expect(existsSync(join(root, 'lib/creative-engine/mode-bridge.ts'))).toBe(false);
    expect(page).not.toMatch(/ENGINE_MODE_BRIDGE_SCRIPT|dangerouslySetInnerHTML/);
    expect(read('app/layout.tsx')).toMatch(/__html: APPEARANCE_INIT_SCRIPT/);
    expect(page).not.toMatch(/data-mode=/);
    expect(existsSync(join(root, 'lib/creative-engine/paper-mode.ts'))).toBe(false);
    const sources = [...walk('app'), ...walk('components'), ...walk('lib')];
    const offenders = sources.filter((f) => /paper-mode|PAPER_MODE|\bae-mode\b|data-paper-mode|SunMoon/.test(read(f)) && !f.endsWith('lib/appearance.ts'));
    expect(offenders).toEqual([]);
    expect(css).not.toMatch(/\.ae-mode\b/);
    expect(cssNoComments).not.toMatch(/\[data-mode='auto'\]/);
  });

  test('dark paper is keyed on :root[data-mode], dark when <html> has no mode yet except under White', () => {
    expect(cssNoComments).toContain(`${DARK_PAPER} {`);
    // Every child rule of the dark paper scope uses the same html-level key.
    const childRules = [...cssNoComments.matchAll(/^(:where\(:root\[data-mode='dark'\][^{\n]*?) \.ae-paper (\S[^{\n]*?) \{/gm)];
    expect(childRules.length).toBeGreaterThanOrEqual(12);
    for (const m of childRules) expect(m[1], m[2]).toBe(DARK);
    // Grey Frost lifts the dark cards under the same key.
    expect(cssNoComments).toContain(":root[data-theme='grey-frost'][data-mode='dark'] .ae-paper, :root[data-theme='grey-frost']:not([data-mode]) .ae-paper {");
    // Nothing keys the paper on a per-element data-mode any more.
    expect(cssNoComments).not.toMatch(/\.ae-paper\[data-mode|(^|[\s,])\[data-mode='dark'\] \.ae-/m);
  });

  test('the dark base stays at one class so the Red/Frost re-keys keep winning', () => {
    expect(cssNoComments).not.toMatch(/(^|[\s,]):root\[data-mode='dark'\]\s+\.ae-paper\s*[,{]/m);
    expect(DARK_PAPER.startsWith(':where(')).toBe(true);
  });
});

describe('T6 (4) viz stages are tokens, not literal near-blacks (S06 FR-b7)', () => {
  const FILES = [
    'archive/design-prototypes/components/GBrainCore3D.tsx',
    'archive/design-prototypes/components/GBrainObservatory.tsx',
    'archive/design-prototypes/components/GBrainCore3DLazy.tsx',
    'archive/design-prototypes/components/GBrainObservatoryLazy.tsx',
    'components/GBrainRadialLazy.tsx',
    'components/GBrainRadial.tsx',
    'components/KnowledgeGraph.tsx',
  ];

  test.each(FILES)('%s paints its stage and HUD from --viz-* tokens', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/#06060a|#04090a|rgba\(4,\s*11,\s*8|rgba\(8,\s*9,\s*20|rgba\(14,\s*14,\s*22|rgba\(12,\s*12,\s*18,\s*0\.85|rgba\(16,\s*16,\s*24/);
    expect(src).toMatch(/var\(--(viz-stage|viz-stage-2|viz-hud|viz-hud-2|viz-hud-3|gbr-pill-bg|kg-panel-bg)\)/);
  });
});
