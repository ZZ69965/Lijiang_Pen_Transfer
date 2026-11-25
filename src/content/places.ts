export type PlaceId = 'elephant' | 'towers' | 'yangbridge' | 'glassbridge';
export type TimeOfDay = 'morning' | 'noon' | 'dusk' | 'night';
export type ArtworkVariant = 'day' | 'dusk' | 'night';
export type VisitMode = 'guided' | 'free';

export type Place = {
  id: PlaceId;
  name: string;
  number: string;
  /**
   * CAMERA FRAMING point — the painted subject the viewport should centre on
   * (an arch mouth, a pair of pagodas). It is NOT a place to stand: 象鼻山 is
   * an island surrounded by water, so framing it used to drag the walker into
   * the river. Standing positions live in `standX` and in `content/walkway.ts`.
   */
  worldX: number;
  markerY: number;
  /**
   * Where the walker actually stands when you visit this place: a point on
   * painted ground (`WALKWAY`). The figure looks across the water at the
   * subject rather than standing inside it.
   */
  standX: number;
  /**
   * Framing zoom for this subject (1 = the fit-to-viewport scale). A tighter
   * value gives the arch room to breathe; a wider one keeps both pagodas in
   * frame. Clamped to the engine's per-viewport zoom bounds at runtime.
   */
  zoom: number;
  /** Waterline used by the local ambient motion (shimmer sits just above it). */
  waterY: number;
  eyebrow: string;
  description: string;
  hint: string;
};

// All coordinates follow the actual 2172 x 724 panoramic image, NOT CSS pixels.
// This is an artistic sequence; it is not a geographically accurate walking itinerary.
export const WORLD_WIDTH = 2172;
export const WORLD_HEIGHT = 724;

export const PLACES: readonly Place[] = [
  {
    // The arch and its reflection are the subject; the walker watches from the
    // left bank, since the hill itself is an island in the river.
    id: 'elephant', number: '壹', name: '象鼻山', worldX: 172, markerY: 446, standX: 604, zoom: 1.16, waterY: 526,
    eyebrow: '山水开卷',
    description: '山石临江，天光入水。象鼻山的轮廓，正是这幅画卷的第一笔。',
    hint: '从此处出发，沿着画中的岸线缓缓前行。',
  },
  {
    id: 'towers', number: '贰', name: '日月双塔', worldX: 900, markerY: 448, standX: 940, zoom: 1.0, waterY: 520,
    eyebrow: '塔影入波',
    description: '一金一银，两座塔在青山与江色间相望；傍晚余晖和夜间灯火各有风致。',
    hint: '试试在白昼、夕照、入夜之间切换画面。',
  },
  {
    // Standing mid-arch is the point here: the deck is real painted ground.
    id: 'yangbridge', number: '叁', name: '阳桥', worldX: 1340, markerY: 381, standX: 1390, zoom: 1.02, waterY: 505,
    eyebrow: '一桥横波',
    description: '石桥起伏，栏杆临水。穿桥而过的清风，把两岸人间连成一卷。',
    hint: '可拖动画面仔细观看桥拱和水中倒影。',
  },
  {
    // The glass span crosses open water; the walker stays on the bank beside it.
    id: 'glassbridge', number: '肆', name: '玻璃桥', worldX: 1948, markerY: 443, standX: 1760, zoom: 1.06, waterY: 518,
    eyebrow: '听风对歌',
    description: '水边亭廊，灯影摇曳。旅人驻足，向远处青山轻唱一声。',
    hint: '体验“对山歌”姿态演示；音频留待正式授权素材。',
  },
] as const;

export function getPlace(id: PlaceId): Place {
  return PLACES.find((p) => p.id === id) ?? PLACES[0];
}

/**
 * Four experience periods use THREE completed original paintings.
 * Morning/noon deliberately share the original daylight work:
 * never tint, downscale, or claim a nonexistent independent noon painting.
 */
export const TIMES: readonly { id: TimeOfDay; label: string; caption: string; image: string }[] = [
  { id: 'morning', label: '清晨', caption: '江岸问路 · 竹筏待发', image: 'scene-day.webp' },
  { id: 'noon', label: '正午', caption: '鸬鹚捕鱼 · 岸边鱼市', image: 'scene-day.webp' },
  { id: 'dusk', label: '夕照', caption: '金波映山 · 静赏画卷', image: 'scene-dusk.webp' },
  { id: 'night', label: '入夜', caption: '水影山歌 · 江上灯火', image: 'scene-night.webp' },
];

export function artworkForTime(time: TimeOfDay): ArtworkVariant {
  return time === 'morning' || time === 'noon' ? 'day' : time;
}
