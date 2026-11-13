/**
 * Asset planning for first entry into the painting.
 *
 * Rule (see 漓江下一步开发计划 §四.1): before the painting becomes usable we
 * only wait for the CURRENT time-of-day artwork and the poses this time slot
 * can actually show. Everything else loads in the background afterwards.
 *
 * Morning and noon share the same day painting, so switching between them never
 * downloads the same URL twice. A missing optional asset must never fail the
 * painting that is already on screen.
 */
import { TIMES, artworkForTime, type ArtworkVariant, type TimeOfDay } from './places.ts';

export type Pose = 'front' | 'side' | 'back' | 'walk' | 'song';
export type AssetKind = 'scene' | 'pose';

export type PlannedAsset = {
  /** Stable id: `scene:day` / `pose:front`. Doubles as the texture cache key. */
  key: string;
  kind: AssetKind;
  file: string;
  /** current artwork / needed pose = required; the rest = optional/deferred. */
  required: boolean;
  /** Which artwork variant or pose this is. */
  id: ArtworkVariant | Pose;
};

export const POSES: readonly Pose[] = ['front', 'side', 'back', 'walk', 'song'];
export const SCENES: readonly ArtworkVariant[] = ['day', 'dusk', 'night'];

/** Every scene and pose the engine knows how to display. */
export const ALL_ASSETS: readonly PlannedAsset[] = [
  ...SCENES.map((scene): PlannedAsset => ({
    key: `scene:${scene}`, kind: 'scene', file: `scene-${scene}.webp`, required: false, id: scene,
  })),
  ...POSES.map((pose): PlannedAsset => ({
    key: `pose:${pose}`, kind: 'pose', file: `hero-${pose}.webp`, required: false, id: pose,
  })),
];

export function assetKey(kind: AssetKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * The critical set for a time slot.
 *
 * - The current artwork is always required.
 * - Poses required up front are deliberately minimal: standing/idle uses
 *   `front`, and the very next interaction (walking) uses `walk`. `side`,
 *   `back` and `song` arrive in the background and fall back to what is loaded.
 */
export function criticalPosesFor(time: TimeOfDay): readonly Pose[] {
  const base: Pose[] = ['front', 'walk'];
  return time === 'night' ? [...base, 'song'] : base;
}

/** Optional-but-priority assets: the other two time-of-day paintings. */
export function otherSceneVariants(time: TimeOfDay): readonly ArtworkVariant[] {
  const current = artworkForTime(time);
  return SCENES.filter((scene) => scene !== current);
}

/** Which time slots reuse the cached texture of a scene variant. */
export function timesUsingScene(scene: ArtworkVariant): readonly TimeOfDay[] {
  return TIMES.filter((item) => artworkForTime(item.id) === scene).map((item) => item.id);
}

/** Does the currently painted artwork already satisfy the requested times? */
export function sceneIsReady(readyScenes: readonly ArtworkVariant[], time: TimeOfDay): boolean {
  return readyScenes.includes(artworkForTime(time));
}

/** Human label used by the UI status line ("白昼/夕照/夜景"). */
export const SCENE_LABEL: Record<ArtworkVariant, string> = {
  day: '白昼', dusk: '夕照', night: '夜景',
};

/**
 * Build the loading plan for a time slot.
 *
 * `required` entries must succeed before `onReady`. All other entries are
 * prefetched sequentially and their failures are recorded, never thrown.
 */
export function planAssets(time: TimeOfDay): { critical: PlannedAsset[]; deferred: PlannedAsset[] } {
  const current = artworkForTime(time);
  const mustPoses = criticalPosesFor(time);
  const critical = ALL_ASSETS.filter((asset) =>
    (asset.kind === 'scene' && asset.id === current) ||
    (asset.kind === 'pose' && mustPoses.includes(asset.id as Pose)),
  ).map((asset) => ({ ...asset, required: true }));

  const deferred = ALL_ASSETS.filter((asset) => !critical.some((item) => item.key === asset.key))
    .map((asset) => ({ ...asset, required: false }));
  // Background order: other paintings first (they are what time switching needs),
  // then the remaining poses.
  deferred.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'scene' ? -1 : 1));

  return { critical, deferred };
}

/**
 * Resolve a pose request to a texture that is actually available, so a
 * not-yet-loaded (or failed) pose degrades to a sensible neighbour instead of
 * leaving the walker texture-less.
 */
export function resolvePose(preferred: Pose, available: Iterable<Pose>): Pose {
  const have = new Set(available);
  if (have.has(preferred)) return preferred;
  const fallbacks: Record<Pose, readonly Pose[]> = {
    front: ['side', 'back', 'walk'],
    side: ['front', 'back', 'walk'],
    back: ['side', 'front', 'walk'],
    walk: ['side', 'front', 'back'],
    song: ['front', 'side', 'back'],
  };
  return fallbacks[preferred].find((pose) => have.has(pose)) ?? preferred;
}
