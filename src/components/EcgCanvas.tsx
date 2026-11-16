"use client";

import { useEffect, useRef } from "react";
import type { BeatClock, BeatFrame } from "@/lib/beatClock";
import { ecgValue, getTiming } from "@/lib/cardiac";

/** Simulated time between stored samples. Fine enough to keep the R spike sharp. */
const STEP_MS = 2;
const MAX_WINDOW_MS = 6000;
const BUFFER_SIZE = MAX_WINDOW_MS / STEP_MS;
/** Blank gap ahead of the write head, like a bedside monitor. */
const GAP_MS = 220;
const FADE_BANDS = 6;

/**
 * Sweep-style trace. The sweep speed is constant in pixels per second, so the
 * time axis is real: raising the BPM pulls the peaks closer together, and
 * beats already on screen stay where they were drawn.
 */
export function EcgCanvas({
  clock,
  label,
}: {
  clock: BeatClock;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const samples = new Float32Array(BUFFER_SIZE);
    let lastIndex = -1;
    let width = 0;
    let height = 0;
    let windowMs = 4000;

    const record = (frame: BeatFrame) => {
      const timing = getTiming(frame.shapeBpm);
      const head = Math.floor(frame.simMs / STEP_MS);
      // After a long stall only the newest window matters.
      const from = Math.max(lastIndex + 1, head - BUFFER_SIZE + 1);
      for (let i = from; i <= head; i++) {
        const beats = frame.abs - ((frame.simMs - i * STEP_MS) * frame.bpm) / 60000;
        const phase = beats - Math.floor(beats);
        samples[i % BUFFER_SIZE] = ecgValue(phase * timing.periodMs, timing);
      }
      lastIndex = Math.max(lastIndex, head);
    };

    const draw = (frame: BeatFrame) => {
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      // Time grid: a line every 200 ms, a stronger one every second.
      const pxPerMs = width / windowMs;
      ctx.lineWidth = 1;
      for (let ms = 0; ms <= windowMs; ms += 200) {
        const x = Math.round(ms * pxPerMs) + 0.5;
        ctx.strokeStyle =
          ms % 1000 === 0 ? "rgba(255,90,100,0.16)" : "rgba(255,90,100,0.06)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const baseline = height * 0.7;
      const amplitude = height * 0.56;
      ctx.strokeStyle = "rgba(255,90,100,0.1)";
      ctx.beginPath();
      ctx.moveTo(0, Math.round(baseline) + 0.5);
      ctx.lineTo(width, Math.round(baseline) + 0.5);
      ctx.stroke();

      const head = Math.floor(frame.simMs / STEP_MS);
      const visible = Math.floor((windowMs - GAP_MS) / STEP_MS);
      const first = Math.max(0, head - visible);
      if (head <= first) return;

      const xOf = (i: number) => ((i * STEP_MS) % windowMs) * pxPerMs;
      const yOf = (i: number) => baseline - samples[i % BUFFER_SIZE] * amplitude;

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const bandSize = Math.ceil((head - first) / FADE_BANDS);
      for (let band = 0; band < FADE_BANDS; band++) {
        const start = first + band * bandSize;
        const end = Math.min(head, start + bandSize);
        if (start >= end) break;
        ctx.beginPath();
        let prevX = -1;
        for (let i = start; i <= end; i++) {
          const x = xOf(i);
          if (i === start || x < prevX) ctx.moveTo(x, yOf(i));
          else ctx.lineTo(x, yOf(i));
          prevX = x;
        }
        const age = (band + 1) / FADE_BANDS;
        ctx.globalAlpha = 0.16 * age;
        ctx.strokeStyle = "#ff2d46";
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.globalAlpha = 0.3 + 0.7 * age;
        ctx.strokeStyle = "#ff5468";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const hx = xOf(head);
      const hy = yOf(head);
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      glow.addColorStop(0, "rgba(255,200,190,0.95)");
      glow.addColorStop(0.25, "rgba(255,70,90,0.6)");
      glow.addColorStop(1, "rgba(255,70,90,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(hx, hy, 14, 0, Math.PI * 2);
      ctx.fill();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Roughly 170 px per second on any screen, so narrow screens show less time.
      windowMs = Math.min(
        MAX_WINDOW_MS,
        Math.max(2000, Math.round(width / 170 / 0.2) * 200),
      );
      draw(clock.getFrame());
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const unsubscribe = clock.subscribe((frame) => {
      record(frame);
      draw(frame);
    });

    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [clock]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block h-28 w-full sm:h-36"
    />
  );
}
