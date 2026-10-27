import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '@/components/creative-engine/Dashboard';
import type { HealthSnapshot } from '@/components/creative-engine/api';
import { sampleCampaign, sampleCatalog, sampleHealth, sampleRuns } from '@/lib/creative-engine/demo';
import { G_READY, G_TREE_FILES } from '@/lib/appearance';
import { loadClassicControls } from '../scripts/g-audit/_lib.mjs';

/**
 * The Creative Engine on the kit (docs/projects/glados-ui/SPEC.md GP1, lane 2c).
 * Static renders of the dashboard in both skins, plus the paper token aliases.
 * The runtime half (computed tokens per accent × mode, every sheet and menu
 * opened under the guard) is `node scripts/g-audit.mjs --controls` with the
 * scripts/g-audit/creative-engine.mjs route plugin.
 */

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const CFG = loadClassicControls(root);

const realError = console.error;
const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
  if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a);
});
afterAll(() => spy.mockRestore());

const sample = { campaign: sampleCampaign(), runs: sampleRuns(), catalog: sampleCatalog() };
function render(g: boolean, health: HealthSnapshot = sampleHealth(), withSample = true) {
  return renderToStaticMarkup(
    h(Dashboard, { g, campaigns: [], health, saved: [], watchlist: [], signals: [], sample: withSample ? sample : null, products: [], renderedAt: Date.parse('2026-10-09T12:00:00Z') }),
  );
}
const dataG = (markup: string) => new Set([...markup.matchAll(/data-g="([A-Za-z]+)"/g)].map((m) => m[1]));
const classes = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));

describe('FR-GP1.1 / ACGP1.1: under GladOS the paper tokens alias the kit', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('/* ── 2c Creative Engine on the kit'), css.indexOf('/* ── end 2c Creative Engine on the kit ── */'));
  const decl = block.slice(0, block.indexOf('}'));

  it('is scoped to :root[data-ui=glados], so Classic is untouched', () => {
    expect(decl).toMatch(/^[\s\S]*:root\[data-ui='glados'\]\[data-accent\] \.ae-paper, :root\[data-ui='glados'\]:not\(\[data-accent\]\) \.ae-paper \{/);
    // the Classic paper still declares its own light values (AC00.8 baseline)
    expect(css).toMatch(/\.ae-paper \{\n {2}--p-bg: #e8e8eb;\n {2}--p-card: #f6f6f8;/);
  });

  it.each([
    ['--p-bg', '--g-bg'], ['--p-card', '--g-card'], ['--p-card-2', '--g-card-2'], ['--p-ink', '--g-ink'], ['--p-muted', '--g-muted'],
    ['--p-dim', '--g-dim'], ['--p-line', '--g-line'], ['--p-ring', '--g-ring'], ['--p-shadow', '--g-shadow'], ['--p-shadow-sm', '--g-shadow-sm'],
    ['--p-lime', '--g-badge'], ['--p-green', '--g-ok'], ['--p-red', '--g-err'], ['--p-orange', '--g-warn'], ['--p-on-hero', '--g-on-hero'],
  ])('%s is var(%s)', (p, g) => {
    expect(decl).toContain(`${p}: var(${g});`);
  });

  it('declares no literal colour (every value is a --g-* token)', () => {
    expect(block).not.toMatch(/--p-[\w-]+:\s*(#|rgb|hsl)/);
  });
});

describe('ACGP1.2 / FR-GP1.2: the GladOS tree renders the kit, not the engine\'s own primitives', () => {
  const g = render(true);
  const kit = dataG(g);

  it('heroes, stats, numerals, rulers, the dot cloud and the run strip come from the kit', () => {
    for (const name of ['GHeroCard', 'GStat', 'GDotNumber', 'GRuler', 'GDotCloud', 'GTimelineStrip', 'GSegmented', 'GPill', 'GTabs', 'GRings', 'GCardRaised', 'GBadge']) expect(kit, name).toContain(name);
    expect(g.match(/data-g="GHeroCard"/g)?.length).toBe(2); // at most two per view (C22)
  });

  it('renders no DotNumeral and none of the paper hero, stat or ruler markup', () => {
    const cls = classes(g);
    for (const c of ['ae-hero', 'ae-stat', 'ae-ruler', 'ae-dotcloud', 'ae-rings', 'ae-tl', 'ae-timeline']) expect(cls, c).not.toContain(c);
    // DotNumeral draws a CSS grid of 5 columns per glyph; GDotNumber draws an SVG
    expect(g).not.toMatch(/grid-template-columns:repeat\(5,/);
  });

  it('imports the kit in the shared surfaces', () => {
    const dash = read('components/creative-engine/Dashboard.tsx');
    expect(dash).toMatch(/import \{[^}]*GHeroCard[^}]*\} from '@\/components\/g'/);
    expect(read('components/creative-engine/skin-dash.tsx')).toMatch(/import \{[^}]*GDotNumber[^}]*GStat[^}]*\} from '@\/components\/g'/);
    expect(dash).not.toMatch(/\bDotNumeral\b/);
  });

  it('carries no Classic control class anywhere in its markup (GP4)', () => {
    const cls = new Set(classes(g));
    expect([...CFG.classes, ...CFG.onControlOnly].filter((c) => cls.has(c))).toEqual([]);
  });
});

describe('ACGP1.3 / FR-GP1.4: the console card\'s rings are a readout', () => {
  it('names runs in flight and the Arcads state; connected lights the centre ok', () => {
    const g = render(true);
    const rings = /<div data-g="GRings" role="img" aria-label="([^"]+)"[^>]*data-status="(\w+)"/.exec(g);
    expect(rings?.[1]).toMatch(/^\d+ runs? in flight · Arcads connected \(ok\)$/);
    expect(rings?.[2]).toBe('ok');
  });

  it('with Arcads unconfigured the centre dot is off (--g-dim) and the card offers Set up', () => {
    const base = sampleHealth();
    const health: HealthSnapshot = { ...base, arcads: { ...base.arcads, configured: false, health: {} } };
    const g = render(true, health, false);
    const card = g.slice(g.indexOf('ce-g-console-card'), g.indexOf('ce-g-console-card') + 3000);
    expect(card).toMatch(/data-g="GRings" role="img" aria-label="0 runs in flight · Arcads not configured \(off\)"/);
    expect(card).toMatch(/data-status="off"/);
    expect(card).toMatch(/href="\/integrations#arcads"[^>]*data-g="GButton"[^>]*>|data-g="GButton"[^>]*href="\/integrations#arcads"/);
    // off paints with --g-dim (the kit's GRings recipe)
    expect(read('app/globals.css')).toMatch(/\.g-rings > i \{[^}]*background: var\(--g-dim\)/);
  });

  it('key set but no check passed yet reads as warn', () => {
    const base = sampleHealth();
    const health: HealthSnapshot = { ...base, arcads: { ...base.arcads, health: {} } };
    expect(render(true, health, false)).toMatch(/data-g="GRings"[^>]*aria-label="0 runs in flight · Arcads key set, not verified yet \(needs attention\)"[^>]*data-status="warn"/);
  });
});

describe('ACGP1.5: the Classic skin is the paper engine, unchanged', () => {
  const c = render(false);

  it('renders the paper markup and no kit primitive', () => {
    const cls = classes(c);
    for (const name of ['ae-hero', 'ae-hero-green', 'ae-hero-warm', 'ae-hero-pink', 'ae-stat', 'ae-pill', 'ae-tl-range', 'ae-rings']) expect(cls, name).toContain(name);
    expect(dataG(c).size).toBe(0);
  });
});

describe('FR-GP1.7: /creative-engine is in G_READY with its GladOS-tree files', () => {
  it('registers the route and every shared surface; the Classic-only files are not in the tree', () => {
    expect(G_READY).toContain('/creative-engine');
    const files = G_TREE_FILES['/creative-engine'];
    for (const f of ['components/creative-engine/Dashboard.tsx', 'components/creative-engine/MotionConsole.tsx', 'components/creative-engine/WorkflowCanvas.tsx', 'app/creative-engine/page.tsx']) expect(files).toContain(f);
    for (const f of ['components/creative-engine/classic.tsx', 'components/creative-engine/timeline-classic.tsx', 'components/creative-engine/primitives.tsx']) expect(files).not.toContain(f);
  });

  it('the page picks the tree once on the server from the appearance and the registry', () => {
    expect(read('app/creative-engine/page.tsx')).toContain("const g = treeFor(getAppearance(), '/creative-engine') === 'glados';");
  });
});
