import fs from 'node:fs';
import path from 'node:path';
import { StarSnapshotSchema, safeDashboardUrl, type StarLoad } from './model';

export function loadStarSnapshot(): StarLoad {
  const file = process.env.STAR_SNAPSHOT_FILE || path.join(process.cwd(), '.local', 'star-snapshot.json');
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return { status: 'missing', snapshot: null }; }
  try {
    const snapshot = StarSnapshotSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, '')));
    snapshot.dashboardUrl = safeDashboardUrl(snapshot.dashboardUrl);
    return { status: 'ready', snapshot };
  } catch { return { status: 'invalid', snapshot: null }; }
}
