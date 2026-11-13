/**
 * Camera/view maths for the painted scroll, kept pure so resize and rotation
 * behaviour can be unit-tested without a browser.
 *
 * The painting is ALWAYS shown at native 2172×724 aspect. Zoom only ever
 * scales uniformly; nothing here stretches, crops or downsamples the artwork.
 */
import { WORLD_HEIGHT, WORLD_WIDTH } from './places.ts';

export type ViewSize = { width: number; height: number };

export type Camera = {
  /** Left edge of the visible window in world pixels. */
  left: number;
  /** Uniform zoom; 1 world pixel is `zoom` CSS pixels. */
  zoom: number;
};

/** Base "fit the whole painting height" zoom for a viewport. */
export function fitZoom(view: ViewSize): number {
  return Math.max(0.42, view.height / WORLD_HEIGHT);
}

export function zoomBounds(view: ViewSize): { minimum: number; maximum: number } {
  const fit = fitZoom(view);
  return { minimum: fit * 0.72, maximum: fit * 1.65 };
}

export function clampZoom(zoom: number, view: ViewSize): number {
  const { minimum, maximum } = zoomBounds(view);
  return Math.max(minimum, Math.min(maximum, zoom));
}

/** Keep the window inside the painting; when the view is wider, centre it. */
export function clampLeft(left: number, zoom: number, view: ViewSize): number {
  const visibleWidth = view.width / zoom;
  const maxLeft = WORLD_WIDTH - visibleWidth;
  if (maxLeft < 0) return maxLeft / 2;
  return Math.min(maxLeft, Math.max(0, left));
}

/** World X at the centre of the viewport. This is what a snapshot stores. */
export function centreOf(camera: Camera, view: ViewSize): number {
  return camera.left + view.width / (2 * camera.zoom);
}

export function cameraAround(centre: number, zoom: number, view: ViewSize): Camera {
  return { left: clampLeft(centre - view.width / (2 * zoom), zoom, view), zoom };
}

/**
 * Recompute the camera for a NEW viewport while preserving the world centre.
 *
 * Used on resize/orientation change. When the user is at the default zoom we
 * re-fit to the new height (so rotating a phone shows the same composition),
 * otherwise the zoom chosen by the user is kept and only clamped.
 */
export function resizeCamera(
  camera: Camera,
  previous: ViewSize,
  next: ViewSize,
  options: { followDefault?: boolean } = {},
): Camera {
  const centre = centreOf(camera, previous);
  const wasDefault = Math.abs(camera.zoom - fitZoom(previous)) < 1e-3;
  const zoom = options.followDefault === false || !wasDefault
    ? clampZoom(camera.zoom, next)
    : clampZoom(fitZoom(next), next);
  return cameraAround(centre, zoom, next);
}

/**
 * Decide whether a pointer gesture should count as a drag.
 * Navigation buttons and story hotspots must not fire after the visitor panned
 * the painting, and a tap must still create a ripple.
 */
export function isDrag(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 6,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
