"use client";

import { useEffect, useRef } from "react";
import { BloodFlow } from "@/components/BloodFlow";
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
  106, 200, 88, 232, 92, 282, 120, 322, 150, 356, 196, 388, 232, 404, 248, 410,
  264, 394, 282, 362, 308, 318, 328, 262, 318, 216, 310, 186, 276, 168, 242,
  170, 212, 162, 176, 160, 150, 168, 130, 172, 114, 184, 106, 200,
];
const BODY_CONTRACTED = [
  109, 201, 100, 232, 108, 278, 134, 314, 160, 344, 200, 372, 232, 388, 245,
  393, 258, 380, 272, 350, 292, 310, 308, 260, 304, 216, 298, 189, 272, 170,
  242, 171, 212, 163, 176, 161, 150, 169, 130, 173, 116, 185, 109, 201,
];

function bodyPath(squeeze: number): string {
  const p = BODY_RELAXED.map((v, i) => v + (BODY_CONTRACTED[i] - v) * squeeze);
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

/** "rich" carries oxygen-rich blood, "poor" carries oxygen-poor blood. */
type TubeTone = "rich" | "poor";

const TONES: Record<TubeTone, [string, string, string]> = {
  rich: ["#4a0710", "#b01822", "#ff8266"],
  poor: ["#2c0a26", "#7a1a44", "#d46a92"],
};

/** A vessel drawn as stacked strokes, which reads as a lit cylinder. */
function Tube({
  d,
  width,
  tone = "rich",
  pulse = false,
  cut = false,
}: {
  d: string;
  width: number;
  tone?: TubeTone;
  pulse?: boolean;
  /** Flat ends, for vessels that finish in a visible cut opening. */
  cut?: boolean;
}) {
  const [edge, mid, light] = TONES[tone];
  const w = (factor: number) =>
    pulse
      ? { strokeWidth: `calc(${width * factor}px * var(--pulse, 1))` }
      : { strokeWidth: width * factor };
  return (
    <g
      fill="none"
      strokeLinecap={cut ? "butt" : "round"}
      strokeLinejoin="round"
    >
      <path d={d} stroke={edge} style={w(1)} />
      <path d={d} stroke={mid} style={w(0.74)} opacity={0.55} />
      <path d={d} stroke={mid} style={w(0.46)} opacity={0.7} />
      <path
        d={d}
        stroke={light}
        style={w(0.12)}
        opacity={0.5}
        transform="translate(-1.2 -1)"
      />
    </g>
  );
}

/** The open end of a cut vessel: a dark lumen with a lit rim. */
function CutEnd({
  x,
  y,
  angle,
  width,
  tone = "rich",
}: {
  x: number;
  y: number;
  /** Direction the vessel is travelling at its end, in degrees. */
  angle: number;
  width: number;
  tone?: TubeTone;
}) {
  const [edge, mid, light] = TONES[tone];
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle + 90})`}>
      <ellipse
        rx={width / 2}
        ry={width * 0.2}
        fill={mid}
        stroke={edge}
        strokeWidth="0.8"
      />
      <ellipse rx={width * 0.36} ry={width * 0.12} fill="#16020a" />
      <path
        d={`M${-width * 0.36} ${-width * 0.02} A${width * 0.36} ${width * 0.12} 0 0 1 ${width * 0.36} ${-width * 0.02}`}
        fill="none"
        stroke={light}
        strokeOpacity="0.55"
        strokeWidth="0.9"
      />
    </g>
  );
}

/** Muscle fibres wrap the ventricles at a slant. Drawn as faint curved lines. */
const FIBRES: string[] = Array.from({ length: 16 }, (_, i) => {
  const y = 176 + i * 15;
  return `M84 ${y} Q206 ${y + 52} 334 ${y + 38}`;
});

interface SurfaceVessel {
  d: string;
  w: number;
}

/** Coronary arteries: the heart muscle's own blood supply. */
const CORONARIES: SurfaceVessel[] = [
  // Down the groove between the ventricles, toward the apex.
  { d: "M232 184 C222 222 227 268 224 308", w: 5 },
  { d: "M224 308 C222 344 227 372 235 396", w: 3.4 },
  { d: "M227 236 C246 252 262 262 277 290", w: 3.2 },
  { d: "M264 262 C273 262 281 259 287 252", w: 2 },
  { d: "M224 288 C240 304 252 320 260 346", w: 2.6 },
  { d: "M246 312 C258 314 266 310 273 302", w: 1.7 },
  { d: "M226 260 C206 278 192 290 176 318", w: 3 },
  { d: "M196 286 C186 284 176 278 168 268", w: 1.8 },
  { d: "M223 322 C209 336 201 346 194 362", w: 2.3 },
  // Along the right border.
  { d: "M152 180 C136 214 131 248 139 284 C144 304 156 322 170 338", w: 3.6 },
  { d: "M134 244 C150 256 160 268 168 292", w: 2.2 },
  { d: "M144 296 C156 300 166 310 174 324", w: 1.7 },
  // Around the left side.
  { d: "M240 186 C262 185 281 194 293 214 C299 238 296 264 289 288", w: 3.4 },
  { d: "M295 226 C287 238 282 252 280 270", w: 2 },
];

/** Cardiac veins, which run beside the arteries and drain the muscle. */
const CARDIAC_VEINS: SurfaceVessel[] = [
  { d: "M240 192 C232 230 236 272 233 310 C232 340 236 366 242 388", w: 2.6 },
  { d: "M236 250 C252 264 266 276 276 302", w: 1.8 },
  { d: "M160 186 C146 218 142 250 149 282", w: 2.2 },
  { d: "M286 204 C290 230 288 256 282 280", w: 1.8 },
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
  const rightAuricleRef = useRef<SVGGElement>(null);
  const leftAuricleRef = useRef<SVGGElement>(null);
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
      rightAuricleRef.current?.setAttribute(
        "transform",
        about(150, 180, atrial, atrial),
      );
      leftAuricleRef.current?.setAttribute(
        "transform",
        about(300, 200, atrial, atrial),
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
          <radialGradient id="hb-wall" cx="0.44" cy="0.32" r="0.8">
            <stop offset="0" stopColor="#d6262c" />
            <stop offset="0.42" stopColor="#9c1420" />
            <stop offset="0.78" stopColor="#560812" />
            <stop offset="1" stopColor="#270208" />
          </radialGradient>
          <radialGradient id="hb-bulge" cx="0.4" cy="0.35" r="0.6">
            <stop offset="0" stopColor="#ff8f7a" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#ff4a3a" stopOpacity="0.12" />
            <stop offset="1" stopColor="#ff4a3a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hb-shade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0.45" stopColor="#1a0206" stopOpacity="0" />
            <stop offset="1" stopColor="#1a0206" stopOpacity="0.6" />
          </linearGradient>
          <radialGradient id="hb-core" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#ffe1a0" />
            <stop offset="0.3" stopColor="#ffa23a" />
            <stop offset="0.65" stopColor="#ff4a1a" stopOpacity="0.75" />
            <stop offset="1" stopColor="#d0121c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hb-atrium" cx="0.42" cy="0.36" r="0.75">
            <stop offset="0" stopColor="#e2463e" />
            <stop offset="0.5" stopColor="#9a1420" />
            <stop offset="1" stopColor="#38040f" />
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
          <Tube d="M127 152 L121 72" width={26} tone="poor" />
          <Tube d="M120 78 L103 42" width={12} tone="poor" cut />
          <Tube d="M122 76 L137 38" width={12} tone="poor" cut />
          <CutEnd x={103} y={42} angle={-116.6} width={12} tone="poor" />
          <CutEnd x={137} y={38} angle={-67.4} width={12} tone="poor" />
          <Tube d="M330 172 L370 164" width={11} cut />
          <Tube d="M328 192 L368 198" width={10} cut />
          <CutEnd x={370} y={164} angle={-11.3} width={11} />
          <CutEnd x={368} y={198} angle={8.5} width={10} />

          {/* Upper chambers */}
          <g ref={rightAtriumRef}>
            <path
              d="M110 211 C86 207 71 181 78 154 C84 132 104 120 126 124 C141 126 151 135 158 146 C171 150 181 160 179 172 C177 184 163 187 152 191 C140 203 126 213 110 211 Z"
              fill="url(#hb-atrium)"
              stroke="#ff6b57"
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />
            <path
              d="M90 158 C94 144 106 134 122 133"
              fill="none"
              stroke="#ffd0c0"
              strokeOpacity="0.3"
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
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />
          </g>

          {/* Great arteries carrying blood away */}
          <g ref={arteriesRef}>
            <Tube d="M204 100 L192 50" width={13} pulse cut />
            <Tube d="M230 90 L230 42" width={12} pulse cut />
            <Tube d="M256 94 L269 52" width={12} pulse cut />
            <CutEnd x={192} y={50} angle={-104} width={13} />
            <CutEnd x={230} y={42} angle={-90} width={12} />
            <CutEnd x={269} y={52} angle={-72} width={12} />
            <Tube
              d="M197 182 C186 142 190 102 222 91 C258 82 283 104 285 140"
              width={34}
              pulse
            />
            <Tube
              d="M296 138 C318 143 338 145 358 141"
              width={13}
              tone="poor"
              pulse
              cut
            />
            <CutEnd x={358} y={141} angle={-11} width={13} tone="poor" />
            <Tube
              d="M233 198 C237 169 251 151 277 143 C301 136 323 128 350 111"
              width={28}
              tone="poor"
              pulse
              cut
            />
            <CutEnd x={350} y={111} angle={-32} width={28} tone="poor" />
          </g>

          {/* Lower chambers */}
          <g ref={ventriclesRef}>
            <use
              href="#hb-body"
              fill="#ff2a2a"
              opacity="0.4"
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
              {/* Each ventricle catches the light as its own rounded mass */}
              <ellipse
                cx="160"
                cy="262"
                rx="62"
                ry="92"
                fill="url(#hb-bulge)"
                transform="rotate(-14 160 262)"
              />
              <ellipse
                cx="276"
                cy="270"
                rx="56"
                ry="100"
                fill="url(#hb-bulge)"
                transform="rotate(12 276 270)"
                opacity="0.7"
              />
              <use href="#hb-body" fill="url(#hb-shade)" />
              {/* Muscle fibres */}
              <g fill="none" strokeLinecap="round">
                {FIBRES.map((d) => (
                  <path
                    key={d}
                    d={d}
                    stroke="#2a0308"
                    strokeOpacity="0.09"
                    strokeWidth="1.6"
                  />
                ))}
                {FIBRES.map((d) => (
                  <path
                    key={d}
                    d={d}
                    stroke="#ffb09a"
                    strokeOpacity="0.045"
                    strokeWidth="0.8"
                    transform="translate(0 -2)"
                  />
                ))}
              </g>
              {/* The groove between the two ventricles */}
              <path
                d="M234 180 C222 222 228 268 226 308 C224 344 229 372 237 398"
                fill="none"
                stroke="#1c0206"
                strokeOpacity="0.5"
                strokeWidth="15"
                strokeLinecap="round"
                filter="url(#hb-blur-sm)"
              />
              {/* Fat that pads the grooves where the vessels run */}
              <g fill="#f3c27a" opacity="0.42" filter="url(#hb-blur-sm)">
                <ellipse
                  cx="132"
                  cy="192"
                  rx="17"
                  ry="7"
                  transform="rotate(-24 132 192)"
                />
                <ellipse cx="170" cy="174" rx="18" ry="6" />
                <ellipse cx="212" cy="170" rx="18" ry="7" />
                <ellipse
                  cx="256"
                  cy="177"
                  rx="18"
                  ry="7"
                  transform="rotate(10 256 177)"
                />
                <ellipse
                  cx="294"
                  cy="196"
                  rx="13"
                  ry="7"
                  transform="rotate(36 294 196)"
                />
                <ellipse
                  cx="230"
                  cy="208"
                  rx="6"
                  ry="20"
                  transform="rotate(-6 230 208)"
                />
              </g>
              {/* Veins, then arteries on top */}
              <g fill="none" strokeLinecap="round">
                {CARDIAC_VEINS.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    stroke="#1a0616"
                    strokeOpacity="0.8"
                    strokeWidth={vessel.w + 1.2}
                  />
                ))}
                {CARDIAC_VEINS.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    stroke="#5d6fc4"
                    strokeOpacity="0.75"
                    strokeWidth={vessel.w * 0.6}
                  />
                ))}
                {CORONARIES.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    stroke="#22030a"
                    strokeOpacity="0.9"
                    strokeWidth={vessel.w + 1}
                  />
                ))}
                {CORONARIES.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    stroke="#d8242c"
                    strokeWidth={vessel.w * 0.62}
                  />
                ))}
                {CORONARIES.map((vessel) => (
                  <path
                    key={vessel.d}
                    d={vessel.d}
                    stroke="#ffb59a"
                    strokeOpacity="0.55"
                    strokeWidth={vessel.w * 0.18}
                    transform="translate(-0.7 -0.5)"
                  />
                ))}
              </g>
              {/* Wet highlights */}
              <path
                d="M131 220 C124 252 133 288 155 314"
                fill="none"
                stroke="#ffe3d6"
                strokeOpacity="0.3"
                strokeWidth="8"
                strokeLinecap="round"
                filter="url(#hb-blur-sm)"
              />
              <path
                d="M138 226 C134 244 136 262 144 278"
                fill="none"
                stroke="#ffffff"
                strokeOpacity="0.35"
                strokeWidth="2.2"
                strokeLinecap="round"
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
              strokeOpacity="0.5"
              strokeWidth="1.3"
            />
          </g>

          {/* Auricles: the small ear-shaped flaps of the atria, in front */}
          <g ref={rightAuricleRef}>
            <path
              d="M148 150 C161 144 185 151 193 166 C198 178 189 191 176 191 C167 197 155 193 149 185 C141 176 141 158 148 150 Z"
              fill="url(#hb-atrium)"
              stroke="#ff6b57"
              strokeOpacity="0.4"
              strokeWidth="1.1"
            />
            <path
              d="M156 160 C166 156 178 160 185 169 M154 172 C164 170 174 174 180 182"
              fill="none"
              stroke="#38040f"
              strokeOpacity="0.5"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
          <g ref={leftAuricleRef}>
            <path
              d="M262 186 C268 170 290 164 310 170 C326 174 334 186 328 198 C322 210 306 208 296 212 C284 216 270 212 264 204 C260 198 260 192 262 186 Z"
              fill="url(#hb-atrium)"
              stroke="#ff6b57"
              strokeOpacity="0.4"
              strokeWidth="1.1"
            />
            <path
              d="M274 184 C288 178 304 180 318 188 M276 198 C290 196 304 198 316 202"
              fill="none"
              stroke="#38040f"
              strokeOpacity="0.5"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>
      <BloodFlow clock={clock} />
    </div>
  );
}
