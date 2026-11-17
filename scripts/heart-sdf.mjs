/**
 * Signed distance model of the heart, used only by the offline mesh builder.
 * Units and axes follow src/lib/heart3d/anatomy.ts (SVG space, y down,
 * z toward the viewer).
 */
import {
  LA_CAVITY,
  LA_OUTER,
  LV_CAVITY,
  LV_OUTER,
  PAPILLARY,
  RA_CAVITY,
  RA_OUTER,
  RV_CAVITY,
  RV_OUTER,
  SECTION_Z,
  SEPTUM,
  VENT_BASE,
  VESSELS,
  samplePath,
  sdEllipsoid,
  smoothstep,
} from "../src/lib/heart3d/anatomy.ts";

// ------------------------------------------------------------------ noise

const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}
/** Improved Perlin noise, roughly -1..1. */
export function noise(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = perm[X] + Y;
  const AA = perm[A] + Z;
  const AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y;
  const BA = perm[B] + Z;
  const BB = perm[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
      lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Distance to the nearest random feature point (cellular noise). */
function worley(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let f1 = 9;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++) {
        const cx = xi + i;
        const cy = yi + j;
        const cz = zi + k;
        const fx = cx + hash3(cx, cy, cz) - x;
        const fy = cy + hash3(cx + 7, cy + 3, cz + 11) - y;
        const fz = cz + hash3(cx + 13, cy + 17, cz + 5) - z;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < f1) f1 = d;
      }
  return Math.sqrt(f1);
}

// ----------------------------------------------------------- sdf helpers

export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);
const E = (x, y, z, e) => sdEllipsoid(x, y, z, e);

function capsule(x, y, z, a, b, r0, r1) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const px = x - a[0];
  const py = y - a[1];
  const pz = z - a[2];
  const h = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (r0 + (r1 - r0) * h);
}

/** A tube along sampled path data (x, y, z, r per sample). */
class Tube {
  constructor(samples, radiusOffset = 0) {
    this.s = samples;
    this.off = radiusOffset;
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    let rMax = 0;
    for (let i = 0; i < samples.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], samples[i + k]);
        mx[k] = Math.max(mx[k], samples[i + k]);
      }
      rMax = Math.max(rMax, samples[i + 3] + radiusOffset);
    }
    this.mn = mn.map((v) => v - rMax);
    this.mx = mx.map((v) => v + rMax);
  }
  dist(x, y, z) {
    const dx = Math.max(this.mn[0] - x, 0, x - this.mx[0]);
    const dy = Math.max(this.mn[1] - y, 0, y - this.mx[1]);
    const dz = Math.max(this.mn[2] - z, 0, z - this.mx[2]);
    const box = Math.hypot(dx, dy, dz);
    if (box > 20) return box;
    const s = this.s;
    let best = Infinity;
    for (let i = 0; i < s.length - 4; i += 4) {
      const ax = s[i];
      const ay = s[i + 1];
      const az = s[i + 2];
      const bx = s[i + 4] - ax;
      const by = s[i + 5] - ay;
      const bz = s[i + 6] - az;
      const px = x - ax;
      const py = y - ay;
      const pz = z - az;
      const len2 = bx * bx + by * by + bz * bz || 1;
      let h = (px * bx + py * by + pz * bz) / len2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const r = s[i + 3] + (s[i + 7] - s[i + 3]) * h + this.off;
      const d = Math.hypot(px - bx * h, py - by * h, pz - bz * h) - r;
      if (d < best) best = d;
    }
    return best;
  }
}

/** Extend a path past its last point so a lumen pierces the cut end. */
function extend(points, by) {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const t = [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
  return [...points, [b[0] + t[0] * by, b[1] + t[1] * by, b[2] + t[2] * by, b[3]]];
}

const vessels = VESSELS.map((v) => {
  const outer = new Tube(samplePath(v.points, 2.5));
  const lumen = new Tube(samplePath(v.openEnd ? extend(v.points, 12) : v.points, 2.5), -v.wall);
  const a = v.points[v.points.length - 2];
  const b = v.points[v.points.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const end = { p: b, t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len] };
  return { spec: v, outer, lumen, end };
});

// -------------------------------------------------------------- anatomy+

const R_AURICLE = { c: [168, 178, 30], r: [30, 17, 17], rot: -0.55 };
const R_AURICLE_CAV = { c: [166, 179, 28], r: [24, 11, 11], rot: -0.55 };
const L_AURICLE = { c: [334, 222, 4], r: [26, 13, 15], rot: 0.75 };
const L_AURICLE_CAV = { c: [332, 220, 2], r: [20, 8, 9], rot: 0.75 };
/** Fat cushion around the roots of the great arteries. */
const ROOT_FAT = { c: [214, 222, 34], r: [44, 15, 26], rot: 0.08 };

const ORIFICES = [
  // tricuspid, mitral
  [[128, 210, -2], [160, 258, 8], 17],
  [[302, 204, -14], [282, 254, -18], 16],
  // right ventricular outflow -> pulmonary valve
  [[184, 282, 12], [193, 214, 24], 15],
  // left ventricular outflow -> aortic valve
  [[262, 262, -14], [238, 214, -10], 15],
];

/** Body without fat or coronaries, used to place those on the surface. */
function bodyRaw(x, y, z) {
  const vent = smin(smin(E(x, y, z, LV_OUTER), E(x, y, z, RV_OUTER), 34), E(x, y, z, VENT_BASE), 34);
  const ra = smin(E(x, y, z, RA_OUTER), E(x, y, z, R_AURICLE), 12);
  const la = smin(E(x, y, z, LA_OUTER), E(x, y, z, L_AURICLE), 10);
  return smin(vent, Math.min(ra, la), 14);
}
function bodyNoisy(x, y, z) {
  // Atria are softer and less regular than the ventricles.
  const atrial = 1 - smoothstep(214, 246, y);
  return (
    bodyRaw(x, y, z) +
    (1.6 + 2.4 * atrial) * noise(x * 0.022, y * 0.022, z * 0.022) +
    (0.5 + 0.6 * atrial) * noise(x * 0.07, y * 0.07, z * 0.07)
  );
}
/** Bulges at the arterial roots: the aortic and pulmonary sinuses. */
const AORTIC_SINUS = { c: [234, 206, -9], r: [27, 18, 27] };
const PULMONARY_SINUS = { c: [194, 210, 24], r: [24, 15, 23] };

function vesselOuter(x, y, z, blood) {
  let d = Infinity;
  if (blood !== "poor") d = E(x, y, z, AORTIC_SINUS);
  if (blood !== "rich") d = Math.min(d, E(x, y, z, PULMONARY_SINUS));
  // Real vessels are never perfect cylinders.
  const wobble = 1.1 * noise(x * 0.035 + 5, y * 0.035, z * 0.035);
  for (const v of vessels) {
    if (blood && v.spec.blood !== blood) continue;
    let t = v.outer.dist(x, y, z);
    if (v.spec.openEnd && t < 20) {
      const { p, t: n } = v.end;
      t = Math.max(t, (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2]);
    }
    d = smin(d, t, 5);
  }
  return d + wobble;
}
function baseOuter(x, y, z) {
  return smin(bodyNoisy(x, y, z), vesselOuter(x, y, z), 8);
}

// ---------------------------------------- grooves: fat and coronary vessels

function gradAt(f, x, y, z) {
  const e = 0.5;
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
/** Pull path points onto a surface, then lift them along its normal. */
function snapPath(points, f, lift, radius) {
  const dense = samplePath(points.map((p) => [...p, radius]), 4);
  for (let i = 0; i < dense.length; i += 4) {
    let x = dense[i];
    let y = dense[i + 1];
    let z = dense[i + 2];
    for (let it = 0; it < 12; it++) {
      const d = f(x, y, z);
      const g = gradAt(f, x, y, z);
      x -= g[0] * d;
      y -= g[1] * d;
      z -= g[2] * d;
    }
    const g = gradAt(f, x, y, z);
    dense[i] = x + g[0] * lift;
    dense[i + 1] = y + g[1] * lift;
    dense[i + 2] = z + g[2] * lift;
  }
  return dense;
}

const GROOVES = {
  // Right coronary artery in the right atrioventricular groove.
  rca: [[200, 226, 52], [164, 240, 62], [128, 250, 54], [104, 262, 28], [92, 276, -10], [100, 288, -50]],
  acuteMarginal: [[104, 262, 30], [116, 306, 50], [146, 346, 52], [192, 384, 38], [234, 404, 12]],
  // Left anterior descending in the anterior interventricular groove.
  lad: [[226, 226, 54], [222, 262, 72], [228, 310, 70], [240, 356, 56], [254, 394, 30], [262, 414, 0]],
  circumflex: [[244, 226, 42], [290, 234, 40], [332, 248, 12], [344, 264, -22], [334, 278, -62]],
  obtuseMarginal: [[336, 252, 6], [342, 302, 2], [326, 352, -6], [300, 392, -8]],
  greatCardiacVein: [[238, 232, 50], [234, 266, 72], [242, 312, 68], [252, 354, 54], [264, 390, 28]],
  smallCardiacVein: [[110, 270, 24], [100, 290, -8], [104, 302, -46]],
  anteriorCardiacVein: [[150, 254, 62], [138, 290, 66], [134, 322, 56]],
};

const FAT_PATHS = [
  [GROOVES.rca, 11],
  [GROOVES.lad, 9.5],
  [GROOVES.circumflex, 10],
  [GROOVES.acuteMarginal.slice(0, 3), 7],
  [GROOVES.obtuseMarginal.slice(0, 3), 6],
];

const fatTubes = FAT_PATHS.map(([pts, r]) => new Tube(snapPath(pts, baseOuter, 0, r)));
const CAVAL_FAT = { c: [132, 160, 4], r: [27, 10, 25] };
const APEX_FAT = { c: [250, 404, 6], r: [18, 8, 16], rot: -0.4 };
function fat(x, y, z) {
  let d = Math.min(E(x, y, z, ROOT_FAT), E(x, y, z, CAVAL_FAT), E(x, y, z, APEX_FAT));
  for (const t of fatTubes) d = smin(d, t.dist(x, y, z), 10);
  if (d > 12) return d;
  // Lobulated surface, like real epicardial fat.
  const w = worley(x * 0.13, y * 0.13, z * 0.13);
  return d + 2.6 * (w - 0.55) + 0.8 * noise(x * 0.3, y * 0.3, z * 0.3);
}
function withFat(x, y, z) {
  return smin(baseOuter(x, y, z), fat(x, y, z), 6);
}

const coronaryArteries = [
  [GROOVES.rca, 3.8],
  [GROOVES.lad, 3.6],
  [GROOVES.circumflex, 3.4],
  [GROOVES.acuteMarginal, 2.4],
  [GROOVES.obtuseMarginal, 2.4],
].map(([pts, r]) => new Tube(snapPath(pts, withFat, r * 0.3, r)));
const coronaryVeins = [
  [GROOVES.greatCardiacVein, 3.6],
  [GROOVES.smallCardiacVein, 3],
  [GROOVES.anteriorCardiacVein, 2.6],
].map(([pts, r]) => new Tube(snapPath(pts, withFat, r * 0.2, r)));

function minTubes(list, x, y, z) {
  let d = Infinity;
  for (const t of list) d = Math.min(d, t.dist(x, y, z));
  return d;
}

// ------------------------------------------------------------ cavities

/** Trabeculae carneae: a mesh of muscular ridges lining the ventricles. */
function trabeculae(x, y, z) {
  const mask = smoothstep(240, 300, y);
  if (mask <= 0) return 0;
  const a = 1 - Math.abs(noise(x * 0.075, y * 0.026, z * 0.075));
  const b = 1 - Math.abs(noise(x * 0.05 + y * 0.03 + 9, y * 0.05, z * 0.05 + 3));
  return (6 * a ** 6 + 2.2 * b ** 8) * mask;
}

function chamberCavities(x, y, z) {
  const lvRaw = E(x, y, z, LV_CAVITY);
  const lv = lvRaw + trabeculae(x, y, z);
  let rv = E(x, y, z, RV_CAVITY) + trabeculae(x + 40, y, z + 13) * 0.8;
  rv = smax(rv, -(lvRaw - SEPTUM), 8);
  // Pectinate muscles: parallel ridges on the inner wall of the right atrium.
  const pect = 1 - Math.abs(noise(x * 0.11 + y * 0.02, y * 0.012, z * 0.11));
  const ra = smin(E(x, y, z, RA_CAVITY), E(x, y, z, R_AURICLE_CAV), 8) + 3.2 * pect ** 6;
  const la = smin(E(x, y, z, LA_CAVITY), E(x, y, z, L_AURICLE_CAV), 6);
  const [tri, mit, rvo, lvo] = ORIFICES.map(([a, b, r]) => capsule(x, y, z, a, b, r, r));
  const right = smin(smin(ra, rv, 4), Math.min(tri, rvo), 6);
  const left = smin(Math.min(lv, la), Math.min(mit, lvo), 6);
  return { right, left };
}

function lumens(x, y, z) {
  let rich = E(x, y, z, { c: AORTIC_SINUS.c, r: AORTIC_SINUS.r.map((v) => v - 5) });
  let poor = E(x, y, z, { c: PULMONARY_SINUS.c, r: PULMONARY_SINUS.r.map((v) => v - 4.6) });
  for (const v of vessels) {
    const d = v.lumen.dist(x, y, z);
    if (v.spec.blood === "rich") rich = Math.min(rich, d);
    else poor = Math.min(poor, d);
  }
  return { rich, poor };
}

// -------------------------------------------------------------- windows

/**
 * The section: everything in front of a gently uneven plane is removed,
 * but only within the heart itself, so the great vessels above it stay
 * whole and the section opens all four chambers and both arterial roots.
 */
function cutter(x, y, z) {
  const plane =
    SECTION_Z + 2.6 * noise(x * 0.018, y * 0.018, 7.7) + 1.0 * noise(x * 0.06, y * 0.06, 2.3) + 0.35 * noise(x * 0.2, y * 0.2, 1.1) - z;
  // The heart, its fat and its coronary vessels are cut; the great vessels
  // beyond the heart are not.
  const tissue = Math.min(bodyRaw(x, y, z) - 3, fat(x, y, z) - 2, minTubes(coronaryArteries, x, y, z) - 2, minTubes(coronaryVeins, x, y, z) - 2);
  return smax(plane, tissue, 6);
}

function papillary(x, y, z) {
  let d = Infinity;
  for (const p of PAPILLARY) d = smin(d, capsule(x, y, z, p.base, p.tip, p.r0, p.r1), 4);
  // Moderator band: a muscle bundle across the right ventricle from the
  // septum to the base of its anterior papillary muscle.
  d = smin(d, capsule(x, y, z, [214, 318, -4], [156, 322, -4], 4.2, 3.6), 5);
  return d;
}

// ----------------------------------------------------------------- scene

/** Full breakdown at a point, for classification. */
export function parts(x, y, z) {
  const body = bodyNoisy(x, y, z);
  const vRich = vesselOuter(x, y, z, "rich");
  const vPoor = vesselOuter(x, y, z, "poor");
  const fatD = fat(x, y, z);
  const corA = minTubes(coronaryArteries, x, y, z);
  const corV = minTubes(coronaryVeins, x, y, z);
  let outer = smin(body, Math.min(vRich, vPoor), 8);
  outer = smin(outer, fatD, 6);
  outer = smin(outer, Math.min(corA, corV), 1.5);

  const ch = chamberCavities(x, y, z);
  const raw = bodyRaw(x, y, z);
  // Chamber cavities may never come closer than this to the outside.
  const chamberRight = Math.max(ch.right, raw + 5);
  const chamberLeft = Math.max(ch.left, raw + 6);
  const lu = lumens(x, y, z);
  const right = Math.min(chamberRight, lu.poor);
  const left = Math.min(chamberLeft, lu.rich);
  const cav = Math.min(right, left);

  let solid = smax(outer, -cav, 1.2);
  const pap = papillary(x, y, z);
  solid = smin(solid, pap, 6);
  const cut = cutter(x, y, z);
  solid = smax(solid, -cut, 2.5);
  return { solid, outer, body, vRich, vPoor, fatD, corA, corV, cav, right, left, cut, pap };
}

export function sdf(x, y, z) {
  return parts(x, y, z).solid;
}

/** Quick lower-cost bound used to skip empty space during the coarse pass. */
export const BOUNDS = { min: [14, 14, -128], max: [394, 428, 92] };
