"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BeatClock } from "@/lib/beatClock";
import { getTiming } from "@/lib/cardiac";

interface Thump {
  fromHz: number;
  toHz: number;
  durS: number;
  peak: number;
}

const LUB: Thump = { fromHz: 96, toHz: 46, durS: 0.16, peak: 1 };
const DUB: Thump = { fromHz: 124, toHz: 62, durS: 0.11, peak: 0.6 };

/** A short, low, pitch-dropping thud. Two layers so small speakers can play it. */
function playThump(ctx: AudioContext, out: AudioNode, thump: Thump) {
  const t0 = ctx.currentTime + 0.005;
  const end = t0 + thump.durS;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(thump.peak, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(out);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(thump.fromHz, t0);
  body.frequency.exponentialRampToValueAtTime(thump.toHz, end);
  body.connect(env);

  const knock = ctx.createOscillator();
  knock.type = "triangle";
  knock.frequency.setValueAtTime(thump.fromHz * 2, t0);
  knock.frequency.exponentialRampToValueAtTime(thump.toHz * 2, end);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 220;
  const knockGain = ctx.createGain();
  knockGain.gain.value = 0.35;
  knock.connect(lowpass).connect(knockGain).connect(env);

  body.start(t0);
  knock.start(t0);
  body.stop(end + 0.03);
  knock.stop(end + 0.03);
  body.onended = () => {
    body.disconnect();
    knock.disconnect();
    lowpass.disconnect();
    knockGain.disconnect();
    env.disconnect();
  };
}

/** True when the beat position `fraction` was crossed between two frames. */
function crossed(prevAbs: number, abs: number, fraction: number): boolean {
  const target = Math.floor(abs - fraction) + fraction;
  return target > prevAbs && target <= abs;
}

export interface HeartSound {
  enabled: boolean;
  volume: number;
  /** Set when the browser refused or lacks Web Audio. The app carries on silently. */
  unavailable: boolean;
  toggle: () => void;
  setVolume: (volume: number) => void;
}

/**
 * Synthesised "lub-dub" driven by the shared beat clock.
 * The AudioContext is only created inside `toggle`, which must be called
 * from a user gesture (a click or key press).
 */
export function useHeartSound(clock: BeatClock): HeartSound {
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [unavailable, setUnavailable] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const volumeRef = useRef(volume);

  const toggle = useCallback(() => {
    if (enabled) {
      setEnabled(false);
      void ctxRef.current?.suspend().catch(() => undefined);
      return;
    }
    try {
      // iOS treats Web Audio as "ambient" sound and mutes it when the ring /
      // silent switch is on. Asking for a playback session lets it through.
      const session = (
        navigator as Navigator & { audioSession?: { type: string } }
      ).audioSession;
      if (session) session.type = "playback";

      if (!ctxRef.current) {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = volumeRef.current;
        master.connect(ctx.destination);
        ctxRef.current = ctx;
        masterRef.current = master;
      }
      void ctxRef.current.resume().catch(() => setUnavailable(true));
      setEnabled(true);
    } catch {
      setUnavailable(true);
    }
  }, [enabled]);

  useEffect(() => {
    volumeRef.current = volume;
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (ctx && master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }, [volume]);

  useEffect(() => {
    if (!enabled) return;
    return clock.subscribe((frame) => {
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (!ctx || !master || ctx.state !== "running" || frame.dtMs === 0) return;
      const timing = getTiming(frame.shapeBpm);
      if (crossed(frame.prevAbs, frame.abs, timing.s1Ms / timing.periodMs)) {
        playThump(ctx, master, LUB);
      }
      if (crossed(frame.prevAbs, frame.abs, timing.s2Ms / timing.periodMs)) {
        playThump(ctx, master, DUB);
      }
    });
  }, [clock, enabled]);

  // iOS suspends or interrupts the context when the page is backgrounded or
  // a call comes in. Pick it back up when the page is visible again.
  useEffect(() => {
    if (!enabled) return;
    const resume = () => {
      const ctx = ctxRef.current;
      if (ctx && document.visibilityState === "visible" && ctx.state !== "running") {
        void ctx.resume().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pointerdown", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pointerdown", resume);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
      masterRef.current = null;
    };
  }, []);

  return { enabled, volume, unavailable, toggle, setVolume };
}
