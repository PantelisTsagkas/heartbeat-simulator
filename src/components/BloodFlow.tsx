"use client";

import { useEffect, useRef } from "react";
import type { BeatClock, BeatFrame } from "@/lib/beatClock";
import {
  FLOW_ROUTES,
  pointOnRoute,
  type FlowKind,
  type Oxygen,
} from "@/lib/bloodFlow";
import {
  ejectionPulse,
  fillingFlow,
  getTiming,
  ventricularContraction,
} from "@/lib/cardiac";

/** Width of the SVG coordinate space this overlay is aligned to. */
const VIEW_WIDTH = 400;

const COLORS: Record<Oxygen, string> = {
  poor: "96, 165, 255",
  rich: "255, 132, 110",
};

interface Particle {
  route: number;
  /** Position along the route, 0..1. */
  s: number;
  /** Sideways offset as a fraction of the stream half-width, -1..1. */
  lane: number;
  /** Small per-particle speed variation so the stream does not march in step. */
  pace: number;
}

/** Deterministic pseudo-random numbers, so the layout is stable across renders. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function createParticles(): Particle[] {
  const random = seeded(7);
  const particles: Particle[] = [];
  FLOW_ROUTES.forEach((route, index) => {
    for (let i = 0; i < route.count; i++) {
      particles.push({
        route: index,
        s: (i + random()) / route.count,
        lane: random() * 2 - 1,
        pace: 0.8 + random() * 0.4,
      });
    }
  });
  return particles;
}

/**
 * Blood drawn as glowing streaks on a canvas over the heart.
 * Speed follows the beat: arteries surge when the ventricles contract,
 * the atria empty into the ventricles while they relax, and the veins
 * keep a steadier return flow.
 */
export function BloodFlow({ clock }: { clock: BeatClock }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const particles = createParticles();
    const speed: Record<FlowKind, number> = { return: 0, fill: 0, eject: 0 };
    const head = { x: 0, y: 0 };
    const tail = { x: 0, y: 0 };
    let scale = 1;
    let width = 0;
    let height = 0;

    const step = (frame: BeatFrame) => {
      const timing = getTiming(frame.shapeBpm);
      const tMs = frame.phase * timing.periodMs;
      const rate = Math.min(1.6, Math.max(0.7, Math.sqrt(frame.bpm / 72)));

      // Target speed per kind, in route lengths per second.
      const target: Record<FlowKind, number> = {
        return: (0.22 + 0.3 * ventricularContraction(tMs, timing)) * rate,
        fill: 0.02 + 1.05 * fillingFlow(tMs, timing) * rate,
        eject: 0.015 + 1.7 * ejectionPulse(tMs, timing) * rate,
      };
      // Ease toward the target so valves do not appear to slam instantly.
      const blend = Math.min(1, frame.dtMs / 45);
      (Object.keys(speed) as FlowKind[]).forEach((kind) => {
        speed[kind] += (target[kind] - speed[kind]) * blend;
      });

      const dt = frame.dtMs / 1000;
      for (const particle of particles) {
        const kind = FLOW_ROUTES[particle.route].kind;
        particle.s += speed[kind] * particle.pace * dt;
        if (particle.s >= 1) particle.s -= 1;
      }
    };

    const draw = () => {
      if (width === 0) return;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      for (const particle of particles) {
        const route = FLOW_ROUTES[particle.route];
        const v = speed[route.kind];
        // Fade in and out at the ends so particles never pop.
        const edge = Math.min(1, particle.s / 0.08, (1 - particle.s) / 0.1);
        const energy = Math.min(1, v / 0.9);
        const alpha = Math.max(0, edge) * (0.28 + 0.72 * energy);
        if (alpha <= 0.01) continue;

        const lateral = particle.lane * route.spread;
        const streak = Math.min(0.07, 0.006 + v * particle.pace * 0.035);
        pointOnRoute(route, particle.s, lateral, head);
        pointOnRoute(route, particle.s - streak, lateral, tail);

        const color = COLORS[route.oxygen];
        ctx.beginPath();
        ctx.moveTo(tail.x * scale, tail.y * scale);
        ctx.lineTo(head.x * scale, head.y * scale);
        ctx.strokeStyle = `rgba(${color}, ${(alpha * 0.22).toFixed(3)})`;
        ctx.lineWidth = 6.5 * scale;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${color}, ${(alpha * 0.95).toFixed(3)})`;
        ctx.lineWidth = 2.1 * scale;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      scale = width / VIEW_WIDTH;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const unsubscribe = clock.subscribe((frame) => {
      step(frame);
      draw();
    });

    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [clock]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
