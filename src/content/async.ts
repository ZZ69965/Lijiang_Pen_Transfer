/**
 * Staleness guards for asynchronous work.
 *
 * Two race classes are covered:
 *  1. Async work that finishes AFTER the scene/painting was left. Its result
 *     must never touch a destroyed stage or revive an old painting.
 *  2. Audio: `await play()` can resolve after the visitor already switched time,
 *     closed the card or hid the tab. The late result must not turn sound back on.
 */

/** Increments on every begin(); only the latest token is still current. */
export class AsyncEpoch {
  private value = 0;

  begin(): number {
    this.value += 1;
    return this.value;
  }

  /** Called when the owner is disposed: every outstanding token becomes stale. */
  invalidate(): void {
    this.value += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.value;
  }
}

export type AudioIntent = 'play' | 'pause';

/**
 * Serialises play/pause calls so overlapping clicks cannot interleave.
 *
 * - Only the LAST intent wins when several arrive while one is in flight.
 * - If a `pause` lands while `play()` is still awaiting, the pause is applied
 *   as soon as play resolves, so audio never keeps sounding after the visitor left.
 * - Errors from a superseded intent are swallowed; the caller only sees the
 *   error of the intent it still cares about.
 */
export class AudioIntentQueue {
  private intent: AudioIntent | null = null;
  private running: Promise<boolean> | null = null;
  private closed = false;
  private readonly play: () => Promise<boolean>;
  private readonly pause: () => void;
  private readonly isPlaying: () => boolean;

  constructor(
    play: () => Promise<boolean>,
    pause: () => void,
    isPlaying: () => boolean,
  ) {
    this.play = play;
    this.pause = pause;
    this.isPlaying = isPlaying;
  }

  /** Request a state. Resolves with the finally applied state (true = playing). */
  request(intent: AudioIntent): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.running) {
      // Coalesce: the newest intent replaces any queued one.
      this.intent = intent;
      return this.running;
    }
    this.intent = intent;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (this.intent) {
      const intent = this.intent;
      this.intent = null;
      try {
        if (intent === 'play') {
          await this.play();
        } else {
          this.pause();
        }
      } catch (error) {
        // A queued opposite intent may still fix the state; otherwise report.
        if (!this.intent) throw error;
      }
      if (this.closed) {
        this.pause();
        break;
      }
    }
    return this.isPlaying();
  }

  /** Force-stops audio and rejects any in-flight result. */
  close(): void {
    this.closed = true;
    this.intent = null;
    this.pause();
  }

  reopen(): void {
    this.closed = false;
  }
}
