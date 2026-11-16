"use client";

import { useEffect, useRef } from "react";
import type { BeatClock, BeatFrame } from "@/lib/beatClock";
import {
  atrialContraction,
  ejectionPulse,
  getTiming,
  ventricularContraction,
} from "@/lib/cardiac";

/**
 * Ventricle outline as cubic bezier control points, relaxed and contracted.
 * Both share the same structure so they can be blended point by point.
 * In the contracted shape the side walls move inward and the apex lifts
 * toward the base, which is what stops the beat reading as a uniform scale.
 */
const BODY_RELAXED = [
  108, 196, 86, 236, 96, 300, 140, 346, 168, 374, 200, 398, 226, 404, 244,
  406, 262, 384, 284, 348, 312, 304, 326, 252, 314, 212, 304, 182, 272, 166,
  240, 168, 210, 160, 176, 160, 150, 168, 130, 172, 116, 182, 108, 196,
];
const BODY_CONTRACTED = [
  111, 197, 100, 236, 114, 294, 152, 336, 176, 362, 204, 382, 226, 388, 240,
  390, 254, 372, 272, 338, 294, 298, 306, 250, 302, 212, 296, 185, 270, 168,
  240, 169, 210, 161, 176, 161, 150, 169, 130, 173, 118, 183, 111, 197,
];

function bodyPath(squeeze: number): string {
  const p = BODY_RELAXED.map(
    (v, i) => v + (BODY_CONTRACTED[i] - v) * squeeze,
  );
  let d = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  for (let i = 2; i < p.length; i += 6) {
    d += ` C${p[i].toFixed(1)} ${p[i + 1].toFixed(1)} ${p[i + 2].toFixed(1)} ${p[i + 3].toFixed(1)} ${p[i + 4].toFixed(1)} ${p[i + 5].toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Transform about a pivot point, as an SVG transform attribute. */
function about(
  px: number,
  py: number,
  sx: number,
  sy: number,
  rotateDeg = 0,
): string {
  return `translate(${px} ${py}) rotate(${rotateDeg.toFixed(3)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-px} ${-py})`;
}

type TubeTone = "artery" | "vein";

const TONES: Record<TubeTone, [string, string, string]> = {
  artery: ["#4d0610", "#b3141f", "#ff6a4d"],
  vein: ["#3b0510", "#8f1020", "#e0483f"],
};

/** A vessel drawn as three stacked strokes, which reads as a lit cylinder. */
function Tube({
  d,
  width,
  tone = "artery",
  pulse = false,
}: {
  d: string;
  width: number;
  tone?: TubeTone;
  pulse?: boolean;
}) {
  const [edge, mid, light] = TONES[tone];
  const w = (factor: number) =>
    pulse
      ? { strokeWidth: `calc(${width * factor}px * var(--pulse, 1))` }
      : { strokeWidth: width * factor };
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={edge} style={w(1)} />
      <path d={d} stroke={mid} style={w(0.7)} opacity={0.6} />
      <path d={d} stroke={mid} style={w(0.42)} opacity={0.75} />
      <path d={d} stroke={light} style={w(0.13)} opacity={0.5} />
    </g>
  );
}

const CORONARIES: { d: string; w: number }[] = [
  // Down the groove between the ventricles, toward the apex.
  { d: "M232 184 C222 222 227 268 223 308", w: 5 },
  { d: "M223 308 C221 344 224 370 228 394", w: 3.4 },
  { d: "M227 236 C246 252 262 262 277 290", w: 3.2 },
  { d: "M264 262 C273 262 281 259 287 252", w: 2 },
  { d: "M224 288 C240 304 252 320 262 346", w: 2.6 },
  { d: "M246 312 C258 314 268 310 276 302", w: 1.7 },
  { d: "M226 260 C206 278 192 290 176 318", w: 3 },
  { d: "M196 286 C186 284 176 278 168 268", w: 1.8 },
  { d: "M222 322 C208 336 200 346 192 364", w: 2.3 },
  { d: "M224 356 C234 364 240 372 244 382", w: 1.6 },
  // Along the right border.
  { d: "M152 178 C136 214 131 250 141 290 C147 314 160 334 174 350", w: 3.6 },
  { d: "M134 244 C150 256 160 268 168 292", w: 2.2 },
  { d: "M146 300 C158 304 168 314 176 328", w: 1.7 },
  // Around the left side.
  { d: "M240 186 C262 185 281 194 293 214 C299 238 296 264 289 288", w: 3.4 },
  { d: "M295 226 C287 238 282 252 280 270", w: 2 },
];

export function HeartVisual({
  clock,
  label,
}: {
  clock: BeatClock;
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<SVGPathElement>(null);
  const heartRef = useRef<SVGGElement>(null);
  const ventriclesRef = useRef<SVGGElement>(null);
  const coreRef = useRef<SVGGElement>(null);
  const rightAtriumRef = useRef<SVGGElement>(null);
  const leftAtriumRef = useRef<SVGGElement>(null);
  const arteriesRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const floorRef = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const amount = reduceMotion ? 0.45 : 1;

    const apply = (frame: BeatFrame) => {
      const timing = getTiming(frame.shapeBpm);
      const tMs = frame.phase * timing.periodMs;
      const atria = atrialContraction(tMs, timing) * amount;
      const vent = ventricularContraction(tMs, timing) * amount;
      const eject = ejectionPulse(tMs, timing) * amount;

      // Ventricles: walls move in, apex lifts, and the whole mass wrings
      // slightly around its base. The late atrial push tops them up first.
      bodyRef.current?.setAttribute("d", bodyPath(vent - atria * 0.12));
      ventriclesRef.current?.setAttribute(
        "transform",
        about(212, 178, 1 - 0.035 * vent, 1 - 0.03 * vent, -3.2 * vent),
      );
      // The bright chamber shrinks much more than the outer wall,
      // so the muscle appears to thicken as it squeezes.
      if (coreRef.current) {
        coreRef.current.setAttribute(
          "transform",
          about(220, 262, 1 - 0.34 * vent + 0.05 * atria, 1 - 0.26 * vent),
        );
        coreRef.current.style.opacity = (0.72 + 0.28 * vent).toFixed(3);
      }

      // Atria: squeeze before the ventricles, then swell as they refill.
      const atrial = 1 - 0.16 * atria + 0.07 * vent;
      rightAtriumRef.current?.setAttribute(
        "transform",
        about(146, 196, atrial, atrial),
      );
      leftAtriumRef.current?.setAttribute(
        "transform",
        about(272, 198, atrial, atrial),
      );

      // Great vessels widen as blood is pushed into them.
      arteriesRef.current?.style.setProperty(
        "--pulse",
        (1 + 0.075 * eject).toFixed(4),
      );

      heartRef.current?.setAttribute(
        "transform",
        `translate(0 ${(-2.5 * vent + 1.5 * atria).toFixed(2)})`,
      );

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
          ringRef.current.setAttribute("r", (120 + 95 * u).toFixed(1));
          ringRef.current.style.opacity = (0.3 * (1 - u) * (1 - u)).toFixed(3);
        } else {
          ringRef.current.style.opacity = "0";
        }
      }

      if (rootRef.current) {
        const beats = String(Math.floor(frame.abs));
        if (rootRef.current.dataset.beats !== beats) {
          rootRef.current.dataset.beats = beats;
        }
      }
    };

    apply(clock.getFrame());
    return clock.subscribe(apply);
  }, [clock]);

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
        role="img"
        aria-label={label}
        className="relative h-full w-full overflow-visible"
      >
        <defs>
          <path id="hb-body" ref={bodyRef} d={bodyPath(0)} />
          <clipPath id="hb-body-clip">
            <use href="#hb-body" />
          </clipPath>
          <radialGradient id="hb-wall" cx="0.46" cy="0.34" r="0.78">
            <stop offset="0" stopColor="#e2232d" />
            <stop offset="0.45" stopColor="#a50f1c" />
            <stop offset="0.8" stopColor="#560611" />
            <stop offset="1" stopColor="#2a0208" />
          </radialGradient>
          <radialGradient id="hb-core" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#ffe1a0" />
            <stop offset="0.3" stopColor="#ffa23a" />
            <stop offset="0.65" stopColor="#ff4a1a" stopOpacity="0.75" />
            <stop offset="1" stopColor="#d0121c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hb-atrium" cx="0.42" cy="0.36" r="0.75">
            <stop offset="0" stopColor="#ef3a34" />
            <stop offset="0.5" stopColor="#a8111d" />
            <stop offset="1" stopColor="#3d0410" />
          </radialGradient>
          <radialGradient id="hb-floor" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ff5a2a" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="#d0121c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#d0121c" stopOpacity="0" />
          </radialGradient>
          <filter id="hb-blur-lg" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id="hb-blur-md" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="hb-blur-sm" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <ellipse
          ref={floorRef}
          cx="218"
          cy="420"
          rx="150"
          ry="13"
          fill="url(#hb-floor)"
        />
        <circle
          ref={ringRef}
          cx="214"
          cy="250"
          r="120"
          fill="none"
          stroke="#ff4d5e"
          strokeWidth="1"
          style={{ opacity: 0 }}
        />

        <g ref={heartRef}>
          {/* Veins returning blood to the heart */}
          <Tube d="M127 152 L121 72" width={26} tone="vein" />
          <Tube d="M120 76 L103 42" width={12} tone="vein" />
          <Tube d="M122 74 L137 38" width={12} tone="vein" />
          <Tube d="M103 46 L92 30" width={6} tone="vein" />
          <Tube d="M88 162 L54 152" width={10} tone="vein" />
          <Tube d="M86 184 L52 190" width={10} tone="vein" />
          <Tube d="M334 172 L370 164" width={11} tone="vein" />
          <Tube d="M332 192 L368 198" width={10} tone="vein" />

          {/* Upper chambers */}
          <g ref={rightAtriumRef}>
            <path
              d="M110 211 C86 207 71 181 78 154 C84 132 104 120 126 124 C141 126 151 135 158 146 C171 150 181 160 179 172 C177 184 163 187 152 191 C140 203 126 213 110 211 Z"
              fill="url(#hb-atrium)"
              stroke="#ff6b57"
              strokeOpacity="0.45"
              strokeWidth="1.2"
            />
            <path
              d="M90 158 C94 144 106 134 122 133"
              fill="none"
              stroke="#ffd0c0"
              strokeOpacity="0.35"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#hb-blur-sm)"
            />
          </g>
          <g ref={leftAtriumRef}>
            <path
              d="M257 180 C260 162 279 151 299 153 C318 150 337 160 339 177 C341 193 327 204 309 205 C296 211 276 207 265 199 C258 193 255 186 257 180 Z"
              fill="url(#hb-atrium)"
              stroke="#ff6b57"
              strokeOpacity="0.45"
              strokeWidth="1.2"
            />
            <path
              d="M276 170 C290 162 308 162 322 170 M282 190 C296 196 312 196 326 188"
              fill="none"
              stroke="#3d0410"
              strokeOpacity="0.45"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>

          {/* Great arteries carrying blood away */}
          <g ref={arteriesRef}>
            <Tube d="M204 98 L192 50" width={13} pulse />
            <Tube d="M230 88 L230 42" width={12} pulse />
            <Tube d="M256 92 L269 52" width={12} pulse />
            <Tube d="M192 54 L180 34" width={6} pulse />
            <Tube d="M269 56 L284 38" width={6} pulse />
            <Tube
              d="M197 182 C186 142 190 102 222 91 C258 82 283 104 285 140"
              width={34}
              pulse
            />
            <Tube d="M300 137 C320 143 338 145 358 141" width={13} pulse />
            <Tube
              d="M233 198 C237 169 251 151 277 143 C301 136 323 128 350 111"
              width={28}
              pulse
            />
          </g>

          {/* Lower chambers */}
          <g ref={ventriclesRef}>
            <use
              href="#hb-body"
              fill="#ff2a2a"
              opacity="0.45"
              filter="url(#hb-blur-lg)"
            />
            <use href="#hb-body" fill="url(#hb-wall)" />
            <g clipPath="url(#hb-body-clip)">
              <g ref={coreRef}>
                <path
                  d="M150 214 C137 250 150 300 180 335 C200 358 216 373 229 377 C247 368 271 330 287 290 C299 255 297 225 281 205 C251 189 181 189 150 214 Z"
                  fill="url(#hb-core)"
                  filter="url(#hb-blur-md)"
                />
              </g>
              <g
                fill="none"
                stroke="#22030a"
                strokeLinecap="round"
                strokeOpacity="0.88"
              >
                {CORONARIES.map((vessel) => (
                  <path key={vessel.d} d={vessel.d} strokeWidth={vessel.w} />
                ))}
              </g>
              <g
                fill="none"
                stroke="#ff9d6b"
                strokeLinecap="round"
                strokeOpacity="0.35"
              >
                {CORONARIES.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    strokeWidth={vessel.w * 0.25}
                    transform="translate(-0.8 -0.6)"
                  />
                ))}
              </g>
              {/* Glassy highlights */}
              <path
                d="M131 220 C124 252 133 288 155 314"
                fill="none"
                stroke="#ffe3d6"
                strokeOpacity="0.28"
                strokeWidth="9"
                strokeLinecap="round"
                filter="url(#hb-blur-sm)"
              />
              <path
                d="M291 224 C297 252 292 284 278 310"
                fill="none"
                stroke="#ffb199"
                strokeOpacity="0.16"
                strokeWidth="7"
                strokeLinecap="round"
                filter="url(#hb-blur-sm)"
              />
            </g>
            <use
              href="#hb-body"
              fill="none"
              stroke="#ff7a63"
              strokeOpacity="0.55"
              strokeWidth="1.3"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
