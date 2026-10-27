import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * S03 FR-11 / FR-14 guard (docs/projects/ui-polish/SPEC.md §5 C4): input
 * placeholders never carry an example ad concept. A concept typed into a
 * placeholder reads as something the product decided for the operator
 * ("the ad engine says founders replacing staff with AI for some reason").
 */
const ROOT = join(process.cwd(), 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

const files = walk(ROOT).map((p) => ({ path: relative(process.cwd(), p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

// Concepts that have leaked into placeholders before, or that the spec names as
// example concepts. Matched case-insensitively after "for example" / "e.g.".
const CONCEPT_DENYLIST = ['replacing staff', 'ai agents', 'founders', '30-day results', 'results promise', 'lamp'];

describe('placeholder copy carries no example concept', () => {
  test('no component file contains "replacing staff"', () => {
    const hits = files.filter((f) => /replacing staff/i.test(f.src)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  test('no placeholder offers a denylisted concept as an example', () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const m of f.src.matchAll(/placeholder\s*[=:]\s*(?:\{\s*)?(["'`])([^"'`]*)\1/g)) {
        const text = m[2].toLowerCase();
        const ex = text.match(/(?:for example|e\.g\.)(.*)$/);
        if (ex && CONCEPT_DENYLIST.some((c) => ex[1].includes(c))) hits.push(`${f.path}: ${m[2]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('generator and library search use the S03 copy', () => {
    const gen = files.find((f) => f.path.endsWith('creative-engine/CreativeGenerator.tsx'))!.src;
    expect(gen).toContain('placeholder="Describe the idea you want ads for"');
    expect(gen).toContain('One sentence about the outcome your customer wants. The engine turns it into searches.');
    const lib = files.find((f) => f.path.endsWith('adpilot/AdLibrary.tsx'))!.src;
    expect(lib).toContain('placeholder="Describe a concept to search proven ads"');
    expect(lib).toContain('Describe a concept. Probes expand it and the library answers with proven ads.');
    expect(lib).not.toContain('#f04e52');
  });
});
