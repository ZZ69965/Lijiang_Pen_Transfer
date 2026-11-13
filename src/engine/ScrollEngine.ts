import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ENCOUNTERS, type EncounterId } from '../content/encounters';
import { NightEffects, type NightControls } from './NightEffects';
import type { NightMusic } from './NightMusic';
import {
  PLACES, WORLD_HEIGHT, WORLD_WIDTH, artworkForTime,
  type ArtworkVariant, type Place, type PlaceId, type TimeOfDay, type VisitMode,
} from '../content/places';
import {
  ALL_ASSETS, assetKey, planAssets, resolvePose, type Pose, type PlannedAsset,
} from '../content/assets';
import {
  HERO_HEIGHT, HERO_SCALE, clampHeroX, footlineReviewAt, walkwayY,
} from '../content/walkway';
import {
  cameraAround, centreOf, clampZoom, fitZoom, isDrag, resizeCamera, zoomBounds,
  type ViewSize,
} from '../content/viewport';
import type { SceneSnapshot } from '../content/snapshot';

export type LoadStatus = {
  /** The painting this time slot needs. */
  currentScene: ArtworkVariant;
  currentSceneReady: boolean;
  /** Human labels of assets still arriving in the background. */
  loading: string[];
  /** Human labels of optional assets that failed; the painting stays usable. */
  failed: string[];
};

type EngineCallbacks = {
  onReady: () => void;
  onPlace: (place: PlaceId) => void;
  onPosition: (progress: number) => void;
  onError: (message: string) => void;
  onEncounter: (id: EncounterId) => void;
  onLoadStatus?: (status: LoadStatus) => void;
};

type Point = { x: number; y: number };

type Ripple = { x: number; y: number; age: number };

const art = (file: string) => `${import.meta.env.BASE_URL}art/${file}`;
const WALK_SPEED = 185; // world pixels per second at native artwork resolution
const MAX_FRAME_TIME = 0.05;
/** Pointer movement (CSS px) above which a gesture is a pan, not a tap. */
const DRAG_THRESHOLD = 6;
/** Idle radius (world px) inside which the walker turns to face a landmark. */
const LANDMARK_NOTICE = 90;

/**
 * PixiJS world owner. Shows the ORIGINAL 2172×724 lossless paintings at native
 * resolution: no downsampling, no stretching, no tint standing in for a fourth
 * painting.
 *
 * Loading policy: the current time-of-day painting plus the two poses the
 * visitor can immediately use gate `onReady`. Every other painting and pose
 * streams in afterwards; a late or failed optional asset never fails the
 * painting that is already on screen.
 */
export class ScrollEngine {
  private app = new Application();
  private world = new Container();
  private readonly host: HTMLDivElement;
  private readonly callbacks: EngineCallbacks;

  private readonly textures = new Map<string, Texture>();
  private readonly readyScenes = new Set<ArtworkVariant>();
  private readonly readyPoses = new Set<Pose>();
  private readonly loadingKeys = new Set<string>();
  private readonly failedLabels = new Set<string>();
  private readonly backgrounds = new Map<ArtworkVariant, Sprite>();

  private readonly markers = new Container();
  private readonly encounterMarkers = new Map<EncounterId, Container>();
  private readonly encounterSprites = new Map<EncounterId, Sprite>();
  private readonly encounterLayer = new Container();
  private readonly nightEffects = new NightEffects();
  private music: NightMusic | null = null;
  private readonly ripplesLayer = new Graphics();
  private readonly activePointers = new Map<number, Point>();
  private ripples: Ripple[] = [];
  private hero: Sprite | null = null;
  private ready = false;
  private disposed = false;
  private reducedMotion = false;
  private visible = true;
  private mode: VisitMode = 'guided';
  /**
   * Free mode is "pure viewing": the painting alone, no walker. Guided mode
   * ("人物随行") shows the figure and the walking controls.
   */
  private walkerVisible = true;
  /** Subject the ambient water shimmer currently belongs to. */
  private ambientPlace: Place | null = null;
  private readonly ambientLayer = new Graphics();
  private zoomInitial = 1;
  private contactShadow: Sprite | null = null;
  private time: TimeOfDay = 'morning';
  private nightControls: NightControls = { view: 'shore', lights: false, rhythm: false, music: false, drones: false };
  private heroX = 260;
  private facing: 1 | -1 = 1;
  private walkDirection = 0;
  private destination: number | null = null;
  private cameraLeft = 0;
  private cameraTarget: number | null = null;
  private zoom = 1;
  private zoomMinimum = 0.5;
  private zoomMaximum = 2;
  private pinchLength = 0;
  private dragged = false;
  private dragStart: Point | null = null;
  /** Set while panning so story hotspots do not fire at the end of a drag. */
  private suppressTap = false;
  /** True while a dialogue/help/overlay owns the input. */
  private locked = false;
  private elapsed = 0;
  private pose: Pose = 'front';
  private action: 'gaze' | 'song' | null = null;
  private actionSeconds = 0;
  private lastProgress = -1;
  private viewSize: ViewSize;

  constructor(host: HTMLDivElement, callbacks: EngineCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.viewSize = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
  }

  // ---------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    try {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      await this.app.init({
        background: '#dac69e',
        antialias: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
        resizeTo: this.host,
      });
      if (this.disposed) { this.app.destroy(true); return; }
      this.app.canvas.className = 'scroll-canvas';
      this.app.canvas.setAttribute('role', 'img');
      this.app.canvas.setAttribute('aria-label', '漓江全景画卷，可拖动或缩放');
      this.host.appendChild(this.app.canvas);
      this.viewSize = { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 };
      this.installEvents();

      // Phase 1 — only what this time slot needs. If the CURRENT painting
      // cannot load there is nothing to look at, so that alone is fatal.
      const plan = planAssets(this.time);
      const sceneAsset = plan.critical.find((asset) => asset.kind === 'scene');
      if (!sceneAsset) throw new Error('No painting planned for this time slot');
      await this.loadAsset(sceneAsset, true);
      if (this.disposed) return;
      // Required poses are best-effort: a missing pose degrades the figure, not the painting.
      await Promise.all(plan.critical
        .filter((asset) => asset.kind === 'pose')
        .map((asset) => this.loadAsset(asset, false)));

      this.buildWorld();
      this.ready = true;
      this.fitInitialView();
      this.emitStatus();
      this.callbacks.onReady();

      // Phase 2 — background. Current painting is already usable.
      void this.loadDeferred(plan.deferred);
      // Compact NPC overlays are independent of the paintings.
      void this.loadEncounterSprites();
    } catch (error) {
      console.error('Unable to initialize showcase artwork', error);
      if (!this.disposed) this.callbacks.onError('画卷加载失败：请检查网络，或刷新页面重新加载。');
    }
  }

  /** Load one planned asset. Fatal only when the caller says so. */
  private async loadAsset(asset: PlannedAsset, fatal: boolean): Promise<void> {
    if (this.textures.has(asset.key) || this.loadingKeys.has(asset.key)) return;
    this.loadingKeys.add(asset.key);
    try {
      const texture = await Assets.load<Texture>(art(asset.file));
      if (this.disposed) return;
      this.textures.set(asset.key, texture);
      if (asset.kind === 'scene') {
        this.readyScenes.add(asset.id as ArtworkVariant);
        this.attachBackground(asset.id as ArtworkVariant, texture);
      } else {
        this.readyPoses.add(asset.id as Pose);
      }
      this.failedLabels.delete(assetLabel(asset));
    } catch (error) {
      // Optional art must never break the painting that is already showing.
      console.warn(`Optional artwork unavailable: ${asset.file}`, error);
      this.failedLabels.add(assetLabel(asset));
      if (fatal) throw error;
    } finally {
      this.loadingKeys.delete(asset.key);
      this.emitStatus();
    }
  }

  /** Sequential background prefetch so the current painting keeps the bandwidth. */
  private async loadDeferred(assets: readonly PlannedAsset[]): Promise<void> {
    for (const asset of assets) {
      if (this.disposed) return;
      await this.loadAsset(asset, false);
    }
  }

  private attachBackground(variant: ArtworkVariant, texture: Texture): void {
    if (this.backgrounds.has(variant)) return;
    const sprite = new Sprite(texture);
    sprite.width = WORLD_WIDTH;
    sprite.height = WORLD_HEIGHT;
    sprite.alpha = variant === artworkForTime(this.time) ? 1 : 0;
    this.backgrounds.set(variant, sprite);
    // Paintings sit at the very bottom of the world.
    this.world.addChildAt(sprite, 0);
  }

  private buildWorld(): void {
    this.addMarkers();
    this.addEncounterMarkers();
    this.world.addChild(this.nightEffects.graphics);
    this.world.addChild(this.ambientLayer);
    this.world.addChild(this.markers);
    this.world.addChild(this.encounterLayer);
    this.updateEncounterVisibility();

    const heroTexture = this.textures.get(assetKey('pose', this.pose)) ??
      this.textures.get(assetKey('pose', 'front'));
    if (heroTexture) {
      this.hero = new Sprite(heroTexture);
      this.hero.anchor.set(0.5, 1);
      this.setHeroTexture(this.pose, true);
      this.hero.position.set(this.heroX, walkwayY(this.heroX));
      this.world.addChild(this.hero);
      // A restrained contact shadow is the only cue that the figure is standing
      // ON the platform rather than floating in front of it.
      this.contactShadow = new Sprite(Texture.WHITE);
      this.contactShadow.anchor.set(0.5, 0.5);
      this.contactShadow.tint = 0x2f3a2e;
      this.contactShadow.alpha = 0.22;
      this.contactShadow.width = HERO_HEIGHT * 0.42;
      this.contactShadow.height = HERO_HEIGHT * 0.06;
      this.world.addChildAt(this.contactShadow, this.world.getChildIndex(this.hero));
    } else {
      console.warn('No hero pose available yet; painting remains usable.');
    }
    this.world.addChild(this.ripplesLayer);
    this.app.stage.addChild(this.world);
    this.app.ticker.add(this.tick);
  }

  destroy(): void {
    this.disposed = true;
    if (!this.ready) return;
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.app.ticker.remove(this.tick);
    this.nightEffects.clear();
    this.encounterSprites.clear();
    this.backgrounds.clear();
    this.textures.clear();
    this.music = null;
    this.app.destroy(true, { children: true, texture: false, textureSource: false });
    this.ready = false;
  }

  // ------------------------------------------------------------ status / UI

  private emitStatus(): void {
    if (!this.callbacks.onLoadStatus) return;
    const loading = ALL_ASSETS.filter((asset) => this.loadingKeys.has(asset.key)).map(assetLabel);
    this.callbacks.onLoadStatus({
      currentScene: artworkForTime(this.time),
      currentSceneReady: this.readyScenes.has(artworkForTime(this.time)),
      loading,
      failed: [...this.failedLabels],
    });
  }

  // ------------------------------------------------------------------ markers

  private addMarkers(): void {
    for (const place of PLACES) {
      const node = new Container();
      const halo = new Graphics().circle(0, 0, 16)
        .stroke({ color: 0xf5e3b3, width: 1.5, alpha: 0.86 });
      const core = new Graphics().circle(0, 0, 6).fill({ color: 0xe6c58b, alpha: 0.97 })
        .circle(0, 0, 2.5).fill({ color: 0x654d39 });
      node.position.set(place.worldX, place.markerY);
      node.addChild(halo, core);
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => x * x + y * y <= 28 * 28 };
      node.on('pointertap', () => {
        if (this.locked || this.suppressTap) return;
        this.callbacks.onPlace(place.id);
        this.focusPlace(place.id);
      });
      this.markers.addChild(node);
    }
  }

  /**
   * Decorative but genuinely clickable world hotspots. Can later be attached
   * to transparent NPC sprites without changing the dialogue layer.
   */
  private addEncounterMarkers(): void {
    this.encounterLayer.sortableChildren = true;
    for (const encounter of ENCOUNTERS) {
      const marker = new Container();
      const ring = new Graphics().circle(0, 0, 13)
        .stroke({ color: 0xf8e7c1, width: 1.7, alpha: 0.9 });
      const center = new Graphics().circle(0, 0, 5.5)
        .fill({ color: encounter.time === 'night' ? 0xf5b36b : 0x9b8a5c, alpha: 0.94 })
        .circle(0, 0, 2.2).fill({ color: 0xfff6df });
      marker.position.set(encounter.worldX, encounter.worldY);
      marker.zIndex = encounter.worldY;
      marker.addChild(ring, center);
      marker.eventMode = 'static';
      marker.cursor = 'pointer';
      marker.alpha = 0.94;
      marker.hitArea = { contains: (x: number, y: number) => x * x + y * y <= 30 * 30 };
      marker.on('pointerover', () => { marker.alpha = 1; marker.scale.set(1.035); });
      marker.on('pointerout', () => { marker.alpha = 0.94; marker.scale.set(1); });
      marker.on('pointertap', () => {
        // A pan that ends on a hotspot must not open a story.
        if (this.locked || this.suppressTap) return;
        if (encounter.time !== this.time) return;
        this.walkDirection = 0;
        this.destination = null;
        this.callbacks.onPlace(encounter.place);
        this.callbacks.onEncounter(encounter.id);
      });
      this.encounterMarkers.set(encounter.id, marker);
      this.encounterLayer.addChild(marker);
    }
  }

  private async loadEncounterSprites(): Promise<void> {
    // Individual failures leave the accessible marker and story controls in place.
    await Promise.all(ENCOUNTERS.map(async (encounter) => {
      try {
        const texture = await Assets.load<Texture>(art(encounter.spriteFile));
        if (this.disposed || !this.ready) return;
        const marker = this.encounterMarkers.get(encounter.id);
        if (!marker) return;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.width = encounter.spriteWidth;
        sprite.height = encounter.spriteWidth * texture.height / texture.width;
        sprite.eventMode = 'none';
        sprite.alpha = encounter.id === 'night-stage' ? 0.95 : 0.91;
        marker.addChildAt(sprite, 0);
        // Move the discovery pin above the small figure, not over its body.
        const pinY = -sprite.height - 9;
        marker.getChildAt(1).position.y = pinY;
        marker.getChildAt(2).position.y = pinY;
        // Keep a generous invisible touch target even after shrinking the art.
        const hitHalfWidth = Math.max(42, encounter.spriteWidth * 0.72);
        marker.hitArea = {
          contains: (x: number, y: number) =>
            Math.abs(x) < hitHalfWidth &&
            y > -sprite.height - 34 && y < 30,
        };
        this.encounterSprites.set(encounter.id, sprite);
      } catch (error) {
        console.warn(`Optional encounter art unavailable: ${encounter.spriteFile}`, error);
        this.failedLabels.add(`插画 ${encounter.spriteFile}`);
        this.emitStatus();
      }
    }));
  }

  private updateEncounterVisibility(): void {
    for (const encounter of ENCOUNTERS) {
      const marker = this.encounterMarkers.get(encounter.id);
      if (marker) marker.visible = encounter.time === this.time;
    }
  }

  previewEncounter(id: EncounterId): void {
    const encounter = ENCOUNTERS.find((item) => item.id === id);
    if (encounter && encounter.time === this.time) {
      this.ripples.push({ x: encounter.worldX, y: 516, age: 0 });
      this.ripples.push({ x: encounter.worldX + 16, y: 523, age: 0.18 });
    }
  }

  setNightControls(next: NightControls): void {
    const viewChanged = this.nightControls.view !== next.view;
    this.nightControls = next;
    if (this.time === 'night' && viewChanged) {
      // Reframe the painted river around the boat; the mode remains a viewing
      // composition, not a claim of a navigable first-person boat interior.
      const targetX = next.view === 'boat' ? 1798 : 1326;
      this.cameraTarget = targetX - this.host.clientWidth / (2 * this.zoom);
    }
    this.applyCamera();
  }

  /** Attach audio analysis without passing each-frame values through React. */
  setMusicController(controller: NightMusic | null): void {
    this.music = controller;
    if (!controller) this.nightEffects.setAudioEnergy(0);
  }

  setAudioEnergy(energy: number): void {
    this.nightEffects.setAudioEnergy(energy);
  }

  // -------------------------------------------------------------- input state

  /**
   * Owned by React: while a dialogue, the help overlay or an intro is open the
   * painting must not keep walking or panning underneath it.
   */
  setInteractionLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.releaseInput();
  }

  /** Drop every held key/pointer and stop the walker where it stands. */
  releaseInput(): void {
    this.walkDirection = 0;
    this.destination = null;
    this.activePointers.clear();
    this.pinchLength = 0;
    this.dragged = false;
    this.dragStart = null;
    this.suppressTap = false;
  }

  private installEvents(): void {
    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.locked) return;
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.app.canvas.setPointerCapture(event.pointerId);
    this.dragged = false;
    this.suppressTap = false;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.cameraTarget = null;
    if (this.activePointers.size === 2) this.pinchLength = this.pointerDistance();
  };

  private pointerDistance(): number {
    const [a, b] = [...this.activePointers.values()];
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.locked) return;
    const last = this.activePointers.get(event.pointerId);
    if (!last) return;
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragged = true;
    // Mark the gesture as a pan BEFORE pointerup, because Pixi emits
    // `pointertap` on the hotspot during the same pointerup event.
    if (this.dragStart && isDrag(this.dragStart, { x: event.clientX, y: event.clientY }, DRAG_THRESHOLD)) {
      this.suppressTap = true;
    }
    if (this.activePointers.size > 1) {
      const nextDistance = this.pointerDistance();
      if (this.pinchLength > 0 && nextDistance > 0) this.setZoom(this.zoom * nextDistance / this.pinchLength);
      this.pinchLength = nextDistance;
      return;
    }
    this.cameraLeft -= (event.clientX - last.x) / this.zoom;
    this.applyCamera();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const hadPointer = this.activePointers.has(event.pointerId);
    this.activePointers.delete(event.pointerId);
    this.pinchLength = this.activePointers.size === 2 ? this.pointerDistance() : 0;
    if (!this.dragged && hadPointer && !this.locked) {
      const bounds = this.app.canvas.getBoundingClientRect();
      const x = this.cameraLeft + (event.clientX - bounds.left) / this.zoom;
      const y = (event.clientY - bounds.top - this.world.y) / this.zoom;
      if (y >= 483 && y < WORLD_HEIGHT && x >= 0 && x <= WORLD_WIDTH) {
        this.ripples.push({ x, y, age: 0 });
      }
    }
    if (this.activePointers.size === 0) {
      this.dragged = false;
      this.dragStart = null;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.locked) return;
    event.preventDefault();
    this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.001));
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.locked) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      this.setWalkDirection(-1); event.preventDefault();
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      this.setWalkDirection(1); event.preventDefault();
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(event.key)) this.setWalkDirection(0);
  };

  private onResize = (): void => {
    if (!this.ready) {
      this.viewSize = { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 };
      return;
    }
    const next = { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 };
    const camera = resizeCamera(
      { left: this.cameraLeft, zoom: this.zoom },
      this.viewSize,
      next,
    );
    this.viewSize = next;
    const limits = zoomBounds(next);
    this.zoomMinimum = limits.minimum;
    this.zoomMaximum = limits.maximum;
    this.zoom = camera.zoom;
    this.cameraLeft = camera.left;
    this.cameraTarget = null;
    this.applyCamera();
  };

  /** Leaving the tab must not leave the walker running when focus returns. */
  private onVisibilityChange = (): void => {
    this.visible = !document.hidden;
    if (document.hidden) this.releaseInput();
  };

  // ------------------------------------------------------------------- camera

  private fitInitialView(): void {
    this.zoom = clampZoom(fitZoom(this.viewSize), this.viewSize);
    this.zoomInitial = this.zoom;
    const limits = zoomBounds(this.viewSize);
    this.zoomMinimum = limits.minimum;
    this.zoomMaximum = limits.maximum;
    this.cameraLeft = clampHeroX(this.heroX) - this.viewSize.width / (2 * this.zoom);
    this.applyCamera();
  }

  private applyCamera(): void {
    if (!this.ready) return;
    const visibleWidth = this.viewSize.width / this.zoom;
    const maxLeft = WORLD_WIDTH - visibleWidth;
    this.cameraLeft = maxLeft < 0 ? maxLeft / 2 : Math.min(maxLeft, Math.max(0, this.cameraLeft));
    this.world.scale.set(this.zoom);
    const boatPreview = this.time === 'night' && this.nightControls.view === 'boat';
    const drift = boatPreview && !this.reducedMotion ? Math.sin(this.elapsed * 1.25) * 2.1 : 0;
    this.world.position.set(-this.cameraLeft * this.zoom, (this.host.clientHeight - WORLD_HEIGHT * this.zoom) / 2 + (boatPreview ? 19 : 0) + drift);
    const fraction = Math.max(0, Math.min(1, (this.cameraLeft + visibleWidth / 2) / WORLD_WIDTH));
    if (Math.abs(fraction - this.lastProgress) > 0.003) {
      this.lastProgress = fraction;
      this.callbacks.onPosition(fraction);
    }
  }

  private setZoom(nextZoom: number): void {
    const centre = this.cameraLeft + (this.viewSize.width / this.zoom) / 2;
    this.zoom = Math.max(this.zoomMinimum, Math.min(this.zoomMaximum, nextZoom));
    this.cameraLeft = centre - (this.viewSize.width / this.zoom) / 2;
    this.applyCamera();
  }
  zoomBy(factor: number): void { this.setZoom(this.zoom * factor); }

  setWalkDirection(direction: number): void {
    if (this.locked) return;
    this.walkDirection = Math.sign(direction);
    if (direction) { this.destination = null; this.action = null; }
  }

  setMode(mode: VisitMode): void { this.mode = mode; }

  /** Free mode hides the walker entirely; guided mode shows it. */
  setWalkerVisible(visible: boolean): void {
    this.walkerVisible = visible;
    if (this.hero) this.hero.visible = visible;
    if (this.contactShadow) this.contactShadow.visible = visible;
    if (!visible) {
      this.walkDirection = 0;
      this.destination = null;
    }
  }

  setTimeOfDay(time: TimeOfDay): void {
    const changed = this.time !== time;
    this.time = time;
    this.updateEncounterVisibility();
    this.applyCamera();
    if (!changed) return;
    // Walking across a time switch would fight the new scene's focus.
    this.releaseInput();
    const variant = artworkForTime(time);
    if (!this.readyScenes.has(variant) && !this.loadingKeys.has(assetKey('scene', variant))) {
      const asset = ALL_ASSETS.find((item) => item.key === assetKey('scene', variant));
      if (asset) {
        // Fetch the newly requested painting now; the old one stays visible
        // until the new texture is actually ready (never a blank canvas).
        void this.loadAsset(asset, false);
      }
    }
    this.emitStatus();
  }

  /**
   * Frame a painted subject. Camera framing and the standing position are
   * deliberately separate: centring 象鼻山 must not require standing on water.
   */
  focusPlace(id: PlaceId, instant = false): void {
    const place = PLACES.find((p) => p.id === id) ?? PLACES[0];
    // Per-subject framing: a wide view would leave 象鼻山 as a small rock in the
    // corner. Clamped to the same bounds the visitor's own zoom obeys.
    if (Number.isFinite(place.zoom) && this.zoomMaximum > 0) {
      // Never frame below "the painting fills the viewport", or cream margins
      // appear around the artwork — the scroll must always cover the stage.
      const fill = Math.max(
        this.viewSize.width / WORLD_WIDTH,
        this.host.clientHeight / WORLD_HEIGHT,
      );
      const floor = Math.max(this.zoomMinimum, Math.min(this.zoomMaximum, fill));
      const framed = Math.max(floor, Math.min(this.zoomMaximum, this.zoomInitial * place.zoom));
      if (Math.abs(framed - this.zoom) > 0.001) {
        this.zoom = framed;
        if (instant) this.applyCamera();
      }
    }
    this.ambientPlace = place;
    this.cameraTarget = place.worldX - this.viewSize.width / (2 * this.zoom);
    if (instant) { this.cameraLeft = this.cameraTarget; this.cameraTarget = null; this.applyCamera(); }
    // Only the guided "人物随行" mode moves the walker; free mode stays looking.
    if (this.mode === 'guided' && !instant && this.walkerVisible) {
      this.destination = clampHeroX(place.standX);
    }
    // The figure looks AT the subject it was asked to visit, even when it stands
    // well to the side of it (象鼻山 is watched across the water).
    if (this.walkerVisible && place.worldX < this.heroX) this.facing = -1;
    else if (this.walkerVisible && place.worldX > this.heroX) this.facing = 1;
    if (this.mode === 'free') {
      this.heroX = clampHeroX(place.standX);
      this.action = null;
    }
  }

  performAction(action: 'gaze' | 'song'): void {
    this.walkDirection = 0;
    this.destination = null;
    this.action = action;
    this.actionSeconds = action === 'song' ? 5.4 : 3.8;
  }

  // -------------------------------------------------------------- snapshots

  /**
   * Exactly what the finale/prologue must put back: walker position, facing and
   * the camera window. React owns time/mode/place and merges them in.
   */
  captureView(): Pick<SceneSnapshot, 'heroX' | 'facing' | 'cameraCentre' | 'zoom'> {
    return {
      heroX: this.heroX,
      facing: this.facing,
      cameraCentre: centreOf({ left: this.cameraLeft, zoom: this.zoom }, this.viewSize),
      zoom: this.zoom,
    };
  }

  /**
   * Restore a saved position. Runs after `onReady` so the viewport exists.
   * The walker always comes back standing still; no audio is resumed here.
   */
  restoreView(snapshot: Pick<SceneSnapshot, 'heroX' | 'facing' | 'cameraCentre' | 'zoom'>): void {
    if (!this.ready) return;
    this.releaseInput();
    this.action = null;
    this.heroX = clampHeroX(snapshot.heroX);
    this.facing = snapshot.facing;
    this.zoom = clampZoom(snapshot.zoom, this.viewSize);
    const limits = zoomBounds(this.viewSize);
    this.zoomMinimum = limits.minimum;
    this.zoomMaximum = limits.maximum;
    this.cameraLeft = cameraAround(snapshot.cameraCentre, this.zoom, this.viewSize).left;
    this.cameraTarget = null;
    this.applyCamera();
    if (this.hero) this.hero.position.set(this.heroX, walkwayY(this.heroX));
  }

  /** Exposed for QA/tests: the segment the walker is standing on. */
  footlineInfo(): { review: string; foreground: boolean } {
    return footlineReviewAt(this.heroX);
  }

  // ------------------------------------------------------------------- poses

  /**
   * Pose rules (documented in docs/ARCHITECTURE.md):
   *   song action      → song   (key pose only, not a performance)
   *   gaze action      → back   (looking away from the camera into the view)
   *   walking          → walk   (single key pose, not a frame sequence)
   *   idle by landmark → side   (turned towards the described scenery)
   *   idle elsewhere   → front
   */
  private decidePose(walking: boolean): Pose {
    if (this.action === 'song') return 'song';
    if (this.action === 'gaze') return 'back';
    if (walking) return 'walk';
    const nearLandmark = PLACES.some((place) => Math.abs(place.worldX - this.heroX) <= LANDMARK_NOTICE);
    return nearLandmark ? 'side' : 'front';
  }

  /**
   * Apply a pose if its texture has arrived, otherwise keep a usable stand-in.
   * The foot anchor (0.5, 1) never changes, so the walker stays on the footline.
   */
  private setHeroPose(next: Pose): void {
    if (!this.hero) return;
    const resolved = resolvePose(next, this.readyPoses);
    if (this.pose === resolved && this.hero.texture === this.textures.get(assetKey('pose', resolved))) return;
    this.setHeroTexture(resolved, false);
  }

  private setHeroTexture(pose: Pose, force: boolean): void {
    if (!this.hero) return;
    const texture = this.textures.get(assetKey('pose', pose));
    if (!texture) return;
    if (!force && this.pose === pose && this.hero.texture === texture) return;
    this.hero.texture = texture;
    // Uniform scale for every pose so the figure never changes size between
    // standing, walking and singing (see HERO_SCALE for why).
    this.hero.scale.set(HERO_SCALE, HERO_SCALE);
    this.hero.scale.x = HERO_SCALE * this.facing;
    this.pose = pose;
  }

  // -------------------------------------------------------------------- tick

  private tick = (ticker: { deltaMS: number }): void => {
    if (!this.hero && !this.ready) return;
    if (!this.visible || this.disposed) return;
    const dt = Math.min(MAX_FRAME_TIME, ticker.deltaMS / 1000);
    this.elapsed += dt;
    this.nightEffects.setAudioEnergy(this.time === 'night' && this.music ? this.music.sampleEnergy() : 0);
    this.nightEffects.draw(dt, this.time === 'night', this.nightControls, this.reducedMotion);
    // Only the raft-on-water and lantern boat receive a subtle floating motion.
    for (const id of ['cormorant', 'night-stage'] as const) {
      const sprite = this.encounterSprites.get(id);
      if (sprite) sprite.y = this.reducedMotion ? 0 : Math.sin(this.elapsed * 1.65 + (id === 'night-stage' ? 1 : 0)) * 1.8;
    }
    if (this.time === 'night' && this.nightControls.view === 'boat') this.applyCamera();

    // Crossfade between the ORIGINAL paintings. If the requested painting has
    // not arrived yet, keep the current one visible instead of fading to blank.
    const desiredScene = artworkForTime(this.time);
    if (this.backgrounds.has(desiredScene)) {
      for (const [id, sprite] of this.backgrounds) {
        const desired = id === desiredScene ? 1 : 0;
        const blend = this.reducedMotion ? 1 : Math.min(1, dt * 3.2);
        sprite.alpha += (desired - sprite.alpha) * blend;
        if (Math.abs(desired - sprite.alpha) < 0.002) sprite.alpha = desired;
      }
    }

    let direction = this.locked ? 0 : this.walkDirection;
    if (this.locked) this.destination = null;
    if (this.action) {
      this.actionSeconds -= dt;
      if (this.actionSeconds <= 0) this.action = null;
    } else if (!direction && this.destination !== null && !this.locked) {
      const delta = this.destination - this.heroX;
      if (Math.abs(delta) < 2) this.destination = null;
      else direction = Math.sign(delta);
    }
    if (direction) {
      this.facing = direction > 0 ? 1 : -1;
      const step = Math.min(WALK_SPEED * dt, this.destination === null ? Infinity : Math.abs(this.destination - this.heroX));
      this.heroX = clampHeroX(this.heroX + direction * step);
    }
    if (this.action || direction) this.setHeroPose(this.decidePose(direction !== 0));

    if (this.hero) {
      const isWalking = !this.action && direction !== 0;
      const ground = walkwayY(this.heroX);
      const bob = this.reducedMotion || !isWalking ? 0 : Math.sin(this.elapsed * 11) * 1.6;
      this.hero.position.set(this.heroX, ground + bob);
      this.hero.scale.x = Math.abs(this.hero.scale.x) * this.facing;
      this.hero.visible = this.walkerVisible;
      if (this.contactShadow) {
        // Kept on the ground line (no bob) so the shadow reads as the feet's
        // contact patch; narrower in the bridge shade where light is diffuse.
        this.contactShadow.visible = this.walkerVisible;
        this.contactShadow.position.set(this.heroX, ground - 1);
        this.contactShadow.scale.x = this.facing < 0 ? -1 : 1;
      }
    }

    if (this.cameraTarget !== null) {
      const speed = this.reducedMotion ? 1 : Math.min(1, dt * 4.8);
      this.cameraLeft += (this.cameraTarget - this.cameraLeft) * speed;
      if (Math.abs(this.cameraTarget - this.cameraLeft) < 0.5) this.cameraTarget = null;
      this.applyCamera();
    } else if (this.mode === 'guided' && direction !== 0) {
      const follow = this.heroX - this.viewSize.width / (2 * this.zoom);
      this.cameraLeft += (follow - this.cameraLeft) * Math.min(1, dt * 2.6);
      this.applyCamera();
    }

    this.drawAmbient();
    this.ripplesLayer.clear();
    this.ripples = this.ripples.filter((r) => r.age < 1.9);
    for (const ripple of this.ripples) {
      ripple.age += dt;
      for (let n = 0; n < 2; n += 1) {
        const radius = 6 + ripple.age * 48 + n * 16;
        this.ripplesLayer.ellipse(ripple.x, ripple.y, radius, radius * 0.24)
          .stroke({ color: 0xe9e8d4, width: 1.2, alpha: Math.max(0, 0.48 * (1 - ripple.age / 1.9)) });
      }
    }
  };

  /**
   * One restrained local motion per subject: a slow shimmer on the water in
   * front of the painting's own subject. It never touches the artwork's pixels
   * (separate Graphics layer) and is skipped entirely for reduced motion, so a
   * static screenshot is the same as the resting state.
   */
  private drawAmbient(): void {
    this.ambientLayer.clear();
    if (!this.ready || this.reducedMotion) return;
    const place = this.ambientPlace;
    if (!place) return;
    const night = this.time === 'night';
    const drift = Math.sin(this.elapsed * 0.55);
    for (let i = 0; i < 3; i += 1) {
      const spread = 46 + i * 22;
      const x = place.worldX + drift * (6 + i * 5) + (i - 1) * 26;
      const y = place.waterY - 4 + i * 7 + Math.sin(this.elapsed * 0.8 + i) * 1.2;
      this.ambientLayer.ellipse(x, y, spread, 2.1)
        .fill({ color: night ? 0xffd9a0 : 0xf6f0dc, alpha: (night ? 0.05 : 0.075) + i * 0.012 });
    }
  }
}

function assetLabel(asset: PlannedAsset): string {
  if (asset.kind === 'scene') {
    return `画卷 ${SCENE_LABELS[asset.id as ArtworkVariant] ?? asset.id}`;
  }
  return `人物 ${POSE_LABELS[asset.id as Pose] ?? asset.id}`;
}

const SCENE_LABELS: Record<string, string> = { day: '白昼', dusk: '夕照', night: '夜景' };
const POSE_LABELS: Record<string, string> = {
  front: '正面', side: '侧面', back: '背面', walk: '行走', song: '对山歌',
};
