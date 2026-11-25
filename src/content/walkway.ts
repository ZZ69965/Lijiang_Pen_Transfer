type WalkwayPoint = { x: number; y: number; height: number };

export const HERO_MIN_HEIGHT = 32;
export const HERO_MAX_HEIGHT = 46;
export const HERO_REFERENCE_PIXEL_HEIGHT = 1536; // native height of hero-front.webp

/**
 * Foot positions in the 2172×724 paintings. Height varies with painted depth:
 * compare the standing figure with nearby posts, doors and promenade rails.
 */
export const WALKWAY: readonly WalkwayPoint[] = [
  // Upper landing and west bank. The path continues behind the planted strip.
  { x: 510, y: 480, height: 41 },
  { x: 548, y: 476, height: 41 },
  { x: 620, y: 476, height: 39 },
  { x: 710, y: 476, height: 35 },
  { x: 767, y: 467, height: 34 },
  { x: 842, y: 466, height: 33 },
  { x: 900, y: 470, height: 34 },
  { x: 944, y: 477, height: 35 },
  { x: 974, y: 477, height: 35 },
  { x: 1028, y: 470, height: 37 },
  { x: 1082, y: 473, height: 39 },
  // Follow the deck course up both approaches and over the crown of 阳桥.
  { x: 1115, y: 475, height: 40 },
  { x: 1142, y: 466, height: 41 },
  { x: 1170, y: 452, height: 43 },
  { x: 1201, y: 438, height: 44 },
  { x: 1242, y: 424, height: 45 },
  { x: 1300, y: 413, height: 46 },
  { x: 1385, y: 411, height: 46 },
  { x: 1460, y: 413, height: 46 },
  { x: 1534, y: 420, height: 45 },
  { x: 1594, y: 428, height: 44 },
  { x: 1630, y: 440, height: 43 },
  { x: 1660, y: 452, height: 41 },
  { x: 1690, y: 465, height: 39 },
  // The route ends on the terrace west of the glass bridge.
  { x: 1720, y: 474, height: 37 },
  { x: 1755, y: 475, height: 35 },
  { x: 1798, y: 475, height: 32 },
];

export const HERO_MIN_X = WALKWAY[0].x;
export const HERO_MAX_X = WALKWAY[WALKWAY.length - 1].x;

export function isWalkable(x: number): boolean {
  return x >= HERO_MIN_X && x <= HERO_MAX_X;
}

/** Clamp both continuous movement and old snapshots to the connected path. */
export function clampHeroX(x: number): number {
  return Number.isNaN(x) ? HERO_MIN_X : Math.max(HERO_MIN_X, Math.min(HERO_MAX_X, x));
}

export function walkwayAt(x: number): WalkwayPoint {
  const position = clampHeroX(x);
  const next = WALKWAY.findIndex((point) => point.x >= position);
  if (next <= 0) return WALKWAY[0];
  const a = WALKWAY[next - 1];
  const b = WALKWAY[next];
  const t = (position - a.x) / (b.x - a.x);
  const ease = t * t * (3 - 2 * t);
  return {
    x: position,
    y: a.y + (b.y - a.y) * t,
    height: a.height + (b.height - a.height) * ease,
  };
}
