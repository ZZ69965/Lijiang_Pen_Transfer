import { Assets, Container, Sprite, Texture } from 'pixi.js';
import {
  droneArtworkFrame, getDroneArtwork,
  type DroneArtworkId, type DroneArtworkStatus,
} from '../content/droneArtworks.ts';

type ArtworkLoader = (id: DroneArtworkId) => Promise<Texture>;
const loadArtwork: ArtworkLoader = (id) =>
  Assets.load<Texture>(`${import.meta.env.BASE_URL}art/${getDroneArtwork(id).file}`);

/** A lazy, optional image layer. Supplied alpha and native pixels stay intact. */
export class NightDroneShow {
  readonly container = new Container();
  status: DroneArtworkStatus = { id: null, state: 'idle' };
  private readonly textures = new Map<DroneArtworkId, Texture>();
  private readonly pending = new Map<DroneArtworkId, Promise<Texture>>();
  private sprite: Sprite | null = null;
  private revision = 0;
  private disposed = false;
  private frame = { x: 0, y: 24, width: 560, height: 315 };
  private readonly onChange: () => void;
  private readonly load: ArtworkLoader;

  constructor(onChange: () => void, load: ArtworkLoader = loadArtwork) {
    this.onChange = onChange;
    this.load = load;
    this.container.label = 'night-drone-artwork';
    this.container.eventMode = 'none';
    this.container.visible = false;
  }

  setArtwork(id: DroneArtworkId | null): void {
    if (this.disposed || this.status.id === id) return;
    const revision = ++this.revision;
    this.container.visible = false;
    this.container.alpha = 0;
    if (id === null) {
      this.status = { id: null, state: 'idle' };
      this.onChange();
      return;
    }
    this.status = { id, state: 'loading' };
    this.onChange();
    const cached = this.textures.get(id);
    if (cached) {
      this.show(id, cached);
      return;
    }
    let request = this.pending.get(id);
    if (!request) {
      request = this.load(id);
      this.pending.set(id, request);
    }
    void request.then((texture) => {
      this.pending.delete(id);
      if (this.disposed) return;
      this.textures.set(id, texture);
      if (revision === this.revision) this.show(id, texture);
    }).catch(() => {
      this.pending.delete(id);
      if (this.disposed || revision !== this.revision) return;
      this.status = { id, state: 'error' };
      this.onChange();
    });
  }

  private show(id: DroneArtworkId, texture: Texture): void {
    if (!this.sprite) {
      this.sprite = new Sprite(texture);
      this.sprite.eventMode = 'none';
      this.container.addChild(this.sprite);
    } else this.sprite.texture = texture;
    this.status = { id, state: 'ready' };
    this.container.visible = true;
    this.applyFrame();
    this.onChange();
  }

  layout(width: number, height: number, zoom: number, worldY: number): void {
    this.frame = droneArtworkFrame(width, height, zoom, worldY);
    this.applyFrame();
  }

  private applyFrame(): void {
    this.container.position.set(this.frame.x, this.frame.y);
    if (this.sprite) {
      this.sprite.width = this.frame.width;
      this.sprite.height = this.frame.height;
    }
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.status.state !== 'ready') return;
    this.container.alpha = reducedMotion ? 1 : Math.min(1, this.container.alpha + dt * 2.5);
  }

  retry(): void {
    const id = this.status.id;
    if (this.status.state !== 'error' || id === null) return;
    this.status = { id: null, state: 'idle' };
    this.setArtwork(id);
  }

  dispose(): void {
    this.disposed = true;
    this.revision += 1;
    this.container.visible = false;
    this.textures.clear();
    this.pending.clear();
    // The engine destroys children; shared Pixi Assets textures remain cached.
  }
}
