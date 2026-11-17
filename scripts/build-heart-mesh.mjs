/**
 * Builds public/heart/heart.bin: the 3D heart as a compressed mesh.
 *
 * The heart is sculpted as a signed distance field (scripts/heart-sdf.mjs),
 * meshed with surface nets, then every vertex gets baked data: ambient
 * occlusion, tissue thickness, which tissue it is (muscle, fat, vessel,
 * cut face, chamber lining) and how it moves with the beat.
 *
 *   node scripts/build-heart-mesh.mjs            # full quality
 *   node scripts/build-heart-mesh.mjs --cell=3   # quick preview
 */
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { BOUNDS, sdf } from "./heart-sdf.mjs";
import { ROUTES, VIEW_DIR, samplePath } from "../src/lib/heart3d/anatomy.ts";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const CELL = arg("cell", 1.5);
const OUT = new URL("../public/heart/heart.bin", import.meta.url);

const started = Date.now();
const log = (...m) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...m);

// --------------------------------------------------------------- workers

const pool = Array.from({ length: Math.max(1, cpus().length - 1) }, () => {
  const w = new Worker(new URL("./heart-worker.mjs", import.meta.url));
  w.pending = new Map();
  w.on("message", (m) => {
    w.pending.get(m.id)(m);
    w.pending.delete(m.id);
  });
  return w;
});
let nextId = 0;
function run(worker, msg) {
  const id = nextId++;
  return new Promise((resolve) => {
    worker.pending.set(id, resolve);
    worker.postMessage({ ...msg, id });
  });
}
async function evalPoints(points) {
  const n = points.length / 3;
  const chunk = Math.ceil(n / (pool.length * 6));
  const jobs = [];
  for (let s = 0, j = 0; s < n; s += chunk, j++) {
    const part = points.slice(s * 3, Math.min(n, s + chunk) * 3);
    jobs.push(run(pool[j % pool.length], { type: "eval", points: part }).then((m) => [s, m.values]));
  }
  const out = new Float32Array(n);
  for (const [s, values] of await Promise.all(jobs)) out.set(values, s);
  return out;
}

// ------------------------------------------------------------------ grid

const [x0, y0, z0] = BOUNDS.min;
const nx = Math.ceil((BOUNDS.max[0] - x0) / CELL) + 1;
const ny = Math.ceil((BOUNDS.max[1] - y0) / CELL) + 1;
const nz = Math.ceil((BOUNDS.max[2] - z0) / CELL) + 1;
const idx = (i, j, k) => i + nx * (j + ny * k);
log(`grid ${nx} x ${ny} x ${nz}, cell ${CELL}`);

// Coarse pass, then exact values only near the surface.
const C = 4;
const cx = Math.ceil((nx - 1) / C) + 1;
const cy = Math.ceil((ny - 1) / C) + 1;
const cz = Math.ceil((nz - 1) / C) + 1;
const coarsePts = new Float32Array(cx * cy * cz * 3);
for (let k = 0, p = 0; k < cz; k++)
  for (let j = 0; j < cy; j++)
    for (let i = 0; i < cx; i++, p += 3) {
      coarsePts[p] = x0 + i * C * CELL;
      coarsePts[p + 1] = y0 + j * C * CELL;
      coarsePts[p + 2] = z0 + k * C * CELL;
    }
const coarse = await evalPoints(coarsePts);
log("coarse pass done");
const cidx = (i, j, k) => i + cx * (j + cy * k);
const band = C * CELL * 1.9;

const field = new Float32Array(nx * ny * nz);
const exact = [];
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const fi = i / C;
      const fj = j / C;
      const fk = k / C;
      const i0 = Math.min(cx - 2, Math.floor(fi));
      const j0 = Math.min(cy - 2, Math.floor(fj));
      const k0 = Math.min(cz - 2, Math.floor(fk));
      const u = fi - i0;
      const v = fj - j0;
      const w = fk - k0;
      let near = false;
      let val = 0;
      for (let c = 0; c < 8; c++) {
        const di = c & 1;
        const dj = (c >> 1) & 1;
        const dk = (c >> 2) & 1;
        const d = coarse[cidx(i0 + di, j0 + dj, k0 + dk)];
        if (Math.abs(d) < band) near = true;
        val += d * (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w);
      }
      field[idx(i, j, k)] = val;
      if (near) exact.push(idx(i, j, k));
    }
log(`exact evaluations: ${exact.length}`);
{
  const pts = new Float32Array(exact.length * 3);
  exact.forEach((id, n) => {
    const i = id % nx;
    const j = Math.floor(id / nx) % ny;
    const k = Math.floor(id / (nx * ny));
    pts[n * 3] = x0 + i * CELL;
    pts[n * 3 + 1] = y0 + j * CELL;
    pts[n * 3 + 2] = z0 + k * CELL;
  });
  const vals = await evalPoints(pts);
  exact.forEach((id, n) => (field[id] = vals[n]));
}
log("fine pass done");

// ---------------------------------------------------------- surface nets

const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const cellIdx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
const positions = [];
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const vals = new Float32Array(8);
for (let k = 0; k < nz - 1; k++)
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const [a, b, d] = CORNERS[c];
        vals[c] = field[idx(i + a, j + b, k + d)];
        if (vals[c] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let count = 0;
      for (const [a, b] of EDGES) {
        if (vals[a] < 0 === vals[b] < 0) continue;
        const t = vals[a] / (vals[a] - vals[b]);
        const ca = CORNERS[a];
        const cb = CORNERS[b];
        sx += ca[0] + (cb[0] - ca[0]) * t;
        sy += ca[1] + (cb[1] - ca[1]) * t;
        sz += ca[2] + (cb[2] - ca[2]) * t;
        count++;
      }
      cellVertex[cellIdx(i, j, k)] = positions.length / 3;
      positions.push(x0 + (i + sx / count) * CELL, y0 + (j + sy / count) * CELL, z0 + (k + sz / count) * CELL);
    }
const quads = [];
for (let k = 1; k < nz - 1; k++)
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const inside = field[idx(i, j, k)] < 0;
      // Edge along x
      if (i < nx - 1 && inside !== field[idx(i + 1, j, k)] < 0) {
        quads.push([cellIdx(i, j - 1, k - 1), cellIdx(i, j, k - 1), cellIdx(i, j, k), cellIdx(i, j - 1, k)]);
      }
      if (j < ny - 1 && inside !== field[idx(i, j + 1, k)] < 0) {
        quads.push([cellIdx(i - 1, j, k - 1), cellIdx(i, j, k - 1), cellIdx(i, j, k), cellIdx(i - 1, j, k)]);
      }
      if (k < nz - 1 && inside !== field[idx(i, j, k + 1)] < 0) {
        quads.push([cellIdx(i - 1, j - 1, k), cellIdx(i, j - 1, k), cellIdx(i, j, k), cellIdx(i - 1, j, k)]);
      }
    }
const vertexCount = positions.length / 3;
log(`surface nets: ${vertexCount} vertices, ${quads.length} quads`);

// ------------------------------------------------------------------ bake

const pos = new Float32Array(positions);
const bakedPos = new Float32Array(vertexCount * 3);
const bakedNorm = new Float32Array(vertexCount * 3);
const bakedAttr = new Uint8Array(vertexCount * 16);
const bakedArt = new Float32Array(vertexCount * 3);
{
  const chunk = Math.ceil(vertexCount / (pool.length * 8));
  const jobs = [];
  for (let s = 0, j = 0; s < vertexCount; s += chunk, j++) {
    const e = Math.min(vertexCount, s + chunk);
    jobs.push(
      run(pool[j % pool.length], { type: "bake", positions: pos.slice(s * 3, e * 3) }).then((m) => {
        bakedPos.set(m.outPos, s * 3);
        bakedNorm.set(m.outNorm, s * 3);
        bakedAttr.set(m.attr, s * 16);
        bakedArt.set(m.art, s * 3);
      }),
    );
  }
  await Promise.all(jobs);
}
log("bake done");

// Triangles, oriented to agree with the field gradient.
const tris = [];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
for (const q of quads) {
  const v = q.map((c) => cellVertex[c]);
  if (v.some((x) => x < 0)) continue;
  const P = (n) => [bakedPos[n * 3], bakedPos[n * 3 + 1], bakedPos[n * 3 + 2]];
  const d02 = Math.hypot(...P(v[0]).map((a, i) => a - P(v[2])[i]));
  const d13 = Math.hypot(...P(v[1]).map((a, i) => a - P(v[3])[i]));
  const pair = d02 < d13 ? [[v[0], v[1], v[2]], [v[0], v[2], v[3]]] : [[v[0], v[1], v[3]], [v[1], v[2], v[3]]];
  for (const t of pair) {
    const [a, b, c] = t.map(P);
    const fn = cross(b.map((x, i) => x - a[i]), c.map((x, i) => x - a[i]));
    let nsum = 0;
    for (const n of t) for (let i = 0; i < 3; i++) nsum += fn[i] * bakedNorm[n * 3 + i];
    // Counter-clockwise around the outward normal. three.js flips the
    // winding itself for the mirrored (y-down) model matrix.
    tris.push(nsum > 0 ? t : [t[0], t[2], t[1]]);
  }
}
log(`${tris.length} triangles`);

// ---------------------------------------------------------- route views

/** For every sample along every blood route: 0 open, 1 seen through a wall, 2 hidden. */
const routeVisibility = ROUTES.map((route) => {
  const s = samplePath(route.points.map((p) => [...p, 0]), 4);
  const n = s.length / 4;
  const out = [];
  for (let i = 0; i < n; i++) {
    let thick = 0;
    for (let t = 1; t < 260; t += 1.5) {
      const d = sdf(s[i * 4] + VIEW_DIR[0] * t, s[i * 4 + 1] + VIEW_DIR[1] * t, s[i * 4 + 2] + VIEW_DIR[2] * t);
      if (d < 0) thick += 1.5;
    }
    out.push(thick < 1 ? 0 : thick < 9 ? 1 : 2);
  }
  return out;
});
log("route visibility done");

// ----------------------------------------------------------- encode

// Flat and gently curved areas (the section, vessel walls) need far fewer
// triangles than the grid produced. Simplify, guided by the baked data so
// tissue boundaries and occlusion stay sharp.
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
let indices = new Uint32Array(tris.flat());
{
  const attrs = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    attrs.set(bakedNorm.subarray(i * 3, i * 3 + 3), i * 8);
    attrs[i * 8 + 3] = bakedAttr[i * 16 + 9] / 255; // ao
    attrs[i * 8 + 4] = bakedAttr[i * 16] / 255; // cut
    attrs[i * 8 + 5] = bakedAttr[i * 16 + 1] / 255; // inner
    attrs[i * 8 + 6] = bakedAttr[i * 16 + 2] / 255; // fat
    attrs[i * 8 + 7] = (bakedAttr[i * 16 + 4] + bakedAttr[i * 16 + 5] + bakedAttr[i * 16 + 6] + bakedAttr[i * 16 + 7]) / 255;
  }
  const before = indices.length / 3;
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
    indices, bakedPos, 3, attrs, 8, [0.5, 0.5, 0.5, 0.6, 1, 1, 1, 1], null,
    Math.floor(indices.length * 0.3), arg("error", 5e-4), [],
  );
  indices = simplified;
  log(`simplified ${before} -> ${indices.length / 3} triangles (error ${error.toExponential(2)})`);
}
const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
const STRIDE = 32;
const vb = new Uint8Array(unique * STRIDE);
const dv = new DataView(vb.buffer);
const mn = [Infinity, Infinity, Infinity];
const mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vertexCount; i++)
  for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], bakedPos[i * 3 + k]);
    mx[k] = Math.max(mx[k], bakedPos[i * 3 + k]);
  }
const ART_SCALE = 32;
for (let i = 0; i < vertexCount; i++) {
  const o = remap[i];
  if (o === 0xffffffff) continue;
  const b = o * STRIDE;
  for (let k = 0; k < 3; k++) {
    dv.setUint16(b + k * 2, Math.round(((bakedPos[i * 3 + k] - mn[k]) / (mx[k] - mn[k])) * 65535), true);
    dv.setInt8(b + 8 + k, Math.round(bakedNorm[i * 3 + k] * 127));
    dv.setInt8(b + 28 + k, Math.round(Math.max(-1, Math.min(1, bakedArt[i * 3 + k] / ART_SCALE)) * 127));
  }
  vb.set(bakedAttr.subarray(i * 16, i * 16 + 16), b + 12);
}
const vEnc = MeshoptEncoder.encodeVertexBuffer(vb, unique, STRIDE);
const iEnc = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4);

const header = {
  vertexCount: unique,
  indexCount: indices.length,
  stride: STRIDE,
  vertexBytes: vEnc.length,
  indexBytes: iEnc.length,
  min: mn,
  max: mx,
  artScale: ART_SCALE,
  routeVisibility,
};
const json = new TextEncoder().encode(JSON.stringify(header));
const pad = (4 - ((8 + json.length) % 4)) % 4;
const file = new Uint8Array(8 + json.length + pad + vEnc.length + iEnc.length);
const fdv = new DataView(file.buffer);
fdv.setUint32(0, 0x31545248, true); // "HRT1"
fdv.setUint32(4, json.length + pad, true);
file.set(json, 8);
file.fill(32, 8 + json.length, 8 + json.length + pad);
file.set(vEnc, 8 + json.length + pad);
file.set(iEnc, 8 + json.length + pad + vEnc.length);
const gz = gzipSync(file, { level: 9 });
mkdirSync(new URL("../public/heart/", import.meta.url), { recursive: true });
writeFileSync(OUT, gz);
log(`wrote ${OUT.pathname}: ${unique} vertices, ${indices.length / 3} triangles, ${(gz.length / 1024).toFixed(0)} KiB`);
for (const w of pool) w.terminate();
