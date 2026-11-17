import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { BeatFrame } from "@/lib/beatClock";
import {
  atrialContraction,
  ejectionPulse,
  fillingFlow,
  getTiming,
  ventricularContraction,
} from "@/lib/cardiac";
import {
  PAPILLARY,
  PITCH,
  ROUTES,
  VALVES,
  YAW,
  deform,
  motionWeights,
  samplePath,
  type BeatState,
  type MotionWeights,
  type ValveSpec,
  type Vec3,
} from "@/lib/heart3d/anatomy";
import {
  CHORD_FRAGMENT,
  CHORD_VERTEX,
  DEPTH_FRAGMENT,
  HEART_DEPTH_VERTEX,
  HEART_FRAGMENT,
  KEY_LIGHT,
  HEART_VERTEX,
  LEAFLET_FRAGMENT,
  PARTICLE_FRAGMENT,
  PARTICLE_VERTEX,
  TISSUE_VERTEX,
} from "@/lib/heart3d/shaders";

interface MeshHeader {
  vertexCount: number;
  indexCount: number;
  stride: number;
  vertexBytes: number;
  indexBytes: number;
  min: Vec3;
  max: Vec3;
  artScale: number;
  routeVisibility: number[][];
}

/** Points in model space that the 2D overlay pins labels to. */
export type Anchors = Record<string, Vec3>;

const FOV = 24;
/** Half the height of the original 440-unit SVG view. */
const HALF_VIEW = 220;
const DISTANCE = HALF_VIEW / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

async function loadMesh(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`heart mesh: ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  // The file is gzip compressed unless the server already unpacked it.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x31545248) throw new Error("heart mesh: bad file");
  const headerBytes = view.getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerBytes)),
  ) as MeshHeader;
  const vStart = 8 + headerBytes;
  const iStart = vStart + header.vertexBytes;
  await MeshoptDecoder.ready;
  const vertices = new Uint8Array(header.vertexCount * header.stride);
  MeshoptDecoder.decodeVertexBuffer(
    vertices,
    header.vertexCount,
    header.stride,
    bytes.subarray(vStart, iStart),
  );
  const indices = new Uint32Array(header.indexCount);
  MeshoptDecoder.decodeIndexBuffer(
    new Uint8Array(indices.buffer),
    header.indexCount,
    4,
    bytes.subarray(iStart, iStart + header.indexBytes),
  );
  return { header, vertices, indices };
}

function buildHeartGeometry(vertices: Uint8Array, indices: Uint32Array, stride: number) {
  const buffer = vertices.buffer;
  const u16 = new THREE.InterleavedBuffer(new Uint16Array(buffer), stride / 2);
  const i8 = new THREE.InterleavedBuffer(new Int8Array(buffer), stride);
  const u8 = new THREE.InterleavedBuffer(new Uint8Array(buffer), stride);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.InterleavedBufferAttribute(u16, 3, 0, true));
  g.setAttribute("normal", new THREE.InterleavedBufferAttribute(i8, 3, 8, true));
  g.setAttribute("aSurface", new THREE.InterleavedBufferAttribute(u8, 4, 12, true));
  g.setAttribute("aTissue", new THREE.InterleavedBufferAttribute(u8, 4, 16, true));
  g.setAttribute("aExtra", new THREE.InterleavedBufferAttribute(u8, 4, 20, true));
  g.setAttribute("aMotion", new THREE.InterleavedBufferAttribute(u8, 4, 24, true));
  g.setAttribute("aArt", new THREE.InterleavedBufferAttribute(i8, 3, 28, true));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

// ------------------------------------------------------------------ valves

interface ValveRig {
  spec: ValveSpec;
  weights: MotionWeights;
  mesh: THREE.Mesh;
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  axis: THREE.Vector3;
  /** Free-edge points, for the chordae. */
  edges: THREE.Vector3[];
}

const SEG_U = 10;
const SEG_V = 7;

function leafletIndices(cusps: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < cusps; c++) {
    const base = c * (SEG_U + 1) * (SEG_V + 1);
    for (let v = 0; v < SEG_V; v++)
      for (let u = 0; u < SEG_U; u++) {
        const a = base + v * (SEG_U + 1) + u;
        const b = a + 1;
        const d = a + SEG_U + 1;
        const e = d + 1;
        out.push(a, d, b, b, d, e);
      }
  }
  return out;
}

// ---------------------------------------------------------------- particles

interface Route {
  kind: "return" | "fill" | "eject";
  color: [number, number, number];
  spread: number;
  rest: Float32Array;
  weights: MotionWeights[];
  visibility: number[];
  count: number;
}

interface Particle {
  route: number;
  s: number;
  lane: [number, number];
  pace: number;
}

const TRAIL = 4;

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const POOR: [number, number, number] = [0.376, 0.647, 1.0];
const RICH: [number, number, number] = [1.0, 0.72, 0.6];

export class HeartScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private model = new THREE.Group();
  private heartMaterial: THREE.ShaderMaterial;
  private shadowTarget: THREE.WebGLRenderTarget;
  private shadowCamera: THREE.OrthographicCamera;
  private depthMaterial: THREE.ShaderMaterial;
  private valves: ValveRig[] = [];
  private chordae: THREE.LineSegments;
  private routes: Route[] = [];
  private particles: Particle[] = [];
  private open: THREE.Points;
  private through: THREE.Points;
  private particleMaterials: THREE.ShaderMaterial[] = [];
  private flow = { return: 0, fill: 0, eject: 0 };
  private avOpen = 1;
  private semilunarOpen = 0;
  private state: BeatState = { vent: 0, atria: 0, eject: 0 };
  private tmp: Vec3 = [0, 0, 0];
  private tmp2: Vec3 = [0, 0, 0];
  private width = 1;
  private height = 1;
  /** Drops below 1 on slow GPUs to render fewer pixels. */
  private quality = 1;
  private slowFrames = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    mesh: Awaited<ReturnType<typeof loadMesh>>,
    private reduceMotion: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, DISTANCE - 400, DISTANCE + 500);
    this.camera.position.set(0, Math.sin(PITCH) * DISTANCE, Math.cos(PITCH) * DISTANCE);
    this.camera.lookAt(0, 0, 0);

    // Author space (SVG: y down) to scene space (y up), centred on the view.
    this.model.scale.set(1, -1, 1);
    this.model.position.set(-200, 220, 0);
    this.root.add(this.model);
    this.root.rotation.y = YAW;
    this.scene.add(this.root);

    const { header } = mesh;
    const geometry = buildHeartGeometry(mesh.vertices, mesh.indices, header.stride);
    this.heartMaterial = new THREE.ShaderMaterial({
      vertexShader: HEART_VERTEX,
      fragmentShader: HEART_FRAGMENT,
      uniforms: {
        uMin: { value: new THREE.Vector3(...header.min) },
        uRange: {
          value: new THREE.Vector3(
            header.max[0] - header.min[0],
            header.max[1] - header.min[1],
            header.max[2] - header.min[2],
          ),
        },
        uArtScale: { value: header.artScale },
        uVent: { value: 0 },
        uAtria: { value: 0 },
        uEject: { value: 0 },
      },
    });
    const heart = new THREE.Mesh(geometry, this.heartMaterial);
    heart.frustumCulled = false;
    this.model.add(heart);

    // Shadows from the key light. The depth pass deforms the mesh exactly
    // like the main pass, so shadows move with every beat. It lives on its
    // own layer so only the light's camera sees it.
    const SHADOW_SIZE = 2048;
    this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE),
    });
    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: HEART_DEPTH_VERTEX,
      fragmentShader: DEPTH_FRAGMENT,
      uniforms: {
        uMin: this.heartMaterial.uniforms.uMin,
        uRange: this.heartMaterial.uniforms.uRange,
        uArtScale: this.heartMaterial.uniforms.uArtScale,
        uVent: this.heartMaterial.uniforms.uVent,
        uAtria: this.heartMaterial.uniforms.uAtria,
        uEject: this.heartMaterial.uniforms.uEject,
      },
    });
    const caster = new THREE.Mesh(geometry, this.depthMaterial);
    caster.frustumCulled = false;
    caster.layers.set(1);
    this.model.add(caster);
    this.shadowCamera = new THREE.OrthographicCamera(-290, 290, 290, -290, 1, 1800);
    this.shadowCamera.layers.set(1);
    this.camera.updateMatrixWorld();
    const toLight = new THREE.Vector3(...KEY_LIGHT)
      .normalize()
      .transformDirection(this.camera.matrixWorld);
    this.shadowCamera.position.copy(toLight).multiplyScalar(900);
    this.shadowCamera.lookAt(0, 0, 0);
    this.shadowCamera.updateMatrixWorld();
    const shadowMatrix = new THREE.Matrix4()
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.shadowCamera.projectionMatrix)
      .multiply(this.shadowCamera.matrixWorldInverse);
    this.heartMaterial.uniforms.uShadowMatrix = { value: shadowMatrix };
    this.heartMaterial.uniforms.uShadowMap = { value: this.shadowTarget.depthTexture };
    this.heartMaterial.uniforms.uShadowTexel = { value: 1 / SHADOW_SIZE };

    this.buildValves();
    this.chordae = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: CHORD_VERTEX,
        fragmentShader: CHORD_FRAGMENT,
        transparent: true,
      }),
    );
    this.chordae.frustumCulled = false;
    this.model.add(this.chordae);

    const built = this.buildParticles(header.routeVisibility);
    this.open = built.open;
    this.through = built.through;
  }

  static async create(canvas: HTMLCanvasElement, url: string, reduceMotion: boolean) {
    const mesh = await loadMesh(url);
    return new HeartScene(canvas, mesh, reduceMotion);
  }

  private buildValves() {
    const material = new THREE.ShaderMaterial({
      vertexShader: TISSUE_VERTEX,
      fragmentShader: LEAFLET_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(0.66, 0.4, 0.34) } },
      side: THREE.DoubleSide,
      transparent: true,
    });
    for (const spec of VALVES) {
      const axis = new THREE.Vector3(...spec.axis).normalize();
      const helper = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const e1 = new THREE.Vector3().crossVectors(axis, helper).normalize();
      const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
      const count = spec.cusps * (SEG_U + 1) * (SEG_V + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      g.setIndex(leafletIndices(spec.cusps));
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      this.model.add(mesh);
      this.valves.push({
        spec,
        weights: motionWeights(...spec.center),
        mesh,
        e1,
        e2,
        axis,
        edges: [],
      });
    }
  }

  /** Shape the leaflets for how open each valve is. */
  private updateValves() {
    const pos = new THREE.Vector3();
    const hinge = new THREE.Vector3();
    const inward = new THREE.Vector3();
    const closedDir = new THREE.Vector3();
    const openDir = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const cup = new THREE.Vector3();
    for (const rig of this.valves) {
      const { spec, axis, e1, e2 } = rig;
      const open = spec.kind === "av" ? this.avOpen : this.semilunarOpen;
      deform(spec.center, rig.weights, this.state, this.tmp);
      const center = new THREE.Vector3(...this.tmp);
      const attr = rig.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      rig.edges.length = 0;
      let k = 0;
      const R = spec.radius;
      const gap = 0.05;
      for (let c = 0; c < spec.cusps; c++) {
        const a0 = spec.spin + (c / spec.cusps) * Math.PI * 2 + gap;
        const a1 = spec.spin + ((c + 1) / spec.cusps) * Math.PI * 2 - gap;
        for (let v = 0; v <= SEG_V; v++) {
          const tv = v / SEG_V;
          for (let u = 0; u <= SEG_U; u++) {
            const tu = u / SEG_U;
            const ang = a0 + (a1 - a0) * tu;
            const cs = Math.cos(ang);
            const sn = Math.sin(ang);
            hinge.copy(center).addScaledVector(e1, cs * R).addScaledVector(e2, sn * R);
            inward.set(0, 0, 0).addScaledVector(e1, -cs).addScaledVector(e2, -sn);
            if (spec.kind === "av") {
              closedDir.copy(inward).addScaledVector(axis, -0.18).normalize();
              openDir.copy(axis).addScaledVector(inward, 0.22).normalize();
            } else {
              closedDir.copy(inward).addScaledVector(axis, 0.45).normalize();
              openDir.copy(axis).addScaledVector(inward, -0.08).normalize();
            }
            dir.copy(closedDir).lerp(openDir, open).normalize();
            // The free edge sags between its commissures.
            const sag = Math.sin(Math.PI * tu);
            const len = R * spec.length * (0.62 + 0.38 * sag);
            pos.copy(hinge).addScaledVector(dir, len * tv);
            // Leaflets billow toward the chamber pushing on them...
            const billow = Math.sin(Math.PI * tv) * sag * R * 0.16;
            pos.addScaledVector(axis, spec.kind === "av" ? -billow * (1 - open) : billow * (1 - open));
            // ...and are cupped across their width, never flat sheets.
            tangent.set(0, 0, 0).addScaledVector(e1, -sn).addScaledVector(e2, cs);
            cup.crossVectors(dir, tangent).normalize();
            pos.addScaledVector(cup, (sag - 0.6) * tv * R * 0.22);
            arr[k++] = pos.x;
            arr[k++] = pos.y;
            arr[k++] = pos.z;
            if (v === SEG_V && (u === 3 || u === 7)) rig.edges.push(pos.clone());
          }
        }
      }
      attr.needsUpdate = true;
      rig.mesh.geometry.computeVertexNormals();
    }

    // Chordae tendineae from the free edges of the AV leaflets down to the
    // papillary muscles.
    const lines: number[] = [];
    for (const rig of this.valves) {
      if (rig.spec.kind !== "av") continue;
      const muscles = PAPILLARY.filter((p) => p.valve === rig.spec.id).map((p) => {
        deform(p.tip, motionWeights(...p.tip), this.state, this.tmp2);
        return new THREE.Vector3(...this.tmp2);
      });
      for (const edge of rig.edges) {
        let best = muscles[0];
        for (const m of muscles) if (m.distanceToSquared(edge) < best.distanceToSquared(edge)) best = m;
        lines.push(edge.x, edge.y, edge.z, best.x, best.y, best.z);
      }
    }
    const g = this.chordae.geometry;
    const existing = g.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!existing || existing.array.length !== lines.length) {
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lines), 3));
    } else {
      (existing.array as Float32Array).set(lines);
      existing.needsUpdate = true;
    }
  }

  private buildParticles(visibility: number[][]) {
    this.routes = ROUTES.map((spec, i) => {
      const s = samplePath(spec.points.map((p) => [...p, 0] as [number, number, number, number]), 4);
      const n = s.length / 4;
      const rest = new Float32Array(n * 3);
      const weights: MotionWeights[] = [];
      for (let k = 0; k < n; k++) {
        rest[k * 3] = s[k * 4];
        rest[k * 3 + 1] = s[k * 4 + 1];
        rest[k * 3 + 2] = s[k * 4 + 2];
        weights.push(motionWeights(s[k * 4], s[k * 4 + 1], s[k * 4 + 2]));
      }
      return {
        kind: spec.kind,
        color: spec.blood === "poor" ? POOR : RICH,
        spread: spec.spread,
        rest,
        weights,
        visibility: visibility[i] ?? new Array(n).fill(0),
        count: spec.count,
      };
    });
    const random = seeded(7);
    this.routes.forEach((route, index) => {
      for (let i = 0; i < route.count; i++) {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random());
        this.particles.push({
          route: index,
          s: (i + random()) / route.count,
          lane: [Math.cos(a) * r, Math.sin(a) * r],
          pace: 0.8 + random() * 0.4,
        });
      }
    });
    const total = this.particles.length * TRAIL;
    const make = (depthTest: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
      g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(total), 1));
      g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(total), 1));
      const colors = new Float32Array(total * 3);
      this.particles.forEach((p, i) => {
        for (let t = 0; t < TRAIL; t++) colors.set(this.routes[p.route].color, (i * TRAIL + t) * 3);
      });
      g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
      const material = new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        uniforms: { uScale: { value: 1 } },
        transparent: true,
        depthTest,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      this.particleMaterials.push(material);
      const points = new THREE.Points(g, material);
      points.frustumCulled = false;
      points.renderOrder = depthTest ? 2 : 3;
      points.visible = !this.reduceMotion;
      this.model.add(points);
      return points;
    };
    return { open: make(true), through: make(false) };
  }

  private stepParticles(frame: BeatFrame, tMs: number, timing: ReturnType<typeof getTiming>) {
    const rate = Math.min(1.6, Math.max(0.7, Math.sqrt(frame.bpm / 72)));
    const target = {
      return: (0.16 + 0.22 * ventricularContraction(tMs, timing)) * rate,
      fill: 0.02 + 0.85 * fillingFlow(tMs, timing) * rate,
      eject: 0.012 + 1.25 * ejectionPulse(tMs, timing) * rate,
    };
    const blend = Math.min(1, frame.dtMs / 45);
    this.flow.return += (target.return - this.flow.return) * blend;
    this.flow.fill += (target.fill - this.flow.fill) * blend;
    this.flow.eject += (target.eject - this.flow.eject) * blend;
    const dt = frame.dtMs / 1000;
    for (const p of this.particles) {
      p.s += this.flow[this.routes[p.route].kind] * p.pace * dt;
      if (p.s >= 1) p.s -= 1;
    }

    const openPos = this.open.geometry.getAttribute("position") as THREE.BufferAttribute;
    const openAlpha = this.open.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const openSize = this.open.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const thrPos = this.through.geometry.getAttribute("position") as THREE.BufferAttribute;
    const thrAlpha = this.through.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const thrSize = this.through.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const P = openPos.array as Float32Array;
    const A = openAlpha.array as Float32Array;
    const S = openSize.array as Float32Array;
    const P2 = thrPos.array as Float32Array;
    const A2 = thrAlpha.array as Float32Array;
    const S2 = thrSize.array as Float32Array;

    const rest: Vec3 = [0, 0, 0];
    const out: Vec3 = [0, 0, 0];
    this.particles.forEach((p, i) => {
      const route = this.routes[p.route];
      const v = this.flow[route.kind];
      const n = route.rest.length / 3;
      const energy = Math.min(1, v / 0.75);
      const streak = Math.min(0.05, 0.008 + v * p.pace * 0.03);
      for (let t = 0; t < TRAIL; t++) {
        const s = p.s - (streak * t) / (TRAIL - 1);
        const slot = i * TRAIL + t;
        const edge = Math.min(1, Math.max(0, s / 0.06), Math.max(0, (1 - s) / 0.08));
        const f = Math.min(n - 1.001, Math.max(0, s * (n - 1)));
        const k = Math.floor(f);
        const u = f - k;
        const a = k * 3;
        const b = a + 3;
        rest[0] = route.rest[a] + (route.rest[b] - route.rest[a]) * u;
        rest[1] = route.rest[a + 1] + (route.rest[b + 1] - route.rest[a + 1]) * u;
        rest[2] = route.rest[a + 2] + (route.rest[b + 2] - route.rest[a + 2]) * u;
        // Sideways offset across the stream, in the plane perpendicular to
        // the route: b1 = t x z, b2 = t x b1.
        const tx = route.rest[b] - route.rest[a];
        const ty = route.rest[b + 1] - route.rest[a + 1];
        const tz = route.rest[b + 2] - route.rest[a + 2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        const bl = Math.hypot(ty, tx) || 1;
        const bx = ty / bl;
        const by = -tx / bl;
        const cx = (-tz * by) / tl;
        const cy = (tz * bx) / tl;
        const cz = (tx * by - ty * bx) / tl;
        rest[0] += (bx * p.lane[0] + cx * p.lane[1]) * route.spread;
        rest[1] += (by * p.lane[0] + cy * p.lane[1]) * route.spread;
        rest[2] += cz * p.lane[1] * route.spread;
        deform(rest, route.weights[u < 0.5 ? k : k + 1], this.state, out);
        const mode = route.visibility[Math.min(route.visibility.length - 1, Math.round(f))] ?? 0;
        const alpha = edge * (0.3 + 0.7 * energy) * (1 - t / TRAIL) ** 1.3;
        const size = (t === 0 ? 10 : 8.5 - t * 1.6) * (0.85 + 0.3 * energy);
        P[slot * 3] = P2[slot * 3] = out[0];
        P[slot * 3 + 1] = P2[slot * 3 + 1] = out[1];
        P[slot * 3 + 2] = P2[slot * 3 + 2] = out[2];
        S[slot] = S2[slot] = size;
        A[slot] = mode === 0 ? alpha : 0;
        A2[slot] = mode === 1 ? alpha * 0.5 : 0;
      }
    });
    openPos.needsUpdate = true;
    openAlpha.needsUpdate = true;
    openSize.needsUpdate = true;
    thrPos.needsUpdate = true;
    thrAlpha.needsUpdate = true;
    thrSize.needsUpdate = true;
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2) * this.quality);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // Keep the original 400 x 440 view filling the box at any aspect.
    const fitHeight = Math.max(440, 400 / this.camera.aspect);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(fitHeight / 2 / DISTANCE));
    this.camera.updateProjectionMatrix();
    const scale = (this.height * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const m of this.particleMaterials) m.uniforms.uScale.value = scale;
  }

  /**
   * If frames keep arriving slowly, render fewer pixels. The heart is soft
   * and organic, so a lower internal resolution is barely visible.
   */
  private adapt(dtMs: number) {
    if (this.quality <= 0.5 || dtMs <= 0) return;
    this.slowFrames = dtMs > 26 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 45) {
      this.slowFrames = 0;
      this.quality = Math.max(0.5, this.quality - 0.25);
      this.setSize(this.width, this.height);
    }
  }

  /** Advance to this frame of the beat and draw it. */
  update(frame: BeatFrame) {
    this.adapt(frame.dtMs);
    const amount = this.reduceMotion ? 0.45 : 1;
    const timing = getTiming(frame.shapeBpm);
    const tMs = frame.phase * timing.periodMs;
    this.state.atria = atrialContraction(tMs, timing) * amount;
    this.state.vent = ventricularContraction(tMs, timing) * amount;
    this.state.eject = ejectionPulse(tMs, timing) * amount;
    const u = this.heartMaterial.uniforms;
    u.uVent.value = this.state.vent;
    u.uAtria.value = this.state.atria;
    u.uEject.value = this.state.eject;

    const ease = Math.min(1, frame.dtMs / 55);
    this.avOpen += (clamp01(fillingFlow(tMs, timing) * 3) - this.avOpen) * ease;
    this.semilunarOpen += (clamp01(ejectionPulse(tMs, timing) * 4) - this.semilunarOpen) * ease;
    this.updateValves();

    if (!this.reduceMotion) {
      // A slow drift so the light plays across the surface.
      const t = frame.simMs / 1000;
      this.root.rotation.y = YAW + 0.05 * Math.sin(t * 0.42);
      this.root.rotation.x = 0.018 * Math.sin(t * 0.29 + 1.3);
      this.stepParticles(frame, tMs, timing);
    }
    this.render();
  }

  render() {
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.shadowCamera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  /** Model-space anchors (moved with the beat) to positions in the 400 x 440 view. */
  project(anchors: Anchors, out: Record<string, [number, number]>) {
    const v = new THREE.Vector3();
    this.root.updateMatrixWorld();
    for (const [key, p] of Object.entries(anchors)) {
      deform(p, motionWeights(...p), this.state, this.tmp);
      v.set(...this.tmp);
      this.model.localToWorld(v);
      v.project(this.camera);
      const fitW = this.width;
      const fitH = this.height;
      const px = ((v.x + 1) / 2) * fitW;
      const py = ((1 - v.y) / 2) * fitH;
      out[key] = [(px / fitW) * 400, (py / fitH) * 440];
    }
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.shadowTarget.dispose();
    this.renderer.dispose();
  }
}
