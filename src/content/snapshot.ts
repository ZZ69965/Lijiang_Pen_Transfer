/**
 * In-memory scene snapshot.
 *
 * Purpose: entering the Three.js prologue or finale UNMOUNTS the Pixi stage.
 * Before that we save where the visitor was, and when the painting is ready
 * again we put them back exactly. This is a same-visit snapshot only — no
 * localStorage, no accounts (see 漓江下一步开发计划 §四.2).
 */
import type { PlaceId, TimeOfDay, VisitMode } from './places.ts';

export const SNAPSHOT_VERSION = 1;

export type SceneSnapshot = {
  version: number;
  time: TimeOfDay;
  mode: VisitMode;
  place: PlaceId;
  /** Walker position in native world pixels. */
  heroX: number;
  /** 1 = facing right (towards the painting's later scenes), -1 = left. */
  facing: 1 | -1;
  /** World X at the centre of the viewport. */
  cameraCentre: number;
  zoom: number;
  /** Steps completed in the fish-market story, so a revisit keeps its result. */
  marketRecord: { outcome: 'bought' | 'left'; kindId: string | null } | null;
  /** When the snapshot was taken (ms since epoch), for diagnostics only. */
  savedAt: number;
};

type SnapshotSource = Omit<SceneSnapshot, 'version' | 'savedAt'>;

export function createSnapshot(source: SnapshotSource, now = Date.now()): SceneSnapshot {
  return { version: SNAPSHOT_VERSION, savedAt: now, ...source };
}

/**
 * Validate a snapshot before restoring. Returns null for anything malformed so
 * a corrupt value degrades to the default view instead of throwing.
 */
export function readSnapshot(value: unknown): SceneSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SceneSnapshot>;
  if (candidate.version !== SNAPSHOT_VERSION) return null;
  if (typeof candidate.heroX !== 'number' || !Number.isFinite(candidate.heroX)) return null;
  if (typeof candidate.cameraCentre !== 'number' || !Number.isFinite(candidate.cameraCentre)) return null;
  if (typeof candidate.zoom !== 'number' || !Number.isFinite(candidate.zoom) || candidate.zoom <= 0) return null;
  if (candidate.facing !== 1 && candidate.facing !== -1) return null;
  if (candidate.mode !== 'guided' && candidate.mode !== 'free') return null;
  if (!['morning', 'noon', 'dusk', 'night'].includes(candidate.time as string)) return null;
  if (!candidate.place) return null;
  const record = candidate.marketRecord;
  if (record != null && (record.outcome !== 'bought' && record.outcome !== 'left')) return null;
  return candidate as SceneSnapshot;
}

/**
 * The state the restored painting must start in: walker standing still, no
 * held keys, no audio. A snapshot restores POSITION, never an activity.
 */
export function restingInput(): { walking: 0 } {
  return { walking: 0 };
}
