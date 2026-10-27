import { execFile } from 'node:child_process';
import path from 'node:path';
let pending: Promise<void> | null = null;

/** One explicit click, one existing read-only client. No shell, polling, body parameters or credentials returned. */
export function refreshStarSnapshot(): Promise<void> {
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(process.cwd(), 'scripts', 'star-sync.ts')],
      { cwd: process.cwd(), env: process.env, timeout: 65_000, maxBuffer: 4096, windowsHide: true },
      error => error ? reject(new Error('snapshot refresh failed')) : resolve());
  }).finally(() => { pending = null; });
  return pending;
}
