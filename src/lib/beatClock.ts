/**
 * One clock drives the heart, the waveform and the sound.
 *
 * Phase is accumulated frame by frame (phase += dt * bpm / 60000) instead of
 * being derived from wall time, so changing the BPM mid-beat changes the
 * speed without making the animation jump.
 */

export interface BeatFrame {
  /** Position inside the current beat, 0..1. */
  phase: number;
  /** Total beats elapsed, as a float. Integer part is the beat count. */
  abs: number;
  /** Value of `abs` on the previous frame. */
  prevAbs: number;
  /** Live rate. Sets how fast phase advances. */
  bpm: number;
  /**
   * Rate latched at the start of the current beat. Sets the shape of the
   * beat (when each event falls inside it). Holding it fixed for a whole
   * beat means a BPM change never makes the pose or trace jump mid-beat.
   */
  shapeBpm: number;
  /** Simulated time elapsed while playing. Stops when paused. */
  simMs: number;
  dtMs: number;
}

export type BeatListener = (frame: BeatFrame) => void;

export interface BeatClock {
  subscribe(listener: BeatListener): () => void;
  getFrame(): BeatFrame;
}

export interface BeatClockController extends BeatClock {
  setBpm(bpm: number): void;
  setPlaying(playing: boolean): void;
  dispose(): void;
}

/** A hidden tab can stall frames for seconds. Never advance more than this. */
const MAX_DT_MS = 100;

export function createBeatClock(initialBpm: number): BeatClockController {
  let bpm = initialBpm;
  let shapeBpm = initialBpm;
  let playing = false;
  let rafId = 0;
  let lastNow = 0;
  let abs = 0;
  let simMs = 0;
  const listeners = new Set<BeatListener>();

  const makeFrame = (prevAbs: number, dtMs: number): BeatFrame => ({
    phase: abs - Math.floor(abs),
    abs,
    prevAbs,
    bpm,
    shapeBpm,
    simMs,
    dtMs,
  });

  let frame = makeFrame(0, 0);

  const emit = (prevAbs: number, dtMs: number) => {
    frame = makeFrame(prevAbs, dtMs);
    listeners.forEach((listener) => listener(frame));
  };

  const tick = (now: number) => {
    const dtMs = Math.min(Math.max(now - lastNow, 0), MAX_DT_MS);
    lastNow = now;
    const prevAbs = abs;
    abs += (dtMs * bpm) / 60000;
    if (Math.floor(abs) !== Math.floor(prevAbs)) shapeBpm = bpm;
    simMs += dtMs;
    emit(prevAbs, dtMs);
    rafId = requestAnimationFrame(tick);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getFrame: () => frame,
    setBpm(next) {
      if (next === bpm) return;
      bpm = next;
    },
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      if (playing) {
        lastNow = performance.now();
        rafId = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(rafId);
      }
    },
    dispose() {
      cancelAnimationFrame(rafId);
      playing = false;
    },
  };
}
