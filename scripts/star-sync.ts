/** Manual read-only snapshot. Uses the existing local Star client without copying its credentials. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeStarState } from '../lib/star/model';
import { loadEnvFile } from 'node:process';
import { loadAxSource } from '../lib/star/ax-source';

try { loadEnvFile('.env.local'); } catch { /* An explicitly configured process needs no file. */ }

async function main() {
  const root = process.env.STAR_DASHBOARD_DIR;
  if (!root || !path.isAbsolute(root)) throw new Error('Set STAR_DASHBOARD_DIR to the existing absolute Star dashboard directory.');
  const clientUrl = pathToFileURL(path.join(root, 'routine-client.mjs')).href;
  const boardUrl = pathToFileURL(path.join(root, 'board-core.mjs')).href;
  const { routineRequest } = await import(/* webpackIgnore: true */ clientUrl);
  const { boardState } = await import(/* webpackIgnore: true */ boardUrl);
  const state = await routineRequest('state', undefined, { timeoutMs: 60000 });
  const boards = Object.fromEntries((state.jobs ?? []).map((job: any) => [job.id, boardState(job, state)]));
  const snapshot = normalizeStarState(state, boards, process.env.STAR_DASHBOARD_URL || 'http://127.0.0.1:8765');
  snapshot.ax = loadAxSource(process.env.STAR_AX_DIR);
  const target = process.env.STAR_SNAPSHOT_FILE || path.join(process.cwd(), '.local', 'star-snapshot.json');
  if (!path.isAbsolute(target)) throw new Error('STAR_SNAPSHOT_FILE must be absolute when provided.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.tmp', JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  fs.renameSync(target + '.tmp', target);
  console.log(JSON.stringify({ status: 'saved', capturedAt: snapshot.capturedAt, tasks: snapshot.tasks.length, roles: snapshot.roles.length, projection: snapshot.projection.status, ax: snapshot.ax.status }));
}
main().catch(() => { console.error('Star snapshot could not be refreshed. Previous snapshot preserved. Check the existing dashboard connection and local configuration.'); process.exitCode = 1; });
