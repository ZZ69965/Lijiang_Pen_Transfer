/**
 * Footline data for the native 2172×724 painting.
 *
 * These heights are AUTHORING MARKS measured by eye against the painted
 * shoreline, bridge deck and bank. They are not surveyed terrain and they are
 * not collision geometry. `review` records whether a segment has been checked
 * against the artwork, so unfinished parts stay visibly unfinished instead of
 * silently pretending to be accurate.
 *
 * Still missing for a finished foreground (see docs/ASSETS.md):
 *  - an independent transparent railing/foreground layer with alpha, aligned to
 *    the same world coordinates, so the walker can pass BEHIND the bridge rail;
 *  - walkable-area masks marking bank/deck/forbidden water on each time of day.
 */
export type FootlineReview = 'checked' | 'pending';

export type FootlinePoint = {
  x: number;
  y: number;
  /** checked = compared against the painted shoreline; pending = still unverified */
  review: FootlineReview;
  /** true while the foreground railing would normally occlude the walker */
  foreground?: boolean;
};

/**
 * Bridge span around 阳桥 (world X ≈ 1326). The deck rises to y ≈ 372 at the
 * crown; the rail crossing has NOT yet been verified against a foreground
 * layer, so this span stays `pending` and is flagged for a foreground mask.
 */
export const WALKWAY: readonly FootlinePoint[] = [
  { x: 70, y: 460, review: 'checked' },
  { x: 265, y: 463, review: 'checked' },
  { x: 485, y: 465, review: 'checked' },
  { x: 760, y: 466, review: 'checked' },
  { x: 1020, y: 464, review: 'checked' },
  { x: 1100, y: 456, review: 'pending', foreground: true },
  { x: 1222, y: 400, review: 'pending', foreground: true },
  { x: 1360, y: 372, review: 'pending', foreground: true },
  { x: 1510, y: 414, review: 'pending', foreground: true },
  { x: 1596, y: 458, review: 'pending', foreground: true },
  { x: 1750, y: 460, review: 'checked' },
  { x: 1900, y: 459, review: 'checked' },
  { x: 2104, y: 460, review: 'checked' },
];

/**
 * Figure scale — ONE uniform world-pixels-per-image-pixel factor for every pose.
 *
 * The five poses are drawings of the same character at the same pixel scale, so
 * they must be scaled identically. Scaling each pose to a fixed *world height*
 * would do the opposite: `hero-walk.webp` is a wide stride (texture 809×1413
 * vs the standing 523×1536), so forcing it to the same height enlarged that
 * figure by ~9% and the pose visibly "grew" the moment walking began.
 *
 * With a uniform factor the body keeps a constant size, and only the bounding
 * box height changes because a stride is shorter than standing — as drawn.
 */
export const HERO_REFERENCE_PIXEL_HEIGHT = 1536; // native height of hero-front.webp
export const HERO_HEIGHT = 116; // world height of that standing reference pose
export const HERO_SCALE = HERO_HEIGHT / HERO_REFERENCE_PIXEL_HEIGHT;

/** Keep the walker inside the painted river bank. */
export const HERO_MIN_X = 55;
export const HERO_MAX_X = 2104;

function segmentAt(x: number): { a: FootlinePoint; b: FootlinePoint } | null {
  for (let i = 1; i < WALKWAY.length; i += 1) {
    const a = WALKWAY[i - 1];
    const b = WALKWAY[i];
    if (x <= b.x) return { a, b };
  }
  return null;
}

/** Smoothly interpolated footline height at a world X. */
export function walkwayY(x: number): number {
  const first = WALKWAY[0];
  if (x <= first.x) return first.y;
  const segment = segmentAt(x);
  if (!segment) return WALKWAY[WALKWAY.length - 1].y;
  const { a, b } = segment;
  const t = (x - a.x) / (b.x - a.x);
  const eased = t * t * (3 - 2 * t);
  return a.y + (b.y - a.y) * eased;
}

/** Review state for the segment containing x; used by docs, tests and QA badges. */
export function footlineReviewAt(x: number): { review: FootlineReview; foreground: boolean } {
  if (x <= WALKWAY[0].x) {
    return { review: WALKWAY[0].review, foreground: Boolean(WALKWAY[0].foreground) };
  }
  const segment = segmentAt(x);
  if (!segment) {
    const last = WALKWAY[WALKWAY.length - 1];
    return { review: last.review, foreground: Boolean(last.foreground) };
  }
  const pending = segment.a.review === 'pending' || segment.b.review === 'pending';
  return {
    review: pending ? 'pending' : 'checked',
    foreground: Boolean(segment.a.foreground || segment.b.foreground),
  };
}

export function clampHeroX(x: number): number {
  return Math.max(HERO_MIN_X, Math.min(HERO_MAX_X, x));
}
