"use client";

import { useEffect, useRef } from "react";
import { BloodFlow } from "@/components/BloodFlow";
import type { BeatClock, BeatFrame } from "@/lib/beatClock";
import {
  atrialContraction,
  ejectionPulse,
  fillingFlow,
  getTiming,
  ventricularContraction,
} from "@/lib/cardiac";

/*
 * Fallback for browsers without WebGL: the original SVG heart. The main
 * heart is the 3D model in HeartVisual.
 *
 * The illustration is a front view of the heart, cut open, in the style of a
 * textbook diagram. The heart's right side is on the viewer's left.
 *
 * It is schematic: a real heart cannot show all four chambers, all four
 * valves and every great vessel in one flat slice, so (like most teaching
 * diagrams) structures that sit at different depths are drawn together.
 * The connections between them are the real ones.
 */

/**
 * A closed shape as cubic bezier points: start x, y, then six numbers per
 * segment. Relaxed and contracted versions share a structure so they can be
 * blended point by point.
 */
type Shape = readonly number[];

/** Outer wall of the two ventricles. */
const WALL_RELAXED: Shape = [
  112, 238, 100, 270, 110, 318, 142, 350, 170, 378, 210, 402, 246, 410, 264,
  412, 284, 392, 300, 360, 322, 318, 336, 268, 324, 232, 318, 214, 292, 204,
  264, 206, 230, 200, 196, 204, 170, 212, 146, 216, 122, 224, 112, 238,
];
const WALL_CONTRACTED: Shape = [
  115, 239, 110, 268, 122, 312, 152, 342, 178, 368, 214, 388, 246, 396, 260,
  398, 276, 380, 290, 350, 308, 312, 320, 266, 314, 232, 310, 216, 288, 206,
  264, 207, 230, 201, 196, 205, 170, 213, 146, 217, 124, 225, 115, 239,
];

/**
 * Right ventricle cavity. Thin wall, wraps part of the way round the left
 * ventricle, and narrows upward into the outflow tract that leads to the
 * pulmonary valve. The valve openings stay put while the walls move in.
 */
const RV_RELAXED: Shape = [
  124, 246, 116, 272, 124, 310, 150, 336, 170, 356, 196, 370, 216, 372, 218,
  340, 214, 296, 210, 262, 208, 240, 206, 224, 203, 212, 196, 212, 188, 212,
  181, 212, 176, 218, 150, 222, 124, 246,
];
const RV_CONTRACTED: Shape = [
  126, 246, 130, 268, 142, 298, 162, 318, 178, 334, 194, 344, 208, 344, 208,
  322, 206, 290, 204, 262, 203, 240, 203, 224, 203, 212, 196, 212, 188, 212,
  181, 212, 176, 218, 150, 222, 126, 246,
];

/**
 * Left ventricle cavity. Thick wall, forms the apex, and narrows upward
 * into the outflow tract that leads to the aortic valve.
 */
const LV_RELAXED: Shape = [
  228, 208, 226, 240, 234, 290, 238, 338, 240, 364, 246, 384, 252, 390, 266,
  380, 282, 352, 292, 320, 302, 288, 304, 256, 298, 232, 286, 224, 268, 224,
  256, 228, 252, 220, 250, 212, 248, 208,
];
const LV_CONTRACTED: Shape = [
  229, 208, 232, 238, 242, 282, 246, 320, 248, 340, 250, 354, 254, 360, 262,
  352, 272, 332, 278, 308, 286, 282, 292, 256, 296, 233, 284, 225, 268, 224,
  256, 228, 252, 220, 250, 212, 248, 208,
];

function blend(relaxed: Shape, contracted: Shape, amount: number): string {
  const p = relaxed.map((v, i) => v + (contracted[i] - v) * amount);
  let d = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  for (let i = 2; i < p.length; i += 6) {
    d += ` C${p[i].toFixed(1)} ${p[i + 1].toFixed(1)} ${p[i + 2].toFixed(1)} ${p[i + 3].toFixed(1)} ${p[i + 4].toFixed(1)} ${p[i + 5].toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Uniform scale about a fixed point, as an SVG transform attribute. */
function scaleAbout(px: number, py: number, scale: number): string {
  return `translate(${px} ${py}) scale(${scale.toFixed(4)}) translate(${-px} ${-py})`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** "rich" carries oxygen-rich blood, "poor" carries oxygen-poor blood. */
type Tone = "rich" | "poor";

const TONES: Record<Tone, [string, string, string]> = {
  rich: ["#4a0710", "#b01822", "#ff8266"],
  poor: ["#141a44", "#2f43a0", "#8fa6ff"],
};

/** A vessel drawn as stacked strokes, which reads as a lit cylinder. */
function Tube({
  d,
  width,
  tone,
  pulse = false,
}: {
  d: string;
  width: number;
  tone: Tone;
  /** Arteries swell a little as each beat pushes blood into them. */
  pulse?: boolean;
}) {
  const [edge, mid, light] = TONES[tone];
  const w = (factor: number) =>
    pulse
      ? { strokeWidth: `calc(${width * factor}px * var(--pulse, 1))` }
      : { strokeWidth: width * factor };
  return (
    <g fill="none" strokeLinecap="butt" strokeLinejoin="round">
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
  tone,
}: {
  x: number;
  y: number;
  /** Direction the vessel points at this end, in degrees. */
  angle: number;
  width: number;
  tone: Tone;
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
      <ellipse rx={width * 0.36} ry={width * 0.12} fill="#0d0208" />
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

interface Leaflet {
  /** Where the leaflet is attached. */
  hx: number;
  hy: number;
  /** Free edge when the valve is closed. */
  tx: number;
  ty: number;
  /** Rotation when fully open, in degrees. */
  openDeg: number;
}

/**
 * The four valves, each as two leaflets that meet in the middle when shut.
 * Atrioventricular valves swing down into the ventricle to open.
 * Semilunar valves swing up into the artery to open.
 */
const AV_LEAFLETS: Leaflet[] = [
  // Tricuspid: right atrium -> right ventricle
  { hx: 126, hy: 245, tx: 150, ty: 232.5, openDeg: 58 },
  { hx: 173, hy: 220, tx: 149, ty: 232.5, openDeg: -58 },
  // Mitral: left atrium -> left ventricle
  { hx: 256, hy: 228, tx: 277.5, ty: 230, openDeg: 60 },
  { hx: 298, hy: 232, tx: 276.5, ty: 230, openDeg: -60 },
];
const SEMILUNAR_LEAFLETS: Leaflet[] = [
  // Pulmonary: right ventricle -> pulmonary artery
  { hx: 181, hy: 212, tx: 192.5, ty: 212, openDeg: -64 },
  { hx: 203, hy: 212, tx: 191.5, ty: 212, openDeg: 64 },
  // Aortic: left ventricle -> aorta
  { hx: 228, hy: 208, tx: 238.5, ty: 208, openDeg: -64 },
  { hx: 248, hy: 208, tx: 237.5, ty: 208, openDeg: 64 },
];

export interface HeartLabels {
  rightAtrium: string;
  rightVentricle: string;
  leftAtrium: string;
  leftVentricle: string;
}

/** Numbered markers, matched by the key under the illustration. */
const VESSEL_MARKERS: { n: number; x: number; y: number }[] = [
  { n: 1, x: 128, y: 88 },
  { n: 2, x: 92, y: 300 },
  { n: 3, x: 322, y: 129 },
  { n: 3, x: 82, y: 138 },
  { n: 4, x: 354, y: 186 },
  { n: 4, x: 52, y: 187 },
  { n: 5, x: 238, y: 81 },
];

function ChamberLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const lines = text.split(" ");
  return (
    <text
      x={x}
      y={y - (lines.length - 1) * 6}
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
        <tspan key={line} x={x} dy={index === 0 ? 0 : 12}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function HeartDiagram({
  clock,
  label,
  labels,
}: {
  clock: BeatClock;
  label: string;
  labels: HeartLabels;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const heartRef = useRef<SVGGElement>(null);
  const wallRef = useRef<SVGPathElement>(null);
  const rvRef = useRef<SVGPathElement>(null);
  const lvRef = useRef<SVGPathElement>(null);
  const rightAtriumRef = useRef<SVGGElement>(null);
  const leftAtriumRef = useRef<SVGGElement>(null);
  const rightAtriumCavityRef = useRef<SVGPathElement>(null);
  const leftAtriumCavityRef = useRef<SVGPathElement>(null);
  const avValvesRef = useRef<SVGGElement>(null);
  const semilunarValvesRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const floorRef = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const amount = reduceMotion ? 0.45 : 1;
    // Valve positions are eased so leaflets swing instead of snapping.
    let avOpen = 1;
    let semilunarOpen = 0;

    const setLeaflets = (
      group: SVGGElement | null,
      leaflets: Leaflet[],
      open: number,
    ) => {
      if (!group) return;
      leaflets.forEach((leaflet, index) => {
        group.children[index]?.setAttribute(
          "transform",
          `rotate(${(leaflet.openDeg * open).toFixed(2)} ${leaflet.hx} ${leaflet.hy})`,
        );
      });
    };

    const apply = (frame: BeatFrame) => {
      const timing = getTiming(frame.shapeBpm);
      const tMs = frame.phase * timing.periodMs;
      const atria = atrialContraction(tMs, timing) * amount;
      const vent = ventricularContraction(tMs, timing) * amount;
      const eject = ejectionPulse(tMs, timing) * amount;

      // Ventricles: the outer wall moves in a little, the cavities shrink a
      // lot, so the muscle visibly thickens as it squeezes. The late atrial
      // push stretches them slightly just before they fire.
      const squeeze = vent - atria * 0.1;
      wallRef.current?.setAttribute(
        "d",
        blend(WALL_RELAXED, WALL_CONTRACTED, squeeze),
      );
      rvRef.current?.setAttribute("d", blend(RV_RELAXED, RV_CONTRACTED, squeeze));
      lvRef.current?.setAttribute("d", blend(LV_RELAXED, LV_CONTRACTED, squeeze));

      // Atria: squeeze before the ventricles, then swell as they refill
      // while the ventricles are contracting.
      const atrialWall = 1 - 0.05 * atria + 0.02 * vent;
      const atrialCavity = 1 - 0.24 * atria + 0.07 * vent;
      rightAtriumRef.current?.setAttribute(
        "transform",
        scaleAbout(132, 214, atrialWall),
      );
      leftAtriumRef.current?.setAttribute(
        "transform",
        scaleAbout(284, 208, atrialWall),
      );
      rightAtriumCavityRef.current?.setAttribute(
        "transform",
        scaleAbout(134, 208, atrialCavity),
      );
      leftAtriumCavityRef.current?.setAttribute(
        "transform",
        scaleAbout(284, 200, atrialCavity),
      );

      // Valves. The tricuspid and mitral valves are open while the ventricles
      // fill and shut while they contract. The pulmonary and aortic valves
      // do the opposite.
      const ease = Math.min(1, frame.dtMs / 55);
      avOpen += (clamp01(fillingFlow(tMs, timing) * 3) - avOpen) * ease;
      semilunarOpen +=
        (clamp01(ejectionPulse(tMs, timing) * 4) - semilunarOpen) * ease;
      setLeaflets(avValvesRef.current, AV_LEAFLETS, avOpen);
      setLeaflets(
        semilunarValvesRef.current,
        SEMILUNAR_LEAFLETS,
        semilunarOpen,
      );

      // Great arteries widen as blood is pushed into them.
      heartRef.current?.style.setProperty(
        "--pulse",
        (1 + 0.07 * eject).toFixed(4),
      );

      heartRef.current?.setAttribute(
        "transform",
        `translate(0 ${(-1.5 * vent + 1 * atria).toFixed(2)})`,
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
          ringRef.current.setAttribute("r", (130 + 90 * u).toFixed(1));
          ringRef.current.style.opacity = (0.26 * (1 - u) * (1 - u)).toFixed(3);
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

  const leaflet = (item: Leaflet) => (
    <line
      key={`${item.hx}-${item.hy}`}
      x1={item.hx}
      y1={item.hy}
      x2={item.tx}
      y2={item.ty}
    />
  );

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
          <radialGradient id="hb-muscle" cx="0.45" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#c8504a" />
            <stop offset="0.45" stopColor="#96262c" />
            <stop offset="0.8" stopColor="#5a0f18" />
            <stop offset="1" stopColor="#2c050c" />
          </radialGradient>
          <radialGradient id="hb-atrium" cx="0.42" cy="0.34" r="0.8">
            <stop offset="0" stopColor="#c4544c" />
            <stop offset="0.55" stopColor="#8a2228" />
            <stop offset="1" stopColor="#3a0810" />
          </radialGradient>
          <radialGradient id="hb-blood-poor" cx="0.45" cy="0.35" r="0.75">
            <stop offset="0" stopColor="#4a5cc8" />
            <stop offset="0.6" stopColor="#2a3186" />
            <stop offset="1" stopColor="#141646" />
          </radialGradient>
          <radialGradient id="hb-blood-rich" cx="0.45" cy="0.35" r="0.75">
            <stop offset="0" stopColor="#ff4a3c" />
            <stop offset="0.6" stopColor="#c2101c" />
            <stop offset="1" stopColor="#5c0610" />
          </radialGradient>
          <radialGradient id="hb-floor" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ff5a2a" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="#d0121c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#d0121c" stopOpacity="0" />
          </radialGradient>
          <filter id="hb-blur-lg" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id="hb-blur-sm" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <ellipse
          ref={floorRef}
          cx="214"
          cy="424"
          rx="150"
          ry="12"
          fill="url(#hb-floor)"
        />
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

        <g ref={heartRef}>
          {/* Soft light behind the whole heart */}
          <path
            d={blend(WALL_RELAXED, WALL_CONTRACTED, 0)}
            fill="#ff2a2a"
            opacity="0.35"
            filter="url(#hb-blur-lg)"
          />

          {/* Right pulmonary artery: runs behind the aorta and the superior
              vena cava on its way to the right lung */}
          <g>
            <Tube
              d="M218 146 C180 140 110 138 50 138"
              width={18}
              tone="poor"
              pulse
            />
            <CutEnd x={50} y={138} angle={180} width={18} tone="poor" />
          </g>

          {/* Pulmonary veins: two from each lung, all four into the left
              atrium. The right pair passes behind the right atrium. */}
          <Tube d="M38 174 L104 178" width={11} tone="rich" />
          <Tube d="M38 200 L104 200" width={11} tone="rich" />
          <CutEnd x={38} y={174} angle={183} width={11} tone="rich" />
          <CutEnd x={38} y={200} angle={180} width={11} tone="rich" />
          <Tube d="M372 170 L326 181" width={11} tone="rich" />
          <Tube d="M370 200 L326 200" width={11} tone="rich" />
          <CutEnd x={372} y={170} angle={-13} width={11} tone="rich" />
          <CutEnd x={370} y={200} angle={0} width={11} tone="rich" />

          {/* Venae cavae: both empty into the right atrium */}
          <Tube d="M128 50 L128 172" width={24} tone="poor" />
          <CutEnd x={128} y={50} angle={-90} width={24} tone="poor" />
          <Tube d="M92 346 L95 228" width={22} tone="poor" />
          <CutEnd x={92} y={346} angle={90} width={22} tone="poor" />

          {/* Back wall joining the two atria, behind the great arteries */}
          <path d="M168 166 L250 162 L250 214 L168 218 Z" fill="#3a0a12" />

          {/* Aorta: rises from the left ventricle behind the pulmonary
              trunk, arches over it, gives off three branches, then runs
              down behind the heart */}
          <g>
            <Tube d="M204 100 L196 52" width={12} tone="rich" pulse />
            <Tube d="M232 90 L232 44" width={11} tone="rich" pulse />
            <Tube d="M258 92 L268 52" width={11} tone="rich" pulse />
            <CutEnd x={196} y={52} angle={-99} width={12} tone="rich" />
            <CutEnd x={232} y={44} angle={-90} width={11} tone="rich" />
            <CutEnd x={268} y={52} angle={-76} width={11} tone="rich" />
            <Tube
              d="M238 210 C234 184 204 168 197 140 C192 112 200 88 228 82 C262 76 288 100 290 130 L290 176"
              width={28}
              tone="rich"
              pulse
            />
            {/* Left pulmonary artery: passes under the arch to the left lung */}
            <Tube
              d="M214 146 C250 134 300 130 352 128"
              width={18}
              tone="poor"
              pulse
            />
            <CutEnd x={352} y={128} angle={-2} width={18} tone="poor" />
          </g>

          {/* Upper chambers */}
          <g ref={rightAtriumRef}>
            <path
              d="M82 238 C66 214 68 176 92 158 C112 144 152 146 170 160 C184 172 188 198 180 216 C162 224 132 232 116 242 C104 247 90 246 82 238 Z"
              fill="url(#hb-atrium)"
              stroke="#ff8a76"
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />
            <path
              ref={rightAtriumCavityRef}
              d="M90 231 C79 212 81 182 98 168 C116 156 148 158 162 168 C174 178 176 197 170 211 C154 219 130 225 114 233 C105 237 96 237 90 231 Z"
              fill="url(#hb-blood-poor)"
              stroke="#b7c2ff"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          </g>
          <g ref={leftAtriumRef}>
            <path
              d="M240 210 C231 190 237 166 258 155 C282 145 318 149 332 168 C344 185 340 210 327 225 C306 216 270 210 240 210 Z"
              fill="url(#hb-atrium)"
              stroke="#ff8a76"
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />
            <path
              ref={leftAtriumCavityRef}
              d="M248 203 C241 188 247 172 262 164 C282 156 312 159 324 172 C332 185 330 203 321 216 C303 209 272 205 248 203 Z"
              fill="url(#hb-blood-rich)"
              stroke="#ffc0b0"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          </g>

          {/* Lower chambers: muscle wall, with the septum left between the
              two cavities */}
          <path
            ref={wallRef}
            d={blend(WALL_RELAXED, WALL_CONTRACTED, 0)}
            fill="url(#hb-muscle)"
            stroke="#ff8a76"
            strokeOpacity="0.45"
            strokeWidth="1.3"
          />
          <path
            ref={rvRef}
            d={blend(RV_RELAXED, RV_CONTRACTED, 0)}
            fill="url(#hb-blood-poor)"
            stroke="#b7c2ff"
            strokeOpacity="0.4"
            strokeWidth="1"
          />
          <path
            ref={lvRef}
            d={blend(LV_RELAXED, LV_CONTRACTED, 0)}
            fill="url(#hb-blood-rich)"
            stroke="#ffc0b0"
            strokeOpacity="0.4"
            strokeWidth="1"
          />

          {/* Pulmonary trunk: leaves the right ventricle and crosses in
              front of the aorta before it divides */}
          <g>
            <Tube
              d="M192 213 C194 188 204 164 218 144"
              width={26}
              tone="poor"
              pulse
            />
          </g>

          {/* Valves */}
          <g
            ref={avValvesRef}
            stroke="#fff0e6"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            {AV_LEAFLETS.map(leaflet)}
          </g>
          <g
            ref={semilunarValvesRef}
            stroke="#fff0e6"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            {SEMILUNAR_LEAFLETS.map(leaflet)}
          </g>
        </g>
      </svg>

      <BloodFlow clock={clock} />

      {/* Names sit above the moving blood so they stay readable */}
      <svg
        viewBox="0 0 400 440"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <ChamberLabel x={130} y={200} text={labels.rightAtrium} />
        <ChamberLabel x={288} y={190} text={labels.leftAtrium} />
        <ChamberLabel x={166} y={296} text={labels.rightVentricle} />
        <ChamberLabel x={268} y={300} text={labels.leftVentricle} />
        {VESSEL_MARKERS.map((marker) => (
          <g key={`${marker.n}-${marker.x}`}>
            <circle
              cx={marker.x}
              cy={marker.y}
              r="7.5"
              fill="#0b0508"
              fillOpacity="0.9"
              stroke="#f4eae7"
              strokeOpacity="0.8"
              strokeWidth="0.9"
            />
            <text
              x={marker.x}
              y={marker.y + 3.4}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="700"
              fill="#f4eae7"
            >
              {marker.n}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
