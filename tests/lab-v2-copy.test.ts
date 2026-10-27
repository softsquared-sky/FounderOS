/**
 * AC-01-30 copy rules over every page and sheet view (fixture world, every state) and LAB_COPY;
 * AC-09-28 every 09.8 string (read from the spec table itself) is in LAB_COPY, with no dash or emoji.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAB_COPY, COPY_09_8 } from '@/lib/lab/view/copy';
import { LAB_PAGES } from '@/lib/lab/view/shared';
import { FIXTURE_IDS, FLAGS, blankStore, fixtureStore, page, sheet, walk } from './helpers/lab-v2-v';

const BAD = (s: string) => /[–—]/.test(s) || /\p{Extended_Pictographic}/u.test(s) || /not enough data/.test(s) /* D7: only the Brief keeps "Not enough data yet." */ || /virality/i.test(s);

function strings(v: unknown): { s: string; path: string }[] {
  const out: { s: string; path: string }[] = [];
  walk(v, () => undefined, (s, p) => out.push({ s, path: p }));
  return out;
}

// The spec docs are private to the operator's repo and not part of the public release.
const SPEC_09 = path.join(process.cwd(), 'docs/projects/content-lab/v2/spec/09-cost-confidence-progress-schedule.md');
describe.skipIf(!existsSync(SPEC_09))('AC-09-28 the 09.8 strings', () => {
  const spec = existsSync(SPEC_09) ? readFileSync(SPEC_09, 'utf8') : '';
  const block = spec.slice(spec.indexOf('## 09.8'), spec.indexOf('## 09.9'));
  const rows = block.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Where') && !l.startsWith('|---')).map((l) => l.split(' | ')[1].replace(/ \|$/, '').trim());
  const hosted = new Set([...Object.values(LAB_COPY.plan), ...Object.values(LAB_COPY.progress), ...Object.values(LAB_COPY.schedule)]);
  it('the spec table has its 52 rows', () => expect(rows.length).toBe(52));
  it('each row is in LAB_COPY.plan, .progress or .schedule, verbatim', () => {
    for (const r of rows) expect(hosted.has(r), r).toBe(true);
    expect([...COPY_09_8]).toEqual(rows);
  });
  it('no em dash, en dash or emoji in any of them', () => {
    for (const r of rows) expect(BAD(r), r).toBe(false);
  });
});

describe('AC-01-30 copy rules', () => {
  it('LAB_COPY holds no dash, emoji, "not enough data" or "virality"', () => {
    for (const { s, path: p } of strings(LAB_COPY)) expect(BAD(s), `${p}: ${s}`).toBe(false);
  });
  it('every page view in the sample, Filming, empty and not-configured worlds', async () => {
    const worlds = [
      [fixtureStore(), FLAGS.sample],
      [fixtureStore(), FLAGS.filming],
      [blankStore(), FLAGS.real],
      [blankStore(), FLAGS.notConfigured],
    ] as const;
    for (const [store, flags] of worlds) {
      for (const p of LAB_PAGES) {
        const v = await page(p.id, store, flags);
        for (const { s, path: at } of strings(v)) expect(BAD(s), `${p.id} ${at}: ${s.slice(0, 120)}`).toBe(false);
      }
    }
  }, 60_000);
  it('every sheet view on the fixture world', async () => {
    const s = fixtureStore();
    const ids: [Parameters<typeof sheet>[0], string][] = [['post', FIXTURE_IDS.firstPost], ['event', FIXTURE_IDS.event], ['idea', FIXTURE_IDS.idea], ['script', FIXTURE_IDS.script], ['test', FIXTURE_IDS.test], ['test', 'new'], ['setup', 'checklist'], ['setup', 'keys'], ['setup', 'sources'], ['setup', 'schedule'], ['setup', 'spend'], ['ask', 'tiktok breakouts this month']];
    for (const [k, id] of ids) {
      const v = await sheet(k, id, s, FLAGS.sample);
      // user-generated text (post captions, comments, transcripts) is data, not Lab copy: skip those paths
      for (const { s: str, path: at } of strings(v)) {
        if (/\.(caption|text|hookText|transcript|segments|title|hook|spoken|onScreen|body|label|handle|displayName|url|q)\b/.test(at) && !/\.(state|message)/.test(at)) continue;
        expect(BAD(str), `${k} ${at}: ${str.slice(0, 120)}`).toBe(false);
      }
    }
  }, 60_000);
  it('components/lab/v2/**/*.tsx carry no JSX text literals (strings come from the view or LAB_COPY)', () => {
    // Lane F/U1's shared components still hold four literals; listed so any new one fails. Owner: F/U1.
    const KNOWN = new Set(['shared/Progress.tsx:Run log', 'shared/Sheet.tsx:Retry', 'shared/HeroMetric.tsx:Nothing yet', 'shared/HeroMetric.tsx:Not configured']);
    const root = path.join(process.cwd(), 'components/lab/v2');
    const scan = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scan(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of scan(root).filter((x) => x.endsWith('.tsx'))) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      for (const m of readFileSync(f, 'utf8').matchAll(/>([A-Za-z][^<{]{2,})</g)) {
        expect(KNOWN.has(`${rel}:${m[1].trim()}`), `${rel}: "${m[1]}"`).toBe(true);
      }
    }
  });
});
