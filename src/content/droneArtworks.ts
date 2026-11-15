/** User-supplied transparent paintings, not a recording or a flight simulation. */
export const DRONE_ARTWORKS = [
  {
    id: 'elephant',
    title: '象山渔舟',
    file: 'night-drones-elephant.webp',
    source: '6da5ad4f39916ebd4de54d79bfbb2070.png',
    note: '用户供图 · 无人机图案概念展示',
  },
  {
    id: 'festival',
    title: '逐光而行',
    file: 'night-drones-festival.webp',
    source: '3f0f0acbae77827c1786ca0b1b674abf.png',
    note: '主题画稿保留原图活动文字与日期，仅供图案欣赏。',
  },
] as const;

export type DroneArtworkId = typeof DRONE_ARTWORKS[number]['id'];
export type DroneArtworkStatus = {
  id: DroneArtworkId | null;
  state: 'idle' | 'loading' | 'ready' | 'error';
};

export function getDroneArtwork(id: DroneArtworkId) {
  return DRONE_ARTWORKS.find((artwork) => artwork.id === id) ?? DRONE_ARTWORKS[0];
}

/** Fit the original 16:9 texture above the river, including short viewports. */
export function droneArtworkFrame(width: number, height: number, zoom: number, worldY: number) {
  const scale = Math.max(0.01, zoom);
  const availableHeight = Math.max(40, height - 250) / scale;
  const artworkWidth = Math.min(560, width / scale * 0.84, availableHeight * 16 / 9);
  return {
    x: 1837 - artworkWidth / 2,
    y: Math.max(24, (76 - worldY) / scale),
    width: artworkWidth,
    height: artworkWidth * 9 / 16,
  };
}
