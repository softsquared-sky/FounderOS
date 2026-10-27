import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAxSources, type AxLoad } from './ax-model';

/** Fixed whitelisted documents only. No journal, communication or meeting-summary ingestion. */
export function loadAxSource(root: string | undefined): AxLoad {
  if (!root) return { status: 'missing', data: null };
  const files = ['architecture/catalog.json', 'maps/lineage.md', 'records/2026/10/ax-20261021-ten-stage-ax-model.md'];
  let raw: string[];
  try {
    if (!path.isAbsolute(root)) return { status: 'invalid', data: null };
    raw = files.map(file => {
      const target = path.join(root, file);
      if (fs.statSync(target).size > 2_000_000) throw new Error('oversized');
      return fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
    });
  } catch { return { status: 'missing', data: null }; }
  try {
    const sources = files.map((file, i) => ({ path: file, sha256: createHash('sha256').update(raw[i]).digest('hex') }));
    return { status: 'ready', data: parseAxSources(JSON.parse(raw[0]), raw[1], raw[2], sources) };
  } catch { return { status: 'invalid', data: null }; }
}
