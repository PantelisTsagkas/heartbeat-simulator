/**
 * Simplified cardiac timing model.
 *
 * This is a visual approximation for an educational toy, not physiology.
 * The one idea it does borrow from real hearts: when the rate rises, the
 * contraction (systole) shortens only a little, and the resting phase
 * (diastole) absorbs most of the change.
 */

export const BPM_MIN = 30;
export const BPM_MAX = 200;
export const BPM_DEFAULT = 72;

export type PresetId = "resting" | "normal" | "walking" | "running" | "fast";

export interface Preset {
  id: PresetId;
  bpm: number;
}

export const PRESETS: readonly Preset[] = [
  { id: "resting", bpm: 60 },
  { id: "normal", bpm: 72 },
  { id: "walking", bpm: 100 },
  { id: "running", bpm: 140 },
  { id: "fast", bpm: 180 },
];

export type RateZone =
  | "verySlow"
  | "resting"
  | "everyday"
  | "light"
  | "hard"
  | "veryFast";

/** Which descriptive band a rate falls in. The wording lives in i18n. */
export function rateZone(bpm: number): RateZone {
  if (bpm < 50) return "verySlow";
  if (bpm < 70) return "resting";
  if (bpm < 90) return "everyday";
  if (bpm < 120) return "light";
  if (bpm < 160) return "hard";
  return "veryFast";
}

export interface CardiacTiming {
  bpm: number;
  /** Length of one full cycle. */
  periodMs: number;
  /** Width scale for the sharp ECG deflections. */
  k: number;
  prMs: number;
  qtMs: number;
  /** Time of the R peak (the tall ECG spike). */
  rMs: number;
  /** End of the atrial squeeze. */
  atrialEndMs: number;
  ventStartMs: number;
  ventPeakMs: number;
  ventHoldEndMs: number;
  ventEndMs: number;
  /** First heart sound ("lub"): ventricles start to contract. */
  s1Ms: number;
  /** Second heart sound ("dub"): ventricles start to relax. */
  s2Ms: number;
  systoleMs: number;
  diastoleMs: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

let cached: CardiacTiming | null = null;

/** Timing of the events inside one beat, measured from the start of the cycle. */
export function getTiming(bpm: number): CardiacTiming {
  if (cached && cached.bpm === bpm) return cached;

  const periodMs = 60000 / bpm;
  // Square-root scaling keeps the active part of the beat nearly constant
  // in milliseconds while the pause stretches or shrinks.
  const r = Math.sqrt(periodMs / 1000);
  const k = clamp(r, 0.7, 1.15);
  const prMs = 150 * r;
  const qtMs = 385 * r;
  const rMs = prMs + 18 * k;
  const ventStartMs = rMs + 10 * k;
  const ventEndMs = Math.min(ventStartMs + qtMs, periodMs * 0.985);
  const ventDur = ventEndMs - ventStartMs;
  const s2Ms = ventStartMs + ventDur * 0.8;

  cached = {
    bpm,
    periodMs,
    k,
    prMs,
    qtMs,
    rMs,
    atrialEndMs: rMs + 10 * k,
    ventStartMs,
    ventPeakMs: ventStartMs + ventDur * 0.3,
    ventHoldEndMs: ventStartMs + ventDur * 0.55,
    ventEndMs,
    s1Ms: ventStartMs,
    s2Ms,
    systoleMs: s2Ms - ventStartMs,
    diastoleMs: periodMs - (s2Ms - ventStartMs),
  };
  return cached;
}

const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);
const easeInOut = (u: number) => u * u * (3 - 2 * u);

/** Atrial squeeze, 0..1. Happens just before the ventricles fire. */
export function atrialContraction(tMs: number, t: CardiacTiming): number {
  if (tMs <= 0 || tMs >= t.atrialEndMs) return 0;
  const s = Math.sin((Math.PI * tMs) / t.atrialEndMs);
  return s * s;
}

/** Ventricular squeeze, 0..1: fast rise, short hold, slower release. */
export function ventricularContraction(tMs: number, t: CardiacTiming): number {
  if (tMs <= t.ventStartMs || tMs >= t.ventEndMs) return 0;
  if (tMs < t.ventPeakMs) {
    return easeOutCubic(
      (tMs - t.ventStartMs) / (t.ventPeakMs - t.ventStartMs),
    );
  }
  if (tMs < t.ventHoldEndMs) {
    const u = (tMs - t.ventPeakMs) / (t.ventHoldEndMs - t.ventPeakMs);
    return 1 - 0.08 * u;
  }
  const u = (tMs - t.ventHoldEndMs) / (t.ventEndMs - t.ventHoldEndMs);
  return 0.92 * (1 - easeInOut(u));
}

/** Pulse of blood pushed into the great vessels, 0..1. */
export function ejectionPulse(tMs: number, t: CardiacTiming): number {
  const start = t.ventStartMs + (t.ventEndMs - t.ventStartMs) * 0.06;
  const u = (tMs - start) / ((t.ventEndMs - start) * 0.95);
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(Math.PI * Math.pow(u, 0.55));
}

const gauss = (x: number, mu: number, sigma: number) => {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
};

/**
 * ECG-style trace value at a point in the cycle. R peak is 1.0.
 * A stylised P-QRS-T shape built from bumps, not a recorded signal.
 */
export function ecgValue(tMs: number, t: CardiacTiming): number {
  const { k, prMs, qtMs, rMs } = t;
  return (
    0.11 * gauss(tMs, prMs * 0.42, prMs * 0.13) -
    0.1 * gauss(tMs, rMs - 14 * k, 5 * k) +
    1.0 * gauss(tMs, rMs, 7 * k) -
    0.2 * gauss(tMs, rMs + 13 * k, 6 * k) +
    0.3 * gauss(tMs, rMs + qtMs * 0.62, qtMs * 0.11)
  );
}
