import { CanvasSource, Sprite, Texture } from 'pixi.js';
import { HERO_MAX_HEIGHT, HERO_REFERENCE_PIXEL_HEIGHT } from '../content/walkway';

export const FOREGROUND_ORIGIN = { x: 480, y: 350 } as const;
export const CONTACT_SHADOW = {
  color: '#243428', alpha: 0.25, radiusX: 0.22, radiusY: 0.045, offsetY: -0.5,
} as const;

// The offscreen surface only needs to fit the largest pose and its foot shadow.
const RESOLUTION = 2;
const SIZE = Math.ceil(HERO_MAX_HEIGHT * 1.4);
const FOOT_X = SIZE / 2;
const FOOT_Y = SIZE - 4;

type WalkerFrame = {
  texture: Texture;
  mask: Texture;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
};

/** Canvas2D skips Pixi's sprite mask filter. Erase only from the local walker layer. */
export class CanvasWalkerMask {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: Texture<CanvasSource>;
  private last: WalkerFrame | null = null;

  constructor() {
    this.texture = new Texture({ source: new CanvasSource({
      resource: this.canvas, width: SIZE, height: SIZE, resolution: RESOLUTION,
    }) });
    this.sprite = new Sprite(this.texture);
    this.sprite.eventMode = 'none';
  }

  draw(frame: WalkerFrame): void {
    const { texture, mask, x, y, scale, facing } = frame;
    const last = this.last;
    if (last && last.texture === texture && last.mask === mask && last.x === x && last.y === y &&
        last.scale === scale && last.facing === facing) return;
    this.last = frame;
    const left = x - FOOT_X;
    const top = y - FOOT_Y;
    const ctx = this.texture.source.context2D;
    ctx.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const height = scale * HERO_REFERENCE_PIXEL_HEIGHT;
    ctx.save();
    ctx.globalAlpha = CONTACT_SHADOW.alpha;
    ctx.fillStyle = CONTACT_SHADOW.color;
    ctx.beginPath();
    ctx.ellipse(FOOT_X, FOOT_Y + CONTACT_SHADOW.offsetY,
      CONTACT_SHADOW.radiusX * height, CONTACT_SHADOW.radiusY * height, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const width = texture.width * scale;
    const poseHeight = texture.height * scale;
    ctx.save();
    ctx.translate(FOOT_X, FOOT_Y);
    ctx.scale(facing, 1);
    ctx.drawImage(texture.source.resource as CanvasImageSource, -width / 2, -poseHeight, width, poseHeight);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask.source.resource as CanvasImageSource,
      FOREGROUND_ORIGIN.x - left, FOREGROUND_ORIGIN.y - top, mask.width, mask.height);
    ctx.restore();
    this.sprite.position.set(left, top);
    this.texture.source.update();
  }

  destroy(): void {
    this.sprite.destroy({ texture: true, textureSource: true });
  }
}
