import { z } from 'zod';
import { AxLoadSchema } from './ax-model';

export const StarTaskSchema = z.object({
  id: z.string().min(1), title: z.string(), lane: z.string(), label: z.string(),
  localStatus: z.string(), canonicalState: z.string().nullable(),
  roleIds: z.array(z.string()), nextAction: z.string(), updatedAt: z.string(),
  sourceKey: z.string().nullable(), sourceRevision: z.number().nullable(), verifiedAt: z.string().nullable(),
});
export const StarSnapshotSchema = z.object({
  schema: z.literal('star-operator-snapshot-v1'), capturedAt: z.string().datetime(),
  dashboardUrl: z.string().url(),
  projection: z.object({ status: z.string(), verifiedAt: z.string().nullable(), revision: z.number().nullable() }),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  tasks: z.array(StarTaskSchema),
  ax: AxLoadSchema.optional(),
});
export type StarTask = z.infer<typeof StarTaskSchema>;
export type StarSnapshot = z.infer<typeof StarSnapshotSchema>;
export type StarLoad = { status: 'ready' | 'missing' | 'invalid'; snapshot: StarSnapshot | null };

/** Only public web links or loopback HTTP may leave the local dashboard. */
export function safeDashboardUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search) throw new Error('dashboard URL must not contain credentials or query parameters');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('dashboard URL must use HTTPS or loopback HTTP');
  }
  url.hash = 'work';
  return url.href;
}

type Dict = Record<string, any>;
/** Whitelist fields. No prompt, output, comment, transcript, notification or credentials cross this boundary. */
export function normalizeStarState(state: Dict, boards: Record<string, { lane: string; label: string }>, dashboardUrl: string, at = new Date()): StarSnapshot {
  const roles: Dict[] = Array.isArray(state.personas) ? state.personas : [];
  const resolveRole = (id: string) => {
    const seen = new Set<string>();
    while (roles.find(r => r.id === id)?.mergedInto && !seen.has(id)) {
      seen.add(id); id = roles.find(r => r.id === id)!.mergedInto;
    }
    return id;
  };
  const tasks = (Array.isArray(state.jobs) ? state.jobs : []).filter((j: Dict) =>
    !j.demo && j.kind !== 'operation' && !j.ownerDeletion && !j.mcpArchived && j.intakeCandidate?.state !== 'candidate' && boards[j.id]?.lane !== 'candidates',
  ).map((j: Dict) => {
    const link = j.canonicalLinks?.[0];
    const board = boards[j.id] ?? { lane: 'unknown', label: '분류 미확인' };
    return {
      id: j.id, title: j.title ?? '제목 미확인', lane: board.lane, label: board.label,
      localStatus: j.status ?? 'unknown', canonicalState: link?.state ?? null,
      roleIds: [...new Set<string>((j.personaIds?.length ? j.personaIds : (j.canonicalLinks ?? []).map((l: Dict) => l.roleId)).filter(Boolean).map(resolveRole))],
      nextAction: link?.nextAction ?? '', updatedAt: j.updatedAt ?? j.createdAt ?? '',
      sourceKey: link?.source?.key ?? j.source?.locator ?? null,
      sourceRevision: link?.source?.revision ?? null, verifiedAt: link?.verifiedAt ?? null,
    };
  });
  return StarSnapshotSchema.parse({
    schema: 'star-operator-snapshot-v1', capturedAt: at.toISOString(), dashboardUrl: safeDashboardUrl(dashboardUrl),
    projection: { status: state.projection?.status ?? 'unknown', verifiedAt: state.projection?.verifiedAt ?? null, revision: state.projection?.revision ?? null },
    roles: roles.filter(r => !r.mergedInto && !r.id?.startsWith('legacy-')).map(r => ({ id: r.id, name: r.name })), tasks,
  });
}

export function snapshotOld(capturedAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(capturedAt);
  return !Number.isFinite(age) || age > 15 * 60_000 || age < -60_000;
}

export function selectTasks(tasks: StarTask[], filter: string, role: string, query: string): StarTask[] {
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  return tasks.filter(t => {
    const matchLane = filter === 'all' ? !['done', 'rejected', 'deleted'].includes(t.lane)
      : filter === 'waiting' ? t.lane !== 'done' && t.lane !== 'rejected' && ['waiting', 'blocked', 'scheduled'].includes(t.canonicalState ?? '')
      : t.lane === filter;
    return matchLane && (role === 'all' || t.roleIds.includes(role)) &&
      (!needle || `${t.title} ${t.nextAction} ${t.id} ${t.sourceKey ?? ''}`.toLocaleLowerCase('ko-KR').includes(needle));
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
