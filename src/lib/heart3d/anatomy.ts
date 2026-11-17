/**
 * Shared anatomy for the 3D heart.
 *
 * Everything is authored in the same space as the original 400 x 440 SVG
 * illustration: x to the viewer's right, y DOWN, z toward the viewer. The
 * heart's right side is on the viewer's left. The renderer flips y when it
 * places the model in the scene.
 *
 * This file has no imports so the offline mesh builder
 * (scripts/build-heart-mesh.mjs) and the browser share one definition of
 * the chambers, vessels, blood routes and the beat deformation.
 */

export type Vec3 = [number, number, number];
/** x, y, z, radius */
export type PathPoint = [number, number, number, number];

export type Blood = "rich" | "poor";

export interface Ellipsoid {
  c: Vec3;
  r: Vec3;
  /** Rotation in the x/y plane, radians. */
  rot?: number;
}

export interface VesselSpec {
  id: string;
  blood: Blood;
  /** Arteries swell with each ejection. */
  artery: boolean;
  /** Wall thickness. */
  wall: number;
  /** Ordered from the heart outward. The last point is a cut, open end. */
  points: PathPoint[];
  openEnd: boolean;
}

// ---------------------------------------------------------------- chambers

export const LV_OUTER: Ellipsoid = { c: [268, 308, -16], r: [74, 114, 70], rot: 0.1 };
export const LV_CAVITY: Ellipsoid = { c: [270, 302, -14], r: [34, 84, 36], rot: 0.1 };
export const RV_OUTER: Ellipsoid = { c: [184, 292, 10], r: [86, 68, 64], rot: -0.34 };
export const RV_CAVITY: Ellipsoid = { c: [178, 288, 14], r: [72, 55, 50], rot: -0.34 };
/** Broad base of the ventricles, under the atria. */
export const VENT_BASE: Ellipsoid = { c: [222, 246, -8], r: [112, 42, 76] };
export const RA_OUTER: Ellipsoid = { c: [124, 198, -4], r: [46, 43, 45] };
export const RA_CAVITY: Ellipsoid = { c: [124, 198, -4], r: [39, 36, 38] };
export const LA_OUTER: Ellipsoid = { c: [302, 190, -12], r: [42, 33, 38] };
export const LA_CAVITY: Ellipsoid = { c: [302, 190, -12], r: [35, 26, 31] };

/** Septum thickness between the two ventricle cavities. */
export const SEPTUM = 22;

/** Valve rings: centre, axis pointing in the direction of flow, ring radius. */
export interface ValveSpec {
  id: "tricuspid" | "mitral" | "pulmonary" | "aortic";
  center: Vec3;
  axis: Vec3;
  radius: number;
  cusps: number;
  /** Leaflet length as a fraction of the ring radius. */
  length: number;
  /** Atrioventricular valves open with filling, semilunar with ejection. */
  kind: "av" | "semilunar";
  /** Rotation of the cusp pattern around the axis, radians. */
  spin: number;
}

export const VALVES: ValveSpec[] = [
  { id: "tricuspid", center: [146, 236, 4], axis: [0.5, 0.84, 0.2], radius: 17, cusps: 3, length: 1.45, kind: "av", spin: 0.4 },
  { id: "mitral", center: [290, 230, -16], axis: [-0.32, 0.9, 0.3], radius: 16, cusps: 2, length: 1.55, kind: "av", spin: 1.2 },
  { id: "pulmonary", center: [193, 220, 24], axis: [0.15, -0.97, 0.18], radius: 16, cusps: 3, length: 1.0, kind: "semilunar", spin: 0.2 },
  { id: "aortic", center: [236, 220, -8], axis: [-0.18, -0.98, 0], radius: 17, cusps: 3, length: 1.0, kind: "semilunar", spin: 0.9 },
];

/** Papillary muscles: base on the ventricle floor, tip where chordae attach. */
export interface Papillary {
  base: Vec3;
  tip: Vec3;
  r0: number;
  r1: number;
  valve: ValveSpec["id"];
}

export const PAPILLARY: Papillary[] = [
  { base: [296, 372, -28], tip: [294, 300, -20], r0: 11, r1: 5, valve: "mitral" },
  { base: [252, 370, -36], tip: [262, 302, -30], r0: 10, r1: 5, valve: "mitral" },
  { base: [150, 326, -4], tip: [150, 282, 0], r0: 8, r1: 4, valve: "tricuspid" },
  { base: [196, 334, -6], tip: [190, 284, -2], r0: 8, r1: 4, valve: "tricuspid" },
];

// ----------------------------------------------------------------- vessels

export const VESSELS: VesselSpec[] = [
  {
    id: "svc", blood: "poor", artery: false, wall: 4.6, openEnd: true,
    points: [[124, 172, -4, 19], [126, 120, -6, 19.5], [126, 70, -6, 19.5], [126, 30, -6, 19.5]],
  },
  {
    id: "ivc", blood: "poor", artery: false, wall: 4.6, openEnd: true,
    points: [[112, 236, -16, 18], [104, 286, -34, 18], [99, 330, -42, 18], [97, 372, -44, 18]],
  },
  {
    id: "aorta", blood: "rich", artery: true, wall: 5.2, openEnd: true,
    points: [
      [238, 224, -10, 21], [230, 188, -8, 22.5], [214, 152, -6, 23], [208, 116, -10, 23],
      [222, 88, -22, 22.5], [252, 78, -34, 22], [282, 92, -50, 21], [296, 128, -68, 20],
      [300, 190, -88, 19], [302, 290, -100, 18],
    ],
  },
  {
    id: "brachiocephalic", blood: "rich", artery: true, wall: 4.2, openEnd: true,
    points: [[214, 104, -14, 12.5], [206, 72, -14, 11.5], [200, 46, -15, 11], [197, 26, -16, 11]],
  },
  {
    id: "carotid", blood: "rich", artery: true, wall: 4.2, openEnd: true,
    points: [[240, 88, -26, 8.5], [240, 58, -28, 8], [240, 22, -28, 8]],
  },
  {
    id: "subclavian", blood: "rich", artery: true, wall: 4.2, openEnd: true,
    points: [[264, 90, -40, 9.5], [271, 60, -42, 9], [279, 26, -44, 9]],
  },
  {
    id: "pulmonaryTrunk", blood: "poor", artery: true, wall: 4.6, openEnd: false,
    points: [[193, 224, 24, 20], [198, 190, 32, 21.5], [210, 162, 30, 21.5], [226, 144, 14, 19]],
  },
  {
    id: "leftPulmonaryArtery", blood: "poor", artery: true, wall: 4.2, openEnd: true,
    points: [[224, 146, 16, 15], [268, 132, -2, 15], [316, 128, -14, 14.5], [364, 130, -22, 14]],
  },
  {
    id: "rightPulmonaryArtery", blood: "poor", artery: true, wall: 4.2, openEnd: true,
    points: [
      [224, 146, 16, 15], [220, 140, -18, 15], [198, 138, -60, 15], [150, 138, -56, 14.5],
      [92, 140, -46, 14], [40, 142, -36, 14],
    ],
  },
  {
    id: "pvRightUpper", blood: "rich", artery: false, wall: 4.2, openEnd: true,
    points: [[312, 184, -14, 10], [346, 178, -18, 10], [378, 170, -22, 10]],
  },
  {
    id: "pvRightLower", blood: "rich", artery: false, wall: 4.2, openEnd: true,
    points: [[312, 200, -16, 10], [346, 206, -20, 10], [376, 212, -24, 10]],
  },
  {
    id: "pvLeftUpper", blood: "rich", artery: false, wall: 4.2, openEnd: true,
    points: [[284, 186, -30, 10], [220, 182, -66, 10], [110, 178, -74, 10], [36, 176, -62, 10]],
  },
  {
    id: "pvLeftLower", blood: "rich", artery: false, wall: 4.2, openEnd: true,
    points: [[284, 198, -32, 10], [220, 202, -68, 10], [110, 206, -76, 10], [36, 208, -64, 10]],
  },
];

// ------------------------------------------------------------- math helpers

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Approximate signed distance to a (possibly rotated) ellipsoid. */
export function sdEllipsoid(x: number, y: number, z: number, e: Ellipsoid): number {
  let px = x - e.c[0];
  let py = y - e.c[1];
  const pz = z - e.c[2];
  if (e.rot) {
    const c = Math.cos(-e.rot);
    const s = Math.sin(-e.rot);
    const rx = c * px - s * py;
    py = s * px + c * py;
    px = rx;
  }
  const [a, b, cc] = e.r;
  const k0 = Math.hypot(px / a, py / b, pz / cc);
  const k1 = Math.hypot(px / (a * a), py / (b * b), pz / (cc * cc));
  if (k1 < 1e-9) return -Math.min(a, b, cc);
  return (k0 * (k0 - 1)) / k1;
}

/**
 * Catmull-Rom path through the control points, resampled to roughly even
 * spacing. Returns flat arrays of x, y, z, radius.
 */
export function samplePath(points: PathPoint[], spacing = 3): Float32Array {
  const dense: PathPoint[] = [];
  const at = (i: number) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = 24;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const out = [0, 0, 0, 0] as PathPoint;
      for (let k = 0; k < 4; k++) {
        out[k] =
          0.5 *
          (2 * p1[k] +
            (p2[k] - p0[k]) * u +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
            (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3);
      }
      dense.push(out);
    }
  }
  dense.push([...points[points.length - 1]] as PathPoint);
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths[lengths.length - 1];
  const n = Math.max(2, Math.ceil(total / spacing) + 1);
  const out = new Float32Array(n * 4);
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (j < dense.length - 1 && lengths[j] < target) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const u = (target - lengths[j - 1]) / span;
    for (let k = 0; k < 4; k++) {
      out[i * 4 + k] = dense[j - 1][k] + (dense[j][k] - dense[j - 1][k]) * u;
    }
  }
  return out;
}

/** Closest point on a sampled path: returns distance to the axis and index. */
export function nearestOnPath(
  samples: Float32Array,
  x: number,
  y: number,
  z: number,
  out: { d: number; cx: number; cy: number; cz: number; r: number; t: number },
): void {
  const n = samples.length / 4;
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const ax = samples[i * 4];
    const ay = samples[i * 4 + 1];
    const az = samples[i * 4 + 2];
    const bx = samples[i * 4 + 4] - ax;
    const by = samples[i * 4 + 5] - ay;
    const bz = samples[i * 4 + 6] - az;
    const px = x - ax;
    const py = y - ay;
    const pz = z - az;
    const len2 = bx * bx + by * by + bz * bz || 1;
    const h = clamp((px * bx + py * by + pz * bz) / len2, 0, 1);
    const dx = px - bx * h;
    const dy = py - by * h;
    const dz = pz - bz * h;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {
      best = d2;
      out.cx = ax + bx * h;
      out.cy = ay + by * h;
      out.cz = az + bz * h;
      out.r = samples[i * 4 + 3] + (samples[i * 4 + 7] - samples[i * 4 + 3]) * h;
      out.t = (i + h) / (n - 1);
    }
  }
  out.d = Math.sqrt(best);
}

export const VESSEL_SAMPLES: Record<string, Float32Array> = Object.fromEntries(
  VESSELS.map((v) => [v.id, samplePath(v.points, 2.5)]),
);

// ------------------------------------------------------------------ motion

/**
 * How much each part of the beat moves a point at rest position p.
 * lv, rv: ventricles. ra, la: atria. art*: outward vector of an artery
 * wall (already scaled by its radius), for the pulse.
 */
export interface MotionWeights {
  lv: number;
  rv: number;
  ra: number;
  la: number;
  artX: number;
  artY: number;
  artZ: number;
}

const ARTERY_IDS = ["aorta", "pulmonaryTrunk", "leftPulmonaryArtery", "rightPulmonaryArtery", "brachiocephalic", "carotid", "subclavian"];

const scratch = { d: 0, cx: 0, cy: 0, cz: 0, r: 0, t: 0 };

export function motionWeights(x: number, y: number, z: number): MotionWeights {
  // Below the atrioventricular plane belongs to the ventricles.
  const below = smoothstep(206, 240, y + (x - 220) * 0.05);
  const dl = sdEllipsoid(x, y, z, LV_OUTER);
  const dr = sdEllipsoid(x, y, z, RV_OUTER);
  const db = sdEllipsoid(x, y, z, VENT_BASE);
  const nearVent = smoothstep(26, -6, Math.min(dl, dr, db));
  // Split between the two ventricles by which cavity is closer.
  const cl = sdEllipsoid(x, y, z, LV_CAVITY);
  const cr = sdEllipsoid(x, y, z, RV_CAVITY);
  const share = smoothstep(-14, 14, cr - cl);
  let lv = nearVent * below * share;
  let rv = nearVent * below * (1 - share);

  const ra = smoothstep(22, -4, sdEllipsoid(x, y, z, RA_OUTER)) * (1 - below * 0.8);
  const la = smoothstep(22, -4, sdEllipsoid(x, y, z, LA_OUTER)) * (1 - below * 0.8);
  const total = lv + rv + ra + la;
  if (total > 1) {
    lv /= total;
    rv /= total;
  }

  let artX = 0;
  let artY = 0;
  let artZ = 0;
  let bestArt = Infinity;
  for (const id of ARTERY_IDS) {
    nearestOnPath(VESSEL_SAMPLES[id], x, y, z, scratch);
    const excess = scratch.d - scratch.r;
    if (excess < bestArt && excess < 8) {
      bestArt = excess;
      const w = smoothstep(8, 0, excess) * smoothstep(0, 0.12, scratch.t);
      const inv = scratch.d > 1e-3 ? 1 / scratch.d : 0;
      artX = (x - scratch.cx) * inv * scratch.r * w;
      artY = (y - scratch.cy) * inv * scratch.r * w;
      artZ = (z - scratch.cz) * inv * scratch.r * w;
    }
  }
  return { lv, rv, ra, la, artX, artY, artZ };
}

/** Beat state, all 0..1, from the timing model in lib/cardiac. */
export interface BeatState {
  vent: number;
  atria: number;
  eject: number;
}

interface Axis {
  base: Vec3;
  apex: Vec3;
  /** Cavity area removed at full squeeze, as r^2 units. */
  squeeze: number;
  /** Base-to-apex shortening, units. */
  shorten: number;
  /** Torsion, radians, apex relative to base. */
  twist: number;
}

export const LV_AXIS: Axis = { base: [276, 222, -14], apex: [260, 404, -14], squeeze: 500, shorten: 15, twist: 0.12 };
export const RV_AXIS: Axis = { base: [168, 236, 16], apex: [214, 368, 10], squeeze: 640, shorten: 12, twist: 0.08 };
export const RA_CENTER: Vec3 = RA_CAVITY.c;
export const LA_CENTER: Vec3 = LA_CAVITY.c;
export const ATRIUM_VOLUME = 42 * 42 * 42;
/** Fraction of ATRIUM_VOLUME the atria lose when they squeeze... */
export const ATRIAL_SQUEEZE = 0.14;
/** ...and gain while the ventricles contract and the atria refill. */
export const ATRIAL_FILL = 0.06;
/** Depth of the section plane that opens the heart (see the mesh builder). */
export const SECTION_Z = 2;
/** Point the whole heart rocks around during systole. */
export const PIVOT: Vec3 = [214, 250, -10];

/**
 * Contraction of one ventricle around its long axis. Myocardium barely
 * changes volume, so each ring of muscle keeps its cross-section area:
 * r'^2 = r^2 - squeeze. Inner layers move far more than outer ones and the
 * wall visibly thickens, the way a real ventricle does.
 */
function ventricle(p: Vec3, ax: Axis, c: number, out: Vec3): void {
  const ux = ax.apex[0] - ax.base[0];
  const uy = ax.apex[1] - ax.base[1];
  const uz = ax.apex[2] - ax.base[2];
  const len = Math.hypot(ux, uy, uz);
  const nx = ux / len;
  const ny = uy / len;
  const nz = uz / len;
  const vx = p[0] - ax.base[0];
  const vy = p[1] - ax.base[1];
  const vz = p[2] - ax.base[2];
  const along = vx * nx + vy * ny + vz * nz;
  const t = along / len;
  let rx = vx - nx * along;
  let ry = vy - ny * along;
  let rz = vz - nz * along;
  const r = Math.hypot(rx, ry, rz);
  const tc = clamp(t, 0, 1);
  const profile = clamp(1 - ((tc - 0.42) / 0.66) ** 2, 0, 1);
  const delta = c * ax.squeeze * profile;
  const r2 = Math.sqrt(Math.max(r * r - delta, 0.16 * r * r));
  const f = r > 1e-4 ? r2 / r : 1;
  rx *= f;
  ry *= f;
  rz *= f;
  // Torsion: rotate the radial vector about the long axis.
  const angle = c * ax.twist * (tc - 0.3);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  // Rodrigues with k = n, v = r (r is perpendicular to n).
  const kx = ny * rz - nz * ry;
  const ky = nz * rx - nx * rz;
  const kz = nx * ry - ny * rx;
  rx = rx * cs + kx * sn;
  ry = ry * cs + ky * sn;
  rz = rz * cs + kz * sn;
  const shift = c * ax.shorten * (1 - tc);
  const a2 = along + shift;
  out[0] = ax.base[0] + nx * a2 + rx;
  out[1] = ax.base[1] + ny * a2 + ry;
  out[2] = ax.base[2] + nz * a2 + rz;
}

function atrium(p: Vec3, center: Vec3, amount: number, out: Vec3): void {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const dz = p[2] - center[2];
  const r = Math.hypot(dx, dy, dz);
  const r3 = r * r * r;
  const target = Math.cbrt(Math.max(r3 - amount * ATRIUM_VOLUME, 0.07 * r3));
  const f = r > 1e-4 ? target / r : 1;
  out[0] = center[0] + dx * f;
  out[1] = center[1] + dy * f;
  out[2] = center[2] + dz * f;
}

const tmpL: Vec3 = [0, 0, 0];
const tmpR: Vec3 = [0, 0, 0];
const tmpA: Vec3 = [0, 0, 0];
const tmpB: Vec3 = [0, 0, 0];

/**
 * Rest position -> position at this moment of the beat. The GLSL version
 * in shaders.ts must stay identical.
 */
export function deform(p: Vec3, w: MotionWeights, s: BeatState, out: Vec3): Vec3 {
  ventricle(p, LV_AXIS, s.vent, tmpL);
  ventricle(p, RV_AXIS, s.vent, tmpR);
  // Atria squeeze with their own beat and fill (swell) while the
  // ventricles contract.
  const atrialAmount = ATRIAL_SQUEEZE * s.atria - ATRIAL_FILL * s.vent;
  atrium(p, RA_CENTER, atrialAmount, tmpA);
  atrium(p, LA_CENTER, atrialAmount, tmpB);
  let x = p[0] + w.lv * (tmpL[0] - p[0]) + w.rv * (tmpR[0] - p[0]) + w.ra * (tmpA[0] - p[0]) + w.la * (tmpB[0] - p[0]);
  let y = p[1] + w.lv * (tmpL[1] - p[1]) + w.rv * (tmpR[1] - p[1]) + w.ra * (tmpA[1] - p[1]) + w.la * (tmpB[1] - p[1]);
  let z = p[2] + w.lv * (tmpL[2] - p[2]) + w.rv * (tmpR[2] - p[2]) + w.ra * (tmpA[2] - p[2]) + w.la * (tmpB[2] - p[2]);
  // The atrioventricular plane is pulled toward the apex during systole,
  // dragging the atria down with it.
  const pull = (w.ra + w.la) * s.vent * 5;
  y += pull;
  // Arteries swell as blood is pushed into them.
  const swell = s.eject * 0.075;
  x += w.artX * swell;
  y += w.artY * swell;
  z += w.artZ * swell;
  // The whole heart rocks slightly and lifts its apex as it squeezes.
  const rock = -0.03 * s.vent;
  const cs = Math.cos(rock);
  const sn = Math.sin(rock);
  const dx = x - PIVOT[0];
  const dy = y - PIVOT[1];
  out[0] = PIVOT[0] + dx * cs - dy * sn;
  out[1] = PIVOT[1] + dx * sn + dy * cs - 2.5 * s.vent + 1.2 * s.atria;
  out[2] = z + 3 * s.vent;
  return out;
}

// ------------------------------------------------------------------ view

/** Model turned slightly so its left side catches the light. Radians. */
export const YAW = -0.36;
/** Camera raised slightly above the heart. Radians. */
export const PITCH = 0.07;
/** Direction from the model toward the camera, in model (SVG) space. */
export const VIEW_DIR: Vec3 = [
  -Math.cos(PITCH) * Math.sin(YAW),
  -Math.sin(PITCH),
  Math.cos(PITCH) * Math.cos(YAW),
];

// ------------------------------------------------------------ blood routes

export type FlowKind = "return" | "fill" | "eject";

export interface RouteSpec {
  kind: FlowKind;
  blood: Blood;
  /** Half-width of the stream. */
  spread: number;
  count: number;
  points: Vec3[];
}

const vesselPath = (id: string): Vec3[] => {
  const v = VESSELS.find((item) => item.id === id);
  if (!v) throw new Error(id);
  return v.points.map(([x, y, z]) => [x, y, z] as Vec3);
};
const inward = (id: string) => vesselPath(id).reverse();

const RA_POOL: Vec3 = [120, 204, -8];
const LA_POOL: Vec3 = [302, 196, -18];
const RV_FLOOR: Vec3 = [176, 324, 0];
const LV_FLOOR: Vec3 = [268, 362, -18];
const RV_OUT: Vec3[] = [RV_FLOOR, [184, 296, 6], [189, 264, 14], [193, 236, 22]];
const LV_OUT: Vec3[] = [LV_FLOOR, [266, 316, -16], [258, 268, -14], [242, 232, -10]];

/**
 * Blood paths, matching the original 2D routes. Systemic: left ventricle
 * -> aorta -> body -> venae cavae -> right atrium. Pulmonary: right
 * ventricle -> pulmonary artery -> lungs -> pulmonary veins -> left atrium.
 */
export const ROUTES: RouteSpec[] = [
  { kind: "return", blood: "poor", spread: 9, count: 14, points: [...inward("svc"), RA_POOL] },
  { kind: "return", blood: "poor", spread: 8, count: 12, points: [...inward("ivc"), RA_POOL] },
  {
    kind: "fill", blood: "poor", spread: 10, count: 22,
    points: [RA_POOL, [134, 222, -4], [148, 242, 2], [160, 270, 4], [170, 300, 2], RV_FLOOR],
  },
  { kind: "eject", blood: "poor", spread: 8, count: 18, points: [...RV_OUT, ...vesselPath("pulmonaryTrunk").slice(1), ...vesselPath("leftPulmonaryArtery").slice(1)] },
  { kind: "eject", blood: "poor", spread: 8, count: 18, points: [...RV_OUT, ...vesselPath("pulmonaryTrunk").slice(1), ...vesselPath("rightPulmonaryArtery").slice(1)] },
  { kind: "return", blood: "rich", spread: 4, count: 7, points: [...inward("pvRightUpper"), LA_POOL] },
  { kind: "return", blood: "rich", spread: 4, count: 7, points: [...inward("pvRightLower"), LA_POOL] },
  { kind: "return", blood: "rich", spread: 4, count: 9, points: [...inward("pvLeftUpper"), LA_POOL] },
  { kind: "return", blood: "rich", spread: 4, count: 9, points: [...inward("pvLeftLower"), LA_POOL] },
  {
    kind: "fill", blood: "rich", spread: 9, count: 22,
    points: [LA_POOL, [296, 214, -18], [288, 238, -18], [280, 274, -16], [272, 320, -16], LV_FLOOR],
  },
  { kind: "eject", blood: "rich", spread: 10, count: 22, points: [...LV_OUT, ...vesselPath("aorta")] },
  { kind: "eject", blood: "rich", spread: 4, count: 9, points: [...LV_OUT, ...vesselPath("aorta").slice(0, 4), ...vesselPath("brachiocephalic")] },
  { kind: "eject", blood: "rich", spread: 3, count: 8, points: [...LV_OUT, ...vesselPath("aorta").slice(0, 5), ...vesselPath("carotid")] },
  { kind: "eject", blood: "rich", spread: 3, count: 8, points: [...LV_OUT, ...vesselPath("aorta").slice(0, 6), ...vesselPath("subclavian")] },
];
