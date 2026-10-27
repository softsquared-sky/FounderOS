import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AC-09-7: lib/lab/setup/estimate.ts ships to the browser (09.2.8), so it and every module it
 * imports at runtime import nothing from node:*, lib/db, lib/lab/store, or a fetch. Type-only
 * imports are erased and allowed. The scan follows runtime imports transitively.
 */
const ROOT = process.cwd();
const FORBIDDEN = [/^node:/, /^(fs|path|os|crypto|child_process)$/, /^@\/lib\/db$/, /^@\/lib\/lab\/store$/, /^@\/lib\/lab\/net$/, /^@\/lib\/creds$/, /^better-sqlite3$/];

function runtimeImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (m[1]) continue; // import type
    const names = m[2];
    // `import { type A, type B } from` is erased entirely
    if (/^\{[^}]*\}$/.test(names.trim()) && names.replace(/[{}\s]/g, '').split(',').filter(Boolean).every((n) => n.startsWith('type'))) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/^\s*export\s+(?!type)[^;]*?from\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}

const resolve = (spec: string) => {
  if (!spec.startsWith('@/')) return null;
  const base = path.join(ROOT, spec.slice(2));
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c;
  return null;
};

describe('AC-09-7: estimate.ts is pure', () => {
  test('no runtime import of node, the db, the store or a fetch, transitively', () => {
    const seen = new Set<string>();
    const queue = [path.join(ROOT, 'lib/lab/setup/estimate.ts'), path.join(ROOT, 'lib/lab/setup/gates.ts')];
    const bad: string[] = [];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of runtimeImports(f)) {
        if (FORBIDDEN.some((re) => re.test(spec))) bad.push(`${path.relative(ROOT, f)} -> ${spec}`);
        const next = resolve(spec);
        if (next) queue.push(next);
      }
      const src = fs.readFileSync(f, 'utf8');
      if (/[^.\w]fetch\s*\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push(`${path.relative(ROOT, f)} calls fetch`);
    }
    expect(bad).toEqual([]);
    expect([...seen].map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))).toContain('lib/lab/setup/pricing-book.ts');
  });
});
