/**
 * Grounding data for the native 2172×724 painting.
 *
 * IMPORTANT — how these numbers were produced (2026-11-13 R2):
 * the previous footline was an eyeball guess that ran straight through open
 * water: the walker stood in front of 象鼻山, which in the painting is an
 * isolated rock ISLAND with no bank at all, and `walkwayY()` gave a constant
 * y≈460 across the whole scroll. That produced the floating figure.
 *
 * Every point below was re-measured against `scene-day.webp` on a 2× grid
 * overlay, by locating the actual painted stone platform edge:
 *
 *   象鼻山 island   x ≈ 30–490    platform edge y ≈ 520–530   (island only)
 *   left bank       x ≈ 490–1150  stone revetment   y ≈ 512→505
 *   阳桥 deck       x ≈ 1150–1520 railing crown      y ≈ 400
 *      (a parapet stands in FRONT of anyone walking the deck → foreground)
 *   鱼市 / 江岸     x ≈ 1520–2100 stone platform    y ≈ 497
 *   玻璃桥          not walkable — it spans open water
 *
 * This is authoring data, not surveyed terrain. `review` keeps the honest
 * distinction between measured (`checked`) and still unverified segments.
 *
 * Still missing (see docs/FOREGROUND_SPEC.md):
 *  - an independent transparent railing layer with alpha so a walker can pass
 *    BEHIND the 阳桥 parapet;
 *  - a walkable-area mask per time of day.
 */
export type FootlineReview = 'checked' | 'pending';

export type FootlinePoint = {
  x: number;
  y: number;
  /** checked = measured against the painted stone edge; pending = still unverified */
  review: FootlineReview;
  /** true while a painted parapet would normally occlude the walker */
  foreground?: boolean;
};

/**
 * Walkable ground runs from the left bank, up the bridge and down onto the
 * right-bank platform. The island (象鼻山) and the glass bridge span are NOT
 * part of it: there is no painted land there to stand on.
 */
export const WALKWAY: readonly FootlinePoint[] = [
  { x: 505, y: 514, review: 'checked' },
  { x: 700, y: 511, review: 'checked' },
  { x: 900, y: 508, review: 'checked' },
  { x: 1060, y: 505, review: 'checked' },
  { x: 1150, y: 496, review: 'checked' },
  // Bridge ascent: the painted parapet stands in front of the deck walker.
  { x: 1230, y: 462, review: 'pending', foreground: true },
  { x: 1300, y: 412, review: 'pending', foreground: true },
  { x: 1340, y: 400, review: 'pending', foreground: true },
  { x: 1420, y: 412, review: 'pending', foreground: true },
  { x: 1500, y: 462, review: 'pending', foreground: true },
  { x: 1560, y: 494, review: 'checked' },
  { x: 1700, y: 497, review: 'checked' },
  { x: 1850, y: 497, review: 'checked' },
  { x: 2050, y: 494, review: 'checked' },
];

/** Land the walker can actually stand on, as world-X ranges. */
export const WALKABLE_SPANS: readonly { from: number; to: number }[] = [
  { from: 505, to: 1150 }, // left bank
  { from: 1150, to: 1560 }, // bridge
  { from: 1560, to: 2050 }, // right-bank stone platform
];

/** The walker must stay on painted land; open water and rock are excluded. */
export const HERO_MIN_X = 505;
export const HERO_MAX_X = 2050;

/**
 * Figure scale — ONE uniform world-pixels-per-image-pixel factor for every pose.
 *
 * The five poses are drawings of the same character at the same pixel scale, so
 * they must be scaled identically. Scaling each pose to a fixed *world height*
 * would do the opposite: `hero-walk.webp` is a wide stride (texture 809×1413
 * vs the standing 523×1536), so forcing it to the same height enlarged that
 * figure by ~9% and the pose visibly "grew" the moment walking began.
 */
export const HERO_REFERENCE_PIXEL_HEIGHT = 1536; // native height of hero-front.webp

/**
 * 2026-11-13 R2: reduced from 116 to 96 world pixels.
 *
 * Calibration reference: the painted stone revetment along the left bank is
 * roughly 34 world pixels tall; a human parapet is about hip height, so a full
 * standing figure belongs near 2.8× that — ≈ 96 px. The previous 116 made the
 * walker read as a giant standing among the pavilions. Re-measure against the
 * 亭门 columns if a future art pass changes the architecture scale.
 */
export const HERO_HEIGHT = 96;
export const HERO_SCALE = HERO_HEIGHT / HERO_REFERENCE_PIXEL_HEIGHT;

function segmentAt(x: number): { a: FootlinePoint; b: FootlinePoint } | null {
  for (let i = 1; i < WALKWAY.length; i += 1) {
    const a = WALKWAY[i - 1];
    const b = WALKWAY[i];
    if (x <= b.x) return { a, b };
  }
  return null;
}

/** Smoothly interpolated ground height at a world X. */
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

export function isWalkable(x: number): boolean {
  return WALKABLE_SPANS.some((span) => x >= span.from && x <= span.to);
}

/** Snap any world X onto the nearest painted land. */
export function clampHeroX(x: number): number {
  if (isWalkable(x)) return x;
  let best = HERO_MIN_X;
  let bestGap = Infinity;
  for (const span of WALKABLE_SPANS) {
    for (const edge of [span.from, span.to]) {
      const gap = Math.abs(edge - x);
      if (gap < bestGap) { bestGap = gap; best = edge; }
    }
  }
  return Math.max(HERO_MIN_X, Math.min(HERO_MAX_X, best));
}
