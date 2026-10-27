import type { ZodError } from 'zod';
import { CONSOLE_LIMITS, type ConsoleControls } from '@/lib/creative-engine/schemas';

/**
 * Pure helpers for the Motion console (S05a §7). Nothing here touches React,
 * the network or storage, so every branch is unit tested.
 */

type TextField = 'subject' | 'action' | 'dialogue' | 'onScreenText';
type NumberField = 'duration' | 'variations' | 'intensity' | 'imperfection' | 'skinRealism' | 'motionCues' | 'lensMm';
type ListField = 'referenceImages' | 'referenceVideos' | 'referenceAudios';

const TEXT_FIELDS: TextField[] = ['subject', 'action', 'dialogue', 'onScreenText'];
/** Integer ranges, matching ConsoleControlsSchema (lensMm has no schema range; 24 to 85 is the LENSES span). */
export const NUMBER_RANGES: Record<NumberField, readonly [number, number]> = {
  duration: [1, 30],
  variations: [1, 10],
  intensity: [1, 5],
  imperfection: [0, 9],
  skinRealism: [0, 4],
  motionCues: [3, 6],
  lensMm: [24, 85],
};
const LIST_MAX: Record<ListField, number> = { referenceImages: 30, referenceVideos: 10, referenceAudios: 10 };

/** Human names for console fields, used in limit messages. */
export const FIELD_LABEL: Partial<Record<keyof ConsoleControls, string>> = {
  subject: 'Subject',
  action: 'Action',
  dialogue: 'Dialogue',
  onScreenText: 'Overlay text',
  duration: 'Duration',
  variations: 'Variations',
  intensity: 'Motion intensity',
  imperfection: 'Imperfection',
  skinRealism: 'Skin realism',
  motionCues: 'Motion cues',
  lensMm: 'Lens feel',
  referenceImages: 'Reference images',
  referenceVideos: 'Reference videos',
  referenceAudios: 'Reference audio',
};

export type Trim = { field: TextField; from: number; to: number };

/**
 * Bring a partial set of controls inside the schema's limits: strings are cut
 * to CONSOLE_LIMITS, numbers rounded and clamped, reference lists capped.
 * Non-finite numbers and wrong-typed values are dropped so the caller's
 * previous or default value stands. Enums are left for the schema to judge.
 */
export function clampReport(partial: Partial<ConsoleControls>): { controls: Partial<ConsoleControls>; trimmed: Trim[] } {
  const out: Record<string, unknown> = { ...partial };
  const trimmed: Trim[] = [];
  for (const f of TEXT_FIELDS) {
    if (!(f in out)) continue;
    const v = out[f];
    if (typeof v !== 'string') { delete out[f]; continue; }
    const max = CONSOLE_LIMITS[f];
    if (v.length > max) { out[f] = v.slice(0, max); trimmed.push({ field: f, from: v.length, to: max }); }
  }
  for (const f of Object.keys(NUMBER_RANGES) as NumberField[]) {
    if (!(f in out)) continue;
    const v = out[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) { delete out[f]; continue; }
    const [lo, hi] = NUMBER_RANGES[f];
    out[f] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  for (const f of Object.keys(LIST_MAX) as ListField[]) {
    if (!(f in out)) continue;
    const v = out[f];
    if (!Array.isArray(v)) { delete out[f]; continue; }
    out[f] = v.filter((x): x is string => typeof x === 'string').slice(0, LIST_MAX[f]);
  }
  return { controls: out as Partial<ConsoleControls>, trimmed };
}

export function clampControls(partial: Partial<ConsoleControls>): Partial<ConsoleControls> {
  return clampReport(partial).controls;
}

/** One line for the first schema issue, naming the field: "Overlay text is 80 characters max". */
export function controlsIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'That value is not allowed.';
  const key = String(issue.path[0] ?? '');
  const label = FIELD_LABEL[key as keyof ConsoleControls] ?? (key || 'That value');
  if (issue.code === 'too_big' && issue.type === 'string') return `${label} is ${String(issue.maximum)} characters max`;
  if (issue.code === 'too_big' && issue.type === 'array') return `${label}: ${String(issue.maximum)} max`;
  if (issue.code === 'too_big') return `${label} is ${String(issue.maximum)} max`;
  if (issue.code === 'too_small' && issue.type !== 'string' && issue.type !== 'array') return `${label} is ${String(issue.minimum)} min`;
  return `${label}: ${issue.message}`;
}

/** The notice shown when a script or beat was cut to fit (S05a FR-2). */
export function trimNotice(trimmed: Trim[]): string | null {
  if (!trimmed.length) return null;
  return trimmed
    .map((t) => {
      const label = FIELD_LABEL[t.field] ?? t.field;
      if (t.field === 'dialogue') return `Script is ${t.from} characters; dialogue trimmed to ${t.to}. Pick a beat to send it in parts.`;
      return `${label} is ${t.from} characters; trimmed to ${t.to}.`;
    })
    .join(' ');
}

/* ── S05a §7: block reason, readout, presets, defaults, drafts ── */

export type BlockAction = 'campaign' | 'lints' | 'connect' | null;
export type BlockReason = { text: string; action: BlockAction };

/**
 * The one reason Generate cannot run right now (S05a FR-8), or null. The main
 * Generate, the Cost preview and its Confirm all read this, so they never
 * disagree. Order: sample first (nothing can fix it here), then the setup a
 * person has to do (connect, then a campaign), then the request itself.
 */
export function generateBlockReason(s: { campaign: boolean; readOnly: boolean; connected: boolean; blocking: number; busy: boolean }): BlockReason | null {
  if (s.readOnly) return { text: 'Sample data: actions are off', action: null };
  if (!s.connected) return { text: 'Connect Arcads first', action: 'connect' };
  if (!s.campaign) return { text: 'Open or create a campaign first', action: 'campaign' };
  if (s.blocking > 0) return { text: `Fix ${s.blocking} lint error${s.blocking === 1 ? '' : 's'}`, action: 'lints' };
  if (s.busy) return { text: 'Sending the last request', action: null };
  return null;
}

/** Session spend chips (S05a R4): used and left percentages that always sum to 100, each clamped to 0..100. */
export function chipWidths(spent: number, cap: number): { used: number; left: number } {
  if (!Number.isFinite(spent) || !Number.isFinite(cap) || cap <= 0) return spent > 0 ? { used: 100, left: 0 } : { used: 0, left: 100 };
  const used = Math.min(100, Math.max(0, (spent / cap) * 100));
  return { used, left: 100 - used };
}

/** "pending" -> "Pending", "in_progress" -> "In progress". */
export function titleCaseStatus(s: string | null | undefined): string {
  const t = (s ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
}

/** Whether any key the preset sets differs from the controls (S05a FR-6). Keys the preset leaves alone never count. */
export function isPresetModified(preset: Partial<ConsoleControls>, c: ConsoleControls): boolean {
  return (Object.keys(preset) as (keyof ConsoleControls)[]).some((k) => JSON.stringify(preset[k]) !== JSON.stringify(c[k]));
}

/** The value a caret resets a row to: the applied preset's value for that key, else the schema default (S05a FR-17). */
export function defaultFor<K extends keyof ConsoleControls>(key: K, defaults: ConsoleControls, preset?: Partial<ConsoleControls> | null): ConsoleControls[K] {
  const p = preset?.[key];
  return (p === undefined ? defaults[key] : p) as ConsoleControls[K];
}

/** Whether a row differs from what its caret would reset it to. */
export function isModified<K extends keyof ConsoleControls>(key: K, c: ConsoleControls, defaults: ConsoleControls, preset?: Partial<ConsoleControls> | null): boolean {
  return JSON.stringify(c[key]) !== JSON.stringify(defaultFor(key, defaults, preset));
}

/** The keys each parameter column owns, for its "Reset … to defaults" menu (S05a P5). References and dialogue text are never reset from a column. */
export const COLUMN_KEYS = {
  shot: ['framing', 'movement', 'height', 'lensMm', 'intensity', 'duration', 'aspectRatio', 'resolution'],
  look: ['lighting', 'style', 'setting', 'imperfection', 'skinRealism', 'motionCues', 'intro', 'tone', 'subject'],
  output: ['variations', 'audioEnabled', 'enhance', 'bitrateMode', 'omitDialogue', 'onScreenText', 'textReveal'],
} as const satisfies Record<string, readonly (keyof ConsoleControls)[]>;

/** The per-campaign draft key in localStorage (S05a FR-1). */
export function draftKey(campaignId: string | null | undefined): string {
  return `ae-console-draft:${campaignId || 'none'}`;
}

export const DRAFT_TABS = ['scene', 'presets', 'references'] as const;
const DRAFT_PARTS = ['subject', 'action', 'camera', 'style', 'constraints'] as const;
export type DraftPart = (typeof DRAFT_PARTS)[number];
export type ConsoleDraft = {
  v: 1;
  c: ConsoleControls;
  locked: DraftPart[];
  open: DraftPart[];
  beatPick: number | null;
  tab: (typeof DRAFT_TABS)[number];
  activePreset: string | null;
  /** `<scriptId>:<approvedVersion>` the dialogue was seeded from, so a restore does not re-seed it */
  scriptKey: string | null;
};

type ControlsParser = { safeParse: (v: unknown) => { success: true; data: ConsoleControls } | { success: false } };

/**
 * Read a stored draft, or null. Anything that does not parse is discarded:
 * the controls go through the schema (with limits clamped first), the lists
 * keep only known parts, and unknown tabs fall back to Scene.
 */
export function parseDraft(raw: string | null | undefined, schema: ControlsParser): ConsoleDraft | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const d = j as Record<string, unknown>;
  if (d.v !== 1 || !d.c || typeof d.c !== 'object' || Array.isArray(d.c)) return null;
  const parsed = schema.safeParse(clampControls(d.c as Partial<ConsoleControls>));
  if (!parsed.success) return null;
  const parts = (v: unknown): DraftPart[] => (Array.isArray(v) ? v.filter((x): x is DraftPart => (DRAFT_PARTS as readonly unknown[]).includes(x)) : []);
  const tab = (DRAFT_TABS as readonly unknown[]).includes(d.tab) ? (d.tab as ConsoleDraft['tab']) : 'scene';
  const beatPick = typeof d.beatPick === 'number' && Number.isInteger(d.beatPick) && d.beatPick >= 0 ? d.beatPick : null;
  return {
    v: 1,
    c: parsed.data,
    locked: parts(d.locked),
    open: parts(d.open),
    beatPick,
    tab,
    activePreset: typeof d.activePreset === 'string' ? d.activePreset.slice(0, 60) : null,
    scriptKey: typeof d.scriptKey === 'string' ? d.scriptKey.slice(0, 120) : null,
  };
}

/** Keyboard shortcuts of the console (S05a FR-3), shown in the shortcuts sheet. */
export const CONSOLE_SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Esc', what: 'Close the top layer: menu, dialog, builder layer, stage sheet, then the console' },
  { keys: '[  ]', what: 'Previous and next motion asset' },
  { keys: 'G', what: 'Generate: opens the cost preview, nothing is sent without Confirm' },
  { keys: 'P', what: 'Composed prompt' },
  { keys: 'L', what: 'Lints' },
  { keys: 'D', what: 'Dialogue' },
  { keys: '/', what: 'Describe it' },
];

export type ShortcutAction = 'prev' | 'next' | 'generate' | 'prompt' | 'lints' | 'dialogue' | 'describe';

/** Which shortcut a key press means, or null. Ignored with modifiers and while typing (S05a §6). */
export function shortcutFor(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, targetTag: string | null, editable = false): ShortcutAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const tag = (targetTag ?? '').toUpperCase();
  if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  switch (e.key) {
    case '[': return 'prev';
    case ']': return 'next';
    case 'g': case 'G': return 'generate';
    case 'p': case 'P': return 'prompt';
    case 'l': case 'L': return 'lints';
    case 'd': case 'D': return 'dialogue';
    case '/': return 'describe';
    default: return null;
  }
}

/* ── S05a FR-10: host-local reference path checks ── */

const KIND_BY_EXT: Record<string, 'image' | 'video' | 'audio'> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', gif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio',
};

/** The media kind a path's extension names, or null. */
export function assetKindFromPath(p: string): 'image' | 'video' | 'audio' | null {
  const m = /\.([a-z0-9]+)$/i.exec(p.trim());
  return m ? KIND_BY_EXT[m[1].toLowerCase()] ?? null : null;
}

/** Why a path may not be checked, or null when it may: absolute only, no `..` segment, no NUL, bounded length. */
export function checkPathProblem(p: string | null | undefined): string | null {
  if (!p || !p.trim()) return 'path required';
  if (p.length > 1024) return 'path too long';
  if (p.includes('\0')) return 'invalid path';
  if (!p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) return 'path must be absolute';
  if (p.split(/[\\/]/).some((seg) => seg === '..')) return 'path must not contain ..';
  return null;
}
