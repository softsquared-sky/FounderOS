import fs from 'node:fs';
import path from 'node:path';
import { relFromPublic } from '@/lib/creative-engine/migrate';
import { engineEnv } from '@/lib/creative-engine/env';
import { randomUUID } from 'node:crypto';
import { ArcadsClient, ArcadsError, createArcadsClient, explainArcadsError, pollTalkingActor, pollUgc, pollV2, type CreditsBalance, type PollResult } from '@/lib/arcads/client';
import { buildVideoBody, cheapestRequest, stripIgnoredRefs, validateRequest } from '@/lib/arcads/validate';
import { composePrompt } from '@/lib/creative-engine/compose';
import { BRAND } from '@/lib/brand';
import { ENGINE_NAME } from '@/lib/creative-engine/name';
import { isDry } from '@/lib/creative-engine/dry';
import { rehost, thumbnailFor } from '@/lib/creative-engine/assets';
import { recordModelProbe } from '@/lib/creative-engine/health';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { ConsoleControlsSchema, type Campaign, type ConsoleControls, type CreditsSnapshot, type Generation, type Run, type VideoModel } from '@/lib/creative-engine/schemas';
import { appendLedger, assetPathFor, mutateCampaign, mutateRun, readCreditsSnapshot, readLedger, readRuns, readSettings, writeCreditsSnapshot, writeSettings } from '@/lib/creative-engine/store';
import { matchVoice, readCatalog } from '@/lib/arcads/catalog';

/**
 * Generation — submit to Arcads and record a run per request; polling is
 * READ-DRIVEN (the runs GET advances any running Arcads run older than
 * 15 s) because the repo has no queue worker.
 *
 * Credits are never predicted. They are recorded two ways: from the create
 * reply when it carries `creditsCharged`, otherwise as the DELTA of
 * GET /v1/credits between the last snapshot and the poll that delivered
 * (split evenly when several runs deliver in one pass). The session cap
 * is enforced here from the ledger, not displayed and ignored.
 *
 * Dry mode fabricates a job that completes on the third poll with a
 * placeholder file and a 0-credit `dry:true` ledger row.
 */

export const SESSION_CREDIT_CAP = Number(engineEnv('CREDIT_CAP') ?? 200);

function ensureClient(): ArcadsClient | null {
  return isDry() ? null : createArcadsClient();
}

export function toSnapshot(b: CreditsBalance): CreditsSnapshot {
  const plan = typeof b.plan === 'string' ? b.plan : b.plan && typeof b.plan === 'object' ? ((b.plan as { name?: string }).name ?? null) : null;
  return { at: new Date().toISOString(), creditsIncluded: b.creditsIncluded ?? null, creditsRemaining: b.creditsRemaining ?? null, additionalCreditsUsed: b.additionalCreditsUsed ?? null, periodStart: b.currentPeriodStart ?? null, periodEnd: b.currentPeriodEnd ?? null, plan };
}

/** Read and store the workspace balance. Never throws; null when it cannot be read. */
export async function refreshCredits(client: ArcadsClient | null): Promise<CreditsSnapshot | null> {
  if (!client) return readCreditsSnapshot();
  try {
    const snap = toSnapshot(await client.credits());
    writeCreditsSnapshot(snap);
    return snap;
  } catch {
    return readCreditsSnapshot();
  }
}

/** Credits spent this session (ledger rows since sessionStartedAt, non-dry). */
export function sessionSpend(): { spent: number; cap: number; since: string } {
  const s = readSettings();
  const since = s.sessionStartedAt ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
  const spent = readLedger().filter((e) => !e.dry && e.at >= since).reduce((a, e) => a + e.creditsCharged, 0);
  return { spent: Math.round(spent * 100) / 100, cap: s.sessionCreditCap || SESSION_CREDIT_CAP, since };
}

export function startSession(): void {
  writeSettings({ sessionStartedAt: new Date().toISOString() });
}

export class CapError extends Error {
  constructor(public spent: number, public cap: number) {
    super(`session cap reached: ${spent} of ${cap} credits spent. Confirm again to pass it, or raise the cap in Connect Arcads`);
  }
}

/** Refuse before any charge when the session is at its cap or the workspace is empty. `override` passes the cap once. */
export function enforceCap(override: boolean): void {
  if (isDry()) return;
  const { spent, cap } = sessionSpend();
  if (cap > 0 && spent >= cap && !override) throw new CapError(spent, cap);
  const snap = readCreditsSnapshot();
  if (snap?.creditsRemaining !== null && snap?.creditsRemaining !== undefined && snap.creditsRemaining <= 0) throw new ArcadsError('workspace has 0 credits remaining', 402, '', { kind: 'credits' });
}

/** The product every request files under: the campaign's, else the engine default, else the first in the workspace. */
export async function resolveProductId(client: ArcadsClient | null, campaign: Campaign | null, productId?: string | null): Promise<string> {
  if (productId) return productId;
  if (campaign?.arcads.productId) return campaign.arcads.productId;
  const s = readSettings();
  if (s.arcadsProductId) return s.arcadsProductId;
  if (!client) return 'dry-product-1';
  const products = await client.products();
  if (products[0]) {
    writeSettings({ arcadsProductId: products[0].id, arcadsProductName: products[0].name });
    return products[0].id;
  }
  const created = await client.createProduct({ name: campaign?.name.slice(0, 80) ?? 'Untitled product', description: campaign?.concept.text.slice(0, 500) ?? `Created by ${BRAND.name} ${ENGINE_NAME}` });
  writeSettings({ arcadsProductId: created.id, arcadsProductName: created.name });
  return created.id;
}

/** The v1 chain needs a folder per campaign; v2 does not. */
export async function ensureProductAndFolder(client: ArcadsClient | null, campaign: Campaign, productId?: string | null): Promise<{ productId: string; folderId: string }> {
  if (campaign.arcads.productId && campaign.arcads.folderId) return { productId: campaign.arcads.productId, folderId: campaign.arcads.folderId };
  const pid = await resolveProductId(client, campaign, productId);
  if (!client) return { productId: pid, folderId: 'dry-folder-1' };
  const folder = await client.createFolder(pid, `${BRAND.name} · ${campaign.name.slice(0, 60)}`);
  mutateCampaign(campaign.id, (c) => ({ ...c, arcads: { productId: pid, folderId: folder.id } }));
  return { productId: pid, folderId: folder.id };
}

const blankArcads = (p: { id: string; type: string; model: string; pollPath: Run['arcads'] extends infer A ? (A extends { pollPath: infer P } ? P : never) : never; creditsCharged?: number | null; lastRaw?: string | null; creditsBefore?: number | null; lastStatus?: string }) => ({
  id: p.id,
  type: p.type,
  model: p.model,
  creditsCharged: p.creditsCharged ?? null,
  pollPath: p.pollPath,
  lastPolledAt: null,
  lastStatus: p.lastStatus ?? 'pending',
  lastRaw: p.lastRaw ?? null,
  creditsBefore: p.creditsBefore ?? null,
  sourceUrl: null,
  thumbnailUrl: null,
});

export async function submitUgc(input: { campaign: Campaign; scriptId: string; situationId: string; voiceId?: string | null; productId?: string | null; override?: boolean }): Promise<{ generation: Generation; run: Run }> {
  const { campaign } = input;
  const script = campaign.scripts.find((s) => s.id === input.scriptId);
  const version = script?.versions.find((v) => v.n === script.approvedVersion) ?? script?.versions.at(-1);
  if (!script || !version) throw new Error('approve a script version first');
  const client = ensureClient();
  if (!client && !isDry()) throw new Error('Arcads not configured — set ARCADS_BASIC_AUTH');
  enforceCap(!!input.override);
  const path = readSettings().ugcPath;

  const generation: Generation = { id: `gen-${randomUUID().slice(0, 8)}`, kind: 'ugc', scriptId: script.id, request: { situationId: input.situationId, voiceId: input.voiceId ?? null, path }, runIds: [], assetIds: [], at: new Date().toISOString() };
  const run = startRun({ campaignId: campaign.id, kind: 'ugc', title: `UGC · ${version.hook.slice(0, 50)}`, dry: isDry() });
  mutateCampaign(campaign.id, (c) => ({ ...c, generations: [...c.generations, { ...generation, runIds: [run.id] }] }));

  try {
    if (!client) {
      mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: `dry-script-${run.id}`, type: 'ugc', model: 'ugc-actor', pollPath: path === 'v2' ? 'talking-actors' : 'scripts', creditsCharged: 0 }) }));
      appendLedger({ at: new Date().toISOString(), kind: 'ugc', model: 'ugc-actor', durationSec: null, creditsCharged: 0, runId: run.id, dry: true, source: 'dry' });
      return { generation, run };
    }
    const before = (await refreshCredits(client))?.creditsRemaining ?? null;
    if (path === 'v2') {
      const productId = await resolveProductId(client, campaign, input.productId);
      let voiceId = input.voiceId ?? undefined;
      if (!voiceId) {
        const cat = await readCatalog();
        voiceId = matchVoice(cat, input.situationId)?.id;
      }
      const { results, raw } = await client.generateTalkingActors({ productId, script: version.fullScript, actors: [{ situationId: input.situationId, voiceId }] });
      const first = results[0];
      if (!first) throw new ArcadsError(`talking-actors reply had no id: ${raw.slice(0, 160)}`, 201, raw, { kind: 'unknown' });
      mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: first.id, type: 'talking-actor', model: first.model ?? 'arcads_1.0', pollPath: 'talking-actors', lastRaw: raw, creditsBefore: before, lastStatus: first.status }) }));
    } else {
      const { folderId } = await ensureProductAndFolder(client, campaign, input.productId);
      const created = await client.createScript({ folderId, name: `${campaign.name.slice(0, 40)} · v${version.n}`, text: version.fullScript, situationId: input.situationId, voiceId: input.voiceId ?? undefined });
      await client.generateScript(created.id);
      mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: created.id, type: 'ugc', model: 'ugc-actor', pollPath: 'scripts', creditsBefore: before }) }));
    }
    return { generation, run };
  } catch (err) {
    failRun(run.id, explainArcadsError(err).message);
    throw err;
  }
}

function fileTypeFor(p: string): string {
  const ext = p.toLowerCase().split('.').pop() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/m4a', aac: 'audio/aac', ogg: 'audio/ogg' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/** Upload every reference fresh for ONE request (handles are single-use). */
async function uploadRefs(client: ArcadsClient, c: ConsoleControls) {
  const up = async (p: string) => {
    if (!fs.existsSync(p)) throw new Error(`reference file not found: ${p}`);
    return client.upload(new Uint8Array(fs.readFileSync(p)), fileTypeFor(p));
  };
  return {
    referenceImages: await Promise.all(c.referenceImages.map(up)),
    referenceVideos: await Promise.all(c.referenceVideos.map(up)),
    referenceAudios: await Promise.all(c.referenceAudios.map(up)),
    startFrame: c.startFrame ? await up(c.startFrame) : null,
    endFrame: c.endFrame ? await up(c.endFrame) : null,
  };
}

export type SubmitFailure = { runId: string; kind: string; reason: string };

export async function submitMotion(input: { campaign: Campaign | null; controls: Partial<ConsoleControls>; productId?: string | null; scriptId?: string | null; override?: boolean; title?: string }): Promise<{ generation: Generation | null; runs: Run[]; failed: SubmitFailure[]; prompt: string }> {
  // fields the model takes none of are kept on the console but never uploaded or sent (S05a Q-MC-4)
  const controls = stripIgnoredRefs(ConsoleControlsSchema.parse(input.controls));
  const lints = validateRequest(controls);
  const blocking = lints.filter((l) => l.level === 'error');
  if (blocking.length) throw new Error(`request blocked: ${blocking.map((l) => l.message).join('; ')}`);
  const composed = composePrompt(controls);
  const hard = composed.lints.filter((l) => l.level === 'error');
  if (hard.length) throw new Error(`prompt blocked: ${hard.map((l) => l.message).join('; ')}`);

  const client = ensureClient();
  if (!client && !isDry()) throw new Error('Arcads not configured — set ARCADS_BASIC_AUTH');
  enforceCap(!!input.override);
  const { campaign } = input;
  const requests = controls.variations;
  const generation: Generation | null = campaign ? { id: `gen-${randomUUID().slice(0, 8)}`, kind: 'motion', scriptId: input.scriptId ?? null, request: { controls, prompt: composed.prompt }, runIds: [], assetIds: [], at: new Date().toISOString() } : null;
  const runs: Run[] = [];
  const failed: SubmitFailure[] = [];
  const productId = await resolveProductId(client, campaign, input.productId);
  const before = client ? ((await refreshCredits(client))?.creditsRemaining ?? null) : null;

  for (let i = 0; i < requests; i += 1) {
    const run = startRun({ campaignId: campaign?.id ?? null, kind: 'motion', title: input.title ?? `${controls.model} · ${controls.duration}s · #${i + 1}`, dry: isDry() });
    runs.push(run);
    try {
      if (!client) {
        mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: `dry-asset-${run.id}`, type: controls.model, model: controls.model, pollPath: 'assets', creditsCharged: 0 }) }));
        appendLedger({ at: new Date().toISOString(), kind: 'motion', model: controls.model, durationSec: controls.duration, creditsCharged: 0, runId: run.id, dry: true, source: 'dry' });
        continue;
      }
      const uploaded = await uploadRefs(client, controls);
      const body = buildVideoBody(controls, composed.prompt, productId, uploaded);
      const created = await client.generateVideo(body);
      mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: created.id, type: created.type, model: controls.model, pollPath: 'assets', creditsCharged: created.creditsCharged, lastRaw: created.raw, creditsBefore: before, lastStatus: created.status }) }));
      if (created.creditsCharged !== null) appendLedger({ at: new Date().toISOString(), kind: 'motion', model: controls.model, durationSec: controls.duration, creditsCharged: created.creditsCharged, runId: run.id, dry: false, source: 'response' });
      if (i < requests - 1) await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      const ex = explainArcadsError(err);
      failRun(run.id, ex.message);
      failed.push({ runId: run.id, kind: ex.kind, reason: ex.message });
      // a key, credit or rate problem will hit every remaining request too
      if (ex.kind === 'auth' || ex.kind === 'credits' || ex.kind === 'rate') break;
    }
  }
  if (campaign && generation) mutateCampaign(campaign.id, (c) => ({ ...c, generations: [...c.generations, { ...generation, runIds: runs.map((r) => r.id) }] }));
  return { generation, runs, failed, prompt: composed.prompt };
}

/** The paid per-model probe: the cheapest request for that model, with no campaign; the poll records the verdict in health. */
export async function submitModelProbe(model: VideoModel, override = false): Promise<{ run: Run | null; failed: SubmitFailure[] }> {
  const controls = { ...cheapestRequest(model), subject: 'a person in a plain t-shirt, looking at the camera', dialogue: '', onScreenText: '' };
  const res = await submitMotion({ campaign: null, controls, override, title: `probe · ${model}` });
  const run = res.runs[0] ?? null;
  if (res.failed[0]) recordModelProbe(model, false, res.failed[0].reason);
  return { run, failed: res.failed };
}

export async function submitImage(input: { campaign: Campaign; model: string; prompt: string; aspectRatio: '1:1' | '16:9' | '9:16'; productId?: string | null; override?: boolean }): Promise<{ generation: Generation; run: Run }> {
  const client = ensureClient();
  if (!client && !isDry()) throw new Error('Arcads not configured — set ARCADS_BASIC_AUTH');
  enforceCap(!!input.override);
  const { campaign } = input;
  const generation: Generation = { id: `gen-${randomUUID().slice(0, 8)}`, kind: 'image', scriptId: null, request: { model: input.model, prompt: input.prompt, aspectRatio: input.aspectRatio }, runIds: [], assetIds: [], at: new Date().toISOString() };
  const run = startRun({ campaignId: campaign.id, kind: 'image', title: `${input.model} · ${input.aspectRatio}`, dry: isDry() });
  mutateCampaign(campaign.id, (c) => ({ ...c, generations: [...c.generations, { ...generation, runIds: [run.id] }] }));
  try {
    if (!client) {
      mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: `dry-image-${run.id}`, type: input.model, model: input.model, pollPath: 'assets', creditsCharged: 0 }) }));
      appendLedger({ at: new Date().toISOString(), kind: 'image', model: input.model, durationSec: null, creditsCharged: 0, runId: run.id, dry: true, source: 'dry' });
      return { generation, run };
    }
    const productId = await resolveProductId(client, campaign, input.productId);
    const before = (await refreshCredits(client))?.creditsRemaining ?? null;
    const created = await client.generateImage({ productId, prompt: input.prompt, model: input.model, aspectRatio: input.aspectRatio });
    mutateRun(run.id, (r) => ({ ...r, arcads: blankArcads({ id: created.id, type: created.type, model: input.model, pollPath: 'assets', creditsCharged: created.creditsCharged, lastRaw: created.raw, creditsBefore: before, lastStatus: created.status }) }));
    if (created.creditsCharged !== null) appendLedger({ at: new Date().toISOString(), kind: 'image', model: input.model, durationSec: null, creditsCharged: created.creditsCharged, runId: run.id, dry: false, source: 'response' });
    return { generation, run };
  } catch (err) {
    failRun(run.id, explainArcadsError(err).message);
    throw err;
  }
}

/** Dry jobs: pending twice, then generated with a tiny placeholder file written locally. */
function dryPoll(run: Run): PollResult {
  const polls = Number(run.arcads?.lastStatus?.match(/poll(\d+)/)?.[1] ?? 0) + 1;
  if (polls < 3) return { status: 'pending', url: null, thumbnailUrl: null, error: null, raw: `poll${polls}` };
  return { status: 'generated', url: 'dry://placeholder', thumbnailUrl: null, error: null, raw: 'generated' };
}

async function downloadWithRetry(input: { client: ArcadsClient | null; run: Run; url: string; campaignId: string; assetId: string; kind: 'video' | 'image' }): Promise<{ path: string; abs: string }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // a fresh signed link each attempt when the asset route offers one
      let url = input.url;
      if (input.client && input.run.arcads?.pollPath === 'assets' && attempt > 0) url = (await input.client.downloadUrl(input.run.arcads.id).catch(() => null)) ?? url;
      const hosted = await rehost({ campaignId: input.campaignId, assetId: input.assetId, sourceUrl: url, kind: input.kind, fetchImpl: input.client?.fetcher() });
      return hosted;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, (process.env.NODE_ENV === 'test' ? 10 : 400) * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Advance every running Arcads run not polled in the last `minAgeMs`. Called by the runs GET. */
export async function advanceArcadsRuns(minAgeMs = 15_000, clientOverride?: ArcadsClient | null): Promise<number> {
  const now = Date.now();
  const runs = readRuns().filter((r) => r.arcads && !r.finishedAt && !r.abandoned && (!r.arcads.lastPolledAt || now - new Date(r.arcads.lastPolledAt).getTime() >= minAgeMs)); // >= so minAgeMs 0 means every pass, even within one millisecond
  if (runs.length === 0) return 0;
  const client = clientOverride === undefined ? ensureClient() : clientOverride;
  let advanced = 0;
  const delivered: { run: Run; charged: number | null }[] = [];
  for (const run of runs) {
    const a = run.arcads!;
    let result: PollResult;
    try {
      if (run.dry) result = dryPoll(run);
      else if (!client) continue;
      else if (a.pollPath === 'talking-actors') result = await pollTalkingActor(client, a.id);
      else if (a.pollPath === 'scripts') result = await pollUgc(client, a.id);
      else result = await pollV2(client, a.id, a.pollPath);
    } catch (err) {
      const ex = explainArcadsError(err);
      mutateRun(run.id, (r) => ({ ...r, arcads: { ...r.arcads!, lastPolledAt: new Date().toISOString(), lastStatus: `poll ${ex.kind}: ${ex.message}`.slice(0, 160) } }));
      if (ex.kind === 'auth') break; // the key is gone; every other poll would fail the same way
      continue;
    }
    advanced += 1;
    if (result.status === 'pending') {
      mutateRun(run.id, (r) => ({ ...r, arcads: { ...r.arcads!, lastPolledAt: new Date().toISOString(), lastStatus: run.dry ? result.raw : result.raw || 'pending' } }));
      continue;
    }
    if (result.status === 'failed') {
      failRun(run.id, result.error ?? 'generation failed (credits are not refunded for content-check rejections)');
      if (!run.campaignId) recordModelProbe(a.model, false, result.error ?? 'generation failed');
      continue;
    }
    // generated: keep the expiring link and thumbnail first, then download
    mutateRun(run.id, (r) => ({ ...r, arcads: { ...r.arcads!, sourceUrl: result.url, thumbnailUrl: result.thumbnailUrl, lastPolledAt: new Date().toISOString(), lastStatus: 'generated' } }));
    const campaignId = run.campaignId;
    const assetId = `ast-${randomUUID().slice(0, 8)}`;
    const kind: 'video' | 'image' = run.kind === 'image' ? 'image' : 'video';
    const folder = campaignId ?? 'probes';
    try {
      let publicPath: string;
      let abs: string;
      let thumb: string | null = null;
      if (run.dry || !result.url) {
        const p = assetPathFor(folder, assetId, kind === 'video' ? '.mp4' : '.png');
        fs.mkdirSync(path.dirname(p.abs), { recursive: true });
        fs.writeFileSync(p.abs, run.dry ? Buffer.from('dry run placeholder') : Buffer.alloc(0));
        publicPath = p.publicPath;
        abs = p.abs;
      } else {
        const hosted = await downloadWithRetry({ client, run, url: result.url, campaignId: folder, assetId, kind });
        publicPath = hosted.path;
        abs = hosted.abs;
        if (kind === 'video') thumb = await thumbnailFor(folder, assetId, abs);
        if (!thumb && result.thumbnailUrl) thumb = (await rehost({ campaignId: folder, assetId: `${assetId}-thumb`, sourceUrl: result.thumbnailUrl, kind: 'image', fetchImpl: client?.fetcher() }).catch(() => null))?.path ?? null;
      }
      const rel = relFromPublic(publicPath);
      if (campaignId) {
        mutateCampaign(campaignId, (c) => {
          const gen = c.generations.find((g) => g.runIds.includes(run.id));
          const asset = { id: assetId, generationId: gen?.id ?? 'unknown', kind, path: publicPath, thumbnailPath: thumb, sourceUrl: result.url, model: a.model, creditsCharged: a.creditsCharged, durationSec: null, at: new Date().toISOString() };
          return { ...c, assets: [...c.assets, asset], generations: c.generations.map((g) => (g.id === gen?.id ? { ...g, assetIds: [...g.assetIds, assetId] } : g)) };
        });
      } else {
        recordModelProbe(a.model, true, null);
      }
      finishRun(run.id, { outputRef: `asset:${rel}`, arcads: { ...a, sourceUrl: result.url, thumbnailUrl: result.thumbnailUrl, lastPolledAt: new Date().toISOString(), lastStatus: 'generated' } });
      delivered.push({ run, charged: a.creditsCharged });
    } catch (err) {
      // the video exists at Arcads and was paid for: keep the run alive so the next pass downloads again
      mutateRun(run.id, (r) => ({ ...r, arcads: { ...r.arcads!, lastPolledAt: new Date().toISOString(), lastStatus: `generated, download failed (retrying): ${err instanceof Error ? err.message : String(err)}`.slice(0, 160) } }));
    }
  }
  // every delivery refreshes the balance; anything the create reply did not price is charged by delta
  const unpriced = delivered.filter((d) => d.charged === null && !d.run.dry);
  if (delivered.some((d) => !d.run.dry) && client) {
    const prev = readCreditsSnapshot();
    const next = await refreshCredits(client);
    if (!unpriced.length) return advanced;
    if (prev?.creditsRemaining != null && next?.creditsRemaining != null) {
      const delta = Math.max(0, prev.creditsRemaining - next.creditsRemaining);
      const each = Math.round((delta / unpriced.length) * 100) / 100;
      for (const d of unpriced) {
        appendLedger({ at: new Date().toISOString(), kind: d.run.kind === 'image' ? 'image' : d.run.kind === 'ugc' ? 'ugc' : 'motion', model: d.run.arcads!.model, durationSec: null, creditsCharged: each, runId: d.run.id, dry: false, source: 'delta' });
        mutateRun(d.run.id, (r) => ({ ...r, arcads: { ...r.arcads!, creditsCharged: each } }));
      }
    }
  }
  return advanced;
}
