/**
 * Worker for the mesh builder: evaluates the distance field and bakes
 * per-vertex data in parallel.
 */
import { parentPort } from "node:worker_threads";
import { parts, sdf } from "./heart-sdf.mjs";
import { motionWeights, smoothstep } from "../src/lib/heart3d/anatomy.ts";

function gradient(x, y, z) {
  const e = 0.35;
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
  const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
  const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

// Fixed hemisphere directions for ambient occlusion rays.
const RAYS = [];
{
  const n = 14;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n; // cos theta in 0..1 (upper hemisphere)
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    RAYS.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
}

function basis(n) {
  const a = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let t = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const l = Math.hypot(...t);
  t = t.map((v) => v / l);
  const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return [t, b];
}

/** Fraction of light reaching the point, 0 (buried) .. 1 (open). */
function ambient(p, n) {
  // Near-field: samples along the normal.
  let near = 0;
  let wsum = 0;
  for (const h of [1.5, 4, 8, 14, 22]) {
    const d = sdf(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h);
    const w = 1 / h;
    near += (Math.max(0, h - Math.max(d, 0)) / h) * w;
    wsum += w;
  }
  near = 1 - near / wsum;
  // Far-field: short rays over the hemisphere.
  const [t, b] = basis(n);
  let open = 0;
  let total = 0;
  for (const r of RAYS) {
    const dir = [
      t[0] * r[0] + n[0] * r[1] + b[0] * r[2],
      t[1] * r[0] + n[1] * r[1] + b[1] * r[2],
      t[2] * r[0] + n[2] * r[1] + b[2] * r[2],
    ];
    const weight = r[1];
    let s = 2.5;
    let hit = 0;
    for (let k = 0; k < 18 && s < 90; k++) {
      const d = sdf(p[0] + dir[0] * s, p[1] + dir[1] * s, p[2] + dir[2] * s);
      if (d < 0.4) {
        hit = 1 - s / 90;
        break;
      }
      s += Math.max(d, 1.2);
    }
    open += (1 - hit) * weight;
    total += weight;
  }
  return Math.min(near, 1) * 0.45 + (open / total) * 0.55;
}

/** How thin the tissue is behind the surface: 1 = thin sheet, 0 = solid. */
function thinness(p, n) {
  let inside = 0;
  for (const h of [3, 7, 12, 18]) {
    const d = sdf(p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h);
    inside += d < 0 ? 1 : 0;
  }
  return 1 - inside / 4;
}

function softWeights(values, sharp) {
  const m = Math.min(...values);
  const w = values.map((v) => Math.exp(-(v - m) / sharp));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
}

function bake(positions) {
  const n = positions.length / 3;
  const outPos = new Float32Array(n * 3);
  const outNorm = new Float32Array(n * 3);
  // 4 bytes each: A cut/inner/fat/side, B vRich/vPoor/corA/corV,
  // C atrium/ao/thin/pap, W lv/rv/ra/la. Plus art xyz floats.
  const attr = new Uint8Array(n * 16);
  const art = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = positions[i * 3];
    let y = positions[i * 3 + 1];
    let z = positions[i * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = sdf(x, y, z);
      if (Math.abs(d) < 1e-3) break;
      const g = gradient(x, y, z);
      x -= g[0] * d;
      y -= g[1] * d;
      z -= g[2] * d;
    }
    const nrm = gradient(x, y, z);
    outPos.set([x, y, z], i * 3);
    outNorm.set(nrm, i * 3);

    const q = parts(x, y, z);
    // Which boundary is this surface: outside, a cavity wall, or a cut face?
    const [wOuter, wInner, wCut] = softWeights([Math.abs(q.outer), Math.abs(q.cav), Math.abs(q.cut)], 0.9);
    // On the outside: which tissue is outermost here.
    const [, wRich, wPoor, wFat, wCorA, wCorV] = softWeights(
      [q.body, q.vRich, q.vPoor, q.fatD, q.corA, q.corV],
      0.7,
    );
    const side = smoothstep(-5, 5, q.left - q.right); // 1 = right heart (oxygen-poor)
    const ao = ambient([x, y, z], nrm);
    const thin = thinness([x, y, z], nrm);
    const pap = smoothstep(2.5, 0, Math.abs(q.pap));
    const m = motionWeights(x, y, z);
    const atrium = Math.min(1, m.ra + m.la);

    const b = i * 16;
    const u8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    attr[b] = u8(wCut);
    attr[b + 1] = u8(wInner);
    attr[b + 2] = u8(wFat * wOuter);
    attr[b + 3] = u8(side);
    attr[b + 4] = u8(wRich * wOuter);
    attr[b + 5] = u8(wPoor * wOuter);
    attr[b + 6] = u8(wCorA * wOuter);
    attr[b + 7] = u8(wCorV * wOuter);
    attr[b + 8] = u8(atrium);
    attr[b + 9] = u8(ao);
    attr[b + 10] = u8(thin);
    attr[b + 11] = u8(pap);
    attr[b + 12] = u8(m.lv);
    attr[b + 13] = u8(m.rv);
    attr[b + 14] = u8(m.ra);
    attr[b + 15] = u8(m.la);
    art[i * 3] = m.artX;
    art[i * 3 + 1] = m.artY;
    art[i * 3 + 2] = m.artZ;
  }
  return { outPos, outNorm, attr, art };
}

parentPort.on("message", (msg) => {
  if (msg.type === "eval") {
    const pts = msg.points;
    const out = new Float32Array(pts.length / 3);
    for (let i = 0; i < out.length; i++) out[i] = sdf(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    parentPort.postMessage({ id: msg.id, values: out }, [out.buffer]);
  } else if (msg.type === "bake") {
    const r = bake(msg.positions);
    parentPort.postMessage({ id: msg.id, ...r }, [r.outPos.buffer, r.outNorm.buffer, r.attr.buffer, r.art.buffer]);
  }
});
