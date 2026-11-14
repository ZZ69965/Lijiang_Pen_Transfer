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
 *   象鼻山 island   x ≈ 30–490    rock, no bank — NOT walkable
 *   left bank       x ≈ 500–1150  stone coping edge y ≈ 503–508
 *      (balustrade crown at y≈478; the walker's feet belong on the stone edge,
 *       not down in the water below it)
 *   阳桥 deck       x ≈ 1150–1520 railing crown     y ≈ 400
 *      (a parapet stands in FRONT of anyone walking the deck → foreground)
 *   江岸 / 鱼市     x ≈ 1560–2100 stone coping      y ≈ 508
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
  { x: 505, y: 506, review: 'checked' },
  { x: 700, y: 505, review: 'checked' },
  { x: 900, y: 505, review: 'checked' },
  { x: 1050, y: 504, review: 'checked' },
  { x: 1200, y: 462, review: 'checked' },
  // 阳桥 deck: measured off a 4x grid crop. The walkable deck line (the stone
  // course the balustrade stands on) runs y~425 at the left base, crowns at
  // y~400 near x=1340 and returns to y~425 by x=1450. The arch springing and
  // the piers below are NOT ground — walking there put the figure in the river.
  { x: 1240, y: 427, review: 'pending', foreground: true },
  { x: 1290, y: 409, review: 'pending', foreground: true },
  { x: 1340, y: 400, review: 'pending', foreground: true },
  { x: 1390, y: 409, review: 'pending', foreground: true },
  { x: 1450, y: 427, review: 'pending', foreground: true },
  { x: 1500, y: 470, review: 'checked' },
  { x: 1560, y: 500, review: 'checked' },
  { x: 1700, y: 508, review: 'checked' },
  { x: 1850, y: 508, review: 'checked' },
  { x: 2050, y: 506, review: 'checked' },
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

/**
 * 阳桥 parapet overlay, measured off `scene-day.webp` on a 3x grid crop:
 * the railing band (finials, posts, balusters, deck course) occupies
 * x 1130-1590, y 368-434 — the bottom edge covers the stone course the
 * walker's feet rest on, so feet are hidden behind the rail as they should be.
 * The artwork itself is untouched — this is a separate transparent PNG cut from
 * the same pixels, drawn ABOVE the walker so the deck reads as "behind the rail".
 */
export const YANG_BRIDGE_PARAPET = { x: 1130, y: 368, width: 460, height: 66 } as const;

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
