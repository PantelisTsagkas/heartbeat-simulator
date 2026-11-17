"use client";

import { useEffect, useRef, useState } from "react";
import { HeartDiagram, type HeartLabels } from "@/components/HeartDiagram";
import type { BeatClock, BeatFrame } from "@/lib/beatClock";
import { ejectionPulse, getTiming } from "@/lib/cardiac";
import type { Anchors, HeartScene } from "@/lib/heart3d/HeartScene";

/*
 * The heart is a real-time 3D model: a front view with windows cut into
 * each chamber, rendered with WebGL (three.js). The geometry is sculpted
 * offline (scripts/build-heart-mesh.mjs) and deformed on the GPU with each
 * beat. If WebGL is not available the original SVG diagram is shown.
 */

const MESH_URL = "/heart/heart.bin";

/** Where the overlay text sits on the model, in model space. */
const LABEL_ANCHORS: Anchors = {
  rightAtrium: [118, 200, -6],
  leftAtrium: [304, 190, -8],
  rightVentricle: [172, 298, -2],
  leftVentricle: [274, 306, -8],
};

/** Numbered markers, matched by the key under the illustration. */
const MARKERS: { key: string; n: number; at: [number, number, number] }[] = [
  { key: "m1", n: 1, at: [126, 82, 14] },
  { key: "m2", n: 2, at: [97, 352, -26] },
  { key: "m3a", n: 3, at: [338, 129, -3] },
  { key: "m3b", n: 3, at: [62, 141, -26] },
  { key: "m4a", n: 4, at: [360, 174, -10] },
  { key: "m4b", n: 4, at: [50, 192, -64] },
  { key: "m5", n: 5, at: [238, 79, -9] },
];

const ANCHORS: Anchors = {
  ...LABEL_ANCHORS,
  ...Object.fromEntries(MARKERS.map((m) => [m.key, m.at])),
};

function ChamberLabel({ text, anchor }: { text: string; anchor: string }) {
  const lines = text.split(" ");
  return (
    <text
      data-anchor={anchor}
      textAnchor="middle"
      fontSize="10.5"
      fontWeight="600"
      fill="#fff4ef"
      stroke="#12040a"
      strokeOpacity="0.75"
      strokeWidth="2.6"
      paintOrder="stroke"
    >
      {lines.map((line, index) => (
        <tspan key={line} x={0} dy={index === 0 ? -(lines.length - 1) * 6 : 12}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function HeartVisual({
  clock,
  label,
  labels,
}: {
  clock: BeatClock;
  label: string;
  labels: HeartLabels;
}) {
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const floorRef = useRef<SVGEllipseElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fallback) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: HeartScene | null = null;
    let disposed = false;
    let unsubscribe = () => {};
    let observer: ResizeObserver | null = null;
    const placed: Record<string, [number, number]> = {};

    const decorate = (frame: BeatFrame) => {
      const timing = getTiming(frame.shapeBpm);
      const tMs = frame.phase * timing.periodMs;
      const eject = ejectionPulse(tMs, timing) * (reduceMotion ? 0.45 : 1);
      if (auraRef.current) {
        auraRef.current.style.opacity = (0.5 + 0.5 * eject).toFixed(3);
        auraRef.current.style.transform = `scale(${(0.94 + 0.1 * eject).toFixed(4)})`;
      }
      if (floorRef.current) {
        floorRef.current.style.opacity = (0.45 + 0.4 * eject).toFixed(3);
      }
      // Expanding ring. Timed in milliseconds so it stays crisp at low BPM.
      if (ringRef.current) {
        const sinceMs = tMs - timing.ventStartMs;
        const span = Math.min(650, timing.periodMs - timing.ventStartMs);
        const u = sinceMs / span;
        if (u > 0 && u < 1 && !reduceMotion) {
          ringRef.current.setAttribute("r", (130 + 90 * u).toFixed(1));
          ringRef.current.style.opacity = (0.2 * (1 - u) * (1 - u)).toFixed(3);
        } else {
          ringRef.current.style.opacity = "0";
        }
      }
      if (rootRef.current) {
        const beats = String(Math.floor(frame.abs));
        if (rootRef.current.dataset.beats !== beats) rootRef.current.dataset.beats = beats;
      }
    };

    const placeOverlay = () => {
      if (!scene || !overlayRef.current) return;
      scene.project(ANCHORS, placed);
      overlayRef.current.querySelectorAll<SVGGraphicsElement>("[data-anchor]").forEach((el) => {
        const at = placed[el.dataset.anchor ?? ""];
        if (at) el.setAttribute("transform", `translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})`);
      });
    };

    const apply = (frame: BeatFrame) => {
      decorate(frame);
      if (!scene) return;
      scene.update(frame);
      placeOverlay();
    };

    (async () => {
      try {
        const { HeartScene } = await import("@/lib/heart3d/HeartScene");
        const created = await HeartScene.create(canvas, MESH_URL, reduceMotion);
        if (disposed) {
          created.dispose();
          return;
        }
        scene = created;
        const resize = () => {
          const rect = canvas.getBoundingClientRect();
          created.setSize(rect.width, rect.height);
          created.update(clock.getFrame());
          placeOverlay();
        };
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        setReady(true);
      } catch (error) {
        console.warn("3D heart unavailable, showing the diagram instead.", error);
        if (!disposed) setFallback(true);
      }
    })();

    apply(clock.getFrame());
    unsubscribe = clock.subscribe(apply);
    return () => {
      disposed = true;
      unsubscribe();
      observer?.disconnect();
      scene?.dispose();
    };
  }, [clock, fallback]);

  if (fallback) {
    return <HeartDiagram clock={clock} label={label} labels={labels} />;
  }

  return (
    <div
      ref={rootRef}
      data-beats="0"
      className="relative mx-auto aspect-[10/11] w-[min(100%,max(62vh,340px),520px)]"
    >
      <div
        ref={auraRef}
        aria-hidden="true"
        className="heart-aura pointer-events-none absolute inset-[-8%]"
      />
      <svg
        viewBox="0 0 400 440"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <radialGradient id="hb3-floor" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ff5a2a" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="#d0121c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#d0121c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse ref={floorRef} cx="214" cy="428" rx="150" ry="11" fill="url(#hb3-floor)" />
        <circle
          ref={ringRef}
          cx="214"
          cy="270"
          r="130"
          fill="none"
          stroke="#ff4d5e"
          strokeWidth="1"
          style={{ opacity: 0 }}
        />
      </svg>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`relative h-full w-full transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {/* Names sit above the moving blood so they stay readable */}
      <svg
        ref={overlayRef}
        viewBox="0 0 400 440"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 h-full w-full overflow-visible transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
      >
        <ChamberLabel text={labels.rightAtrium} anchor="rightAtrium" />
        <ChamberLabel text={labels.leftAtrium} anchor="leftAtrium" />
        <ChamberLabel text={labels.rightVentricle} anchor="rightVentricle" />
        <ChamberLabel text={labels.leftVentricle} anchor="leftVentricle" />
        {MARKERS.map((marker) => (
          <g key={marker.key} data-anchor={marker.key}>
            <circle
              r="7.5"
              fill="#0b0508"
              fillOpacity="0.9"
              stroke="#f4eae7"
              strokeOpacity="0.8"
              strokeWidth="0.9"
            />
            <text y={3.4} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#f4eae7">
              {marker.n}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
