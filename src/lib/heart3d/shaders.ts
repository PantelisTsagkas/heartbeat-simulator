import {
  SECTION_Z,
  ATRIAL_FILL,
  ATRIAL_SQUEEZE,
  ATRIUM_VOLUME,
  LA_CENTER,
  LV_AXIS,
  PIVOT,
  RA_CENTER,
  RV_AXIS,
} from "@/lib/heart3d/anatomy";

const v3 = (v: readonly number[]) =>
  `vec3(${v.map((n) => n.toFixed(4)).join(", ")})`;
const f = (n: number) => n.toFixed(5);

/** Key light direction in view space (toward the light). */
export const KEY_LIGHT: [number, number, number] = [0.5, 0.6, 0.62];

/** GLSL twin of deform() in anatomy.ts. Keep the two in step. */
export const DEFORM_GLSL = /* glsl */ `
uniform float uVent;
uniform float uAtria;
uniform float uEject;

vec3 ventricle(vec3 p, vec3 base, vec3 apex, float squeeze, float shorten, float twist) {
  vec3 u = apex - base;
  float len = length(u);
  vec3 n = u / len;
  vec3 v = p - base;
  float along = dot(v, n);
  float t = along / len;
  vec3 r = v - n * along;
  float rl = length(r);
  float tc = clamp(t, 0.0, 1.0);
  float q = (tc - 0.42) / 0.66;
  float profile = clamp(1.0 - q * q, 0.0, 1.0);
  float delta = uVent * squeeze * profile;
  float r2 = sqrt(max(rl * rl - delta, 0.16 * rl * rl));
  float fct = rl > 1e-4 ? r2 / rl : 1.0;
  r *= fct;
  float angle = uVent * twist * (tc - 0.3);
  vec3 k = cross(n, r);
  r = r * cos(angle) + k * sin(angle);
  float a2 = along + uVent * shorten * (1.0 - tc);
  return base + n * a2 + r;
}

vec3 atrium(vec3 p, vec3 c, float amount) {
  vec3 d = p - c;
  float r = length(d);
  float r3 = r * r * r;
  float target = pow(max(r3 - amount * ${f(ATRIUM_VOLUME)}, 0.07 * r3), 1.0 / 3.0);
  float fct = r > 1e-4 ? target / r : 1.0;
  return c + d * fct;
}

vec3 deform(vec3 p, vec4 w, vec3 art) {
  vec3 l = ventricle(p, ${v3(LV_AXIS.base)}, ${v3(LV_AXIS.apex)}, ${f(LV_AXIS.squeeze)}, ${f(LV_AXIS.shorten)}, ${f(LV_AXIS.twist)});
  vec3 rr = ventricle(p, ${v3(RV_AXIS.base)}, ${v3(RV_AXIS.apex)}, ${f(RV_AXIS.squeeze)}, ${f(RV_AXIS.shorten)}, ${f(RV_AXIS.twist)});
  float atrialAmount = ${f(ATRIAL_SQUEEZE)} * uAtria - ${f(ATRIAL_FILL)} * uVent;
  vec3 a = atrium(p, ${v3(RA_CENTER)}, atrialAmount);
  vec3 b = atrium(p, ${v3(LA_CENTER)}, atrialAmount);
  vec3 q = p + w.x * (l - p) + w.y * (rr - p) + w.z * (a - p) + w.w * (b - p);
  q.y += (w.z + w.w) * uVent * 5.0;
  q += art * uEject * 0.075;
  float rock = -0.03 * uVent;
  vec2 d = q.xy - ${v3(PIVOT)}.xy;
  vec2 rot = vec2(d.x * cos(rock) - d.y * sin(rock), d.x * sin(rock) + d.y * cos(rock));
  return vec3(${v3(PIVOT)}.xy + rot + vec2(0.0, -2.5 * uVent + 1.2 * uAtria), q.z + 3.0 * uVent);
}
`;

/** Noise and the studio lighting shared by every tissue material. */
const COMMON_GLSL = /* glsl */ `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// Gradient noise, -1..1
float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 fr = fract(p);
  vec3 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  #define G(o) dot(hash33(i + o) * 2.0 - 1.0, fr - o)
  float n = mix(
    mix(mix(G(vec3(0,0,0)), G(vec3(1,0,0)), u.x), mix(G(vec3(0,1,0)), G(vec3(1,1,0)), u.x), u.y),
    mix(mix(G(vec3(0,0,1)), G(vec3(1,0,1)), u.x), mix(G(vec3(0,1,1)), G(vec3(1,1,1)), u.x), u.y),
    u.z);
  #undef G
  return n * 1.6;
}
float fbm3(vec3 p) {
  return 0.55 * gnoise(p) + 0.28 * gnoise(p * 2.07 + 11.3) + 0.14 * gnoise(p * 4.13 + 5.1);
}
// Cellular noise: distance to the nearest and second nearest feature.
vec2 cells(vec3 p) {
  vec3 i = floor(p);
  vec3 fr = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 d = o + hash33(i + o) - fr;
    float dd = dot(d, d);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  return sqrt(vec2(f1, f2));
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}
float V_Smith(float NoV, float NoL, float a) {
  float k = a * 0.5;
  return 0.25 / ((NoV * (1.0 - k) + k) * (NoL * (1.0 - k) + k));
}
vec3 fresnel(vec3 f0, float VoH) {
  return f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
}

// A dark studio: big soft box up and to the left, a strip light on the
// right, warm red bounce from below. Directions are in view space.
vec3 studio(vec3 r, float rough) {
  float soft = mix(1.0, 0.35, rough);
  vec3 c = vec3(0.012, 0.006, 0.007);
  // key soft box
  vec3 kd = normalize(vec3(0.45, 0.6, 0.66));
  float k = smoothstep(0.95 - 0.25 * rough, 0.985, dot(r, kd));
  c += vec3(1.0, 0.95, 0.9) * 1.5 * k * soft;
  // vertical strip on the right
  float s = smoothstep(0.06 + 0.2 * rough, 0.0, abs(r.x + 0.8)) * smoothstep(-0.5, 0.2, r.y) * step(0.0, r.z + 0.25);
  c += vec3(0.85, 0.9, 1.0) * 0.7 * s * soft;
  // broad panel behind the camera: the satin sheen on surfaces facing us
  c += vec3(1.0, 0.9, 0.86) * 0.4 * smoothstep(0.8 - 0.3 * rough, 1.0, r.z) * smoothstep(-0.6, 0.3, r.y);
  // overhead
  c += vec3(0.32, 0.2, 0.2) * smoothstep(0.4, 1.0, r.y) * 0.3;
  // red floor bounce
  c += vec3(0.25, 0.02, 0.03) * smoothstep(0.0, -0.9, r.y);
  // rim kicker behind
  c += vec3(1.0, 0.32, 0.26) * 0.7 * smoothstep(0.55, 0.95, dot(r, normalize(vec3(0.7, 0.4, -0.6))));
  return c;
}

struct Light { vec3 dir; vec3 color; };

// Diffuse with a red-shifted wrap: light bleeds further round in red, the
// way it scatters under real skin and muscle.
vec3 sssDiffuse(float NoL, vec3 wrap) {
  return clamp((vec3(NoL) + wrap) / (1.0 + wrap), 0.0, 1.0) ;
}

vec3 shade(
  vec3 N, vec3 Nc, vec3 V, vec3 albedo, float rough, float coat, float coatRough,
  vec3 wrap, float ao, float thin, vec3 transTint, float keyShadow
) {
  Light lights[4];
  lights[0] = Light(normalize(${v3(KEY_LIGHT)}), vec3(1.0, 0.93, 0.86) * 2.1);
  lights[1] = Light(normalize(vec3(-0.75, -0.1, 0.6)), vec3(0.6, 0.55, 0.7) * 0.45);
  lights[2] = Light(normalize(vec3(0.9, 0.25, -0.3)), vec3(1.0, 0.4, 0.33) * 2.4);
  lights[3] = Light(normalize(vec3(-0.85, 0.3, -0.45)), vec3(0.62, 0.6, 1.0) * 1.2);

  float NoV = clamp(dot(N, V), 1e-3, 1.0);
  float a = max(rough * rough, 0.002);
  float ac = max(coatRough * coatRough, 0.002);
  vec3 f0 = vec3(0.028);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 L = lights[i].dir;
    vec3 H = normalize(L + V);
    float NoLr = dot(N, L);
    float NoL = clamp(NoLr, 0.0, 1.0);
    float NoH = clamp(dot(N, H), 0.0, 1.0);
    float VoH = clamp(dot(V, H), 0.0, 1.0);
    vec3 diff = albedo * sssDiffuse(NoLr, wrap) / 3.14159;
    vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * fresnel(f0, VoH) * NoL;
    float cNoL = clamp(dot(Nc, L), 0.0, 1.0);
    float cNoH = clamp(dot(Nc, H), 0.0, 1.0);
    float cNoV = clamp(dot(Nc, V), 1e-3, 1.0);
    vec3 cspec = coat * D_GGX(cNoH, ac) * V_Smith(cNoV, cNoL, ac) * fresnel(vec3(0.02), VoH) * cNoL;
    // Light shining through thin tissue from behind.
    float back = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * thin;
    vec3 trans = transTint * back * 0.9;
    float sh = i == 0 ? keyShadow : 1.0;
    // Shadowed diffuse keeps a little red: light scattered inside tissue.
    vec3 diffLit = diff * mix(vec3(0.3, 0.08, 0.07), vec3(1.0), sh);
    col += lights[i].color * (diffLit * mix(1.0, ao, 0.6) + (spec + cspec) * sh * mix(1.0, ao, 0.35) + trans);
  }
  // Ambient + reflections of the studio.
  vec3 amb = mix(vec3(0.03, 0.01, 0.014), vec3(0.09, 0.045, 0.05), N.y * 0.5 + 0.5);
  col += albedo * amb * ao;
  vec3 R = reflect(-V, Nc);
  float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(Nc, V), 0.0, 1.0), 5.0);
  col += studio(R, coatRough) * fr * coat * 0.7 * ao * ao;
  vec3 R2 = reflect(-V, N);
  col += studio(R2, rough) * fresnel(f0, NoV) * (1.0 - rough) * 0.5 * ao;
  return col;
}

vec3 toneMap(vec3 c) {
  // Filmic curve applied to the brightest channel only, so deep reds keep
  // their hue instead of sliding toward orange, then sRGB gamma.
  c *= 0.8;
  float m = max(max(c.r, c.g), max(c.b, 1e-5));
  float t = clamp((m * (2.51 * m + 0.03)) / (m * (2.43 * m + 0.59) + 0.14), 0.0, 1.0);
  vec3 mapped = c * (t / m);
  // Very bright highlights still burn toward white.
  mapped = mix(mapped, vec3(t), smoothstep(1.4, 4.0, m) * 0.7);
  return pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

export const HEART_VERTEX = /* glsl */ `
uniform vec3 uMin;
uniform vec3 uRange;
uniform float uArtScale;
uniform mat4 uShadowMatrix;
attribute vec4 aSurface; // cut, inner, fat, side
attribute vec4 aTissue;  // vessel rich, vessel poor, coronary artery, coronary vein
attribute vec4 aExtra;   // atrium, ao, thin, papillary
attribute vec4 aMotion;  // lv, rv, ra, la
attribute vec3 aArt;

varying vec3 vRest;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec4 vSurface;
varying vec4 vTissue;
varying vec4 vExtra;
varying vec3 vBx;
varying vec3 vBy;
varying vec3 vBz;
varying vec4 vShadow;

${DEFORM_GLSL}

void main() {
  vec3 p = uMin + position * uRange;
  vec3 n = normalize(normal);
  vec3 art = aArt * uArtScale;
  vec3 q = deform(p, aMotion, art);
  // Recover the deformed normal from two nearby points on the surface.
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 q1 = deform(p + t1 * 0.8, aMotion, art);
  vec3 q2 = deform(p + t2 * 0.8, aMotion, art);
  vec3 dn = normalize(cross(q1 - q, q2 - q));
  if (dot(dn, n) < 0.0) dn = -dn;

  vRest = p;
  vSurface = aSurface;
  vTissue = aTissue;
  vExtra = aExtra;
  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * dn);
  // Object-space gradients become view-space ones through these.
  vBx = normalMatrix[0];
  vBy = normalMatrix[1];
  vBz = normalMatrix[2];
  vShadow = uShadowMatrix * modelMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

/** Depth-only pass from the key light, with the same beat deformation. */
export const HEART_DEPTH_VERTEX = /* glsl */ `
uniform vec3 uMin;
uniform vec3 uRange;
uniform float uArtScale;
attribute vec4 aMotion;
attribute vec3 aArt;
${DEFORM_GLSL}
void main() {
  vec3 q = deform(uMin + position * uRange, aMotion, aArt * uArtScale);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`;

export const DEPTH_FRAGMENT = /* glsl */ `
void main() { gl_FragColor = vec4(1.0); }
`;

export const HEART_FRAGMENT = /* glsl */ `
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
varying vec4 vShadow;
varying vec3 vRest;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec4 vSurface;
varying vec4 vTissue;
varying vec4 vExtra;
varying vec3 vBx;
varying vec3 vBy;
varying vec3 vBz;

${COMMON_GLSL}

vec3 toView(vec3 g) { return vBx * g.x + vBy * g.y + vBz * g.z; }

// Soft shadow from the key light: 12 taps on a rotated disc.
float keyShadow(float NoL) {
  vec3 c = vShadow.xyz / vShadow.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float bias = 0.0006 + 0.0016 * (1.0 - clamp(NoL, 0.0, 1.0));
  float angle = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  mat2 rot = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0);
    float a = float(i) * 2.3999;
    vec2 o = rot * vec2(cos(a), sin(a)) * r * 2.6 * uShadowTexel;
    lit += step(c.z - bias, texture2D(uShadowMap, c.xy + o).r);
  }
  return lit / 12.0;
}

// Perturb a normal with the gradient of a scalar height field.
vec3 bump(vec3 n, vec3 grad, float amount) {
  vec3 g = grad - n * dot(grad, n);
  return normalize(n - g * amount);
}

void main() {
  vec3 p = vRest;
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;

  float cut = vSurface.x;
  float inner = vSurface.y;
  float fat = vSurface.z;
  float side = vSurface.w;
  float vRich = vTissue.x;
  float vPoor = vTissue.y;
  float corA = vTissue.z;
  float corV = vTissue.w;
  float atrium = vExtra.x;
  float ao = vExtra.y;
  float thin = vExtra.z;
  float outer = clamp(1.0 - cut - inner, 0.0, 1.0);
  float muscle = clamp(outer - fat - vRich - vPoor - corA - corV, 0.0, 1.0);

  // ---- height fields for surface detail (object space gradients)
  float e = 0.6;
  // broad organic undulation + fine pores
  vec3 q = p * 0.09;
  float h0 = fbm3(q);
  vec3 g0 = vec3(fbm3(q + vec3(e * 0.09, 0, 0)) - h0, fbm3(q + vec3(0, e * 0.09, 0)) - h0, fbm3(q + vec3(0, 0, e * 0.09)) - h0) / e;
  vec3 qf = p * 0.42;
  float hf = gnoise(qf);
  vec3 gf = vec3(gnoise(qf + vec3(0.25, 0, 0)) - hf, gnoise(qf + vec3(0, 0.25, 0)) - hf, gnoise(qf + vec3(0, 0, 0.25)) - hf) / 0.6;

  // Muscle fibres: noise stretched along a helical direction.
  // Fibres swirl around each ventricle, so their direction turns with
  // position; a domain warp keeps the streaks from looking combed.
  vec3 warp = vec3(gnoise(p * 0.03), gnoise(p * 0.03 + 4.1), 0.0) * 9.0;
  vec3 fp = (p + warp) * vec3(0.32, 0.075, 0.32) + vec3(p.y * 0.05, 0.0, 0.0);
  float fib = gnoise(fp);
  float fib2 = gnoise(fp * 2.6 + 7.0);
  vec3 gfib = vec3(gnoise(fp + vec3(0.25, 0, 0)) - fib, gnoise(fp + vec3(0, 0.25, 0)) - fib, 0.0) / 0.6;

  // Fat lobules (cellular noise is costly, so only where there is fat).
  float lob = 0.5;
  vec3 glob = vec3(0.0);
  if (fat * outer > 0.02) {
    lob = cells(p * 0.2).x;
    glob = vec3(
      cells(p * 0.2 + vec3(0.06, 0, 0)).x - lob,
      cells(p * 0.2 + vec3(0, 0.06, 0)).x - lob,
      cells(p * 0.2 + vec3(0, 0, 0.06)).x - lob) / 0.3;
  }
  // Small vessels cut across by the section show as dark points.
  float pores = 0.0;
  if (cut > 0.02) {
    vec2 cp = cells(p * vec3(0.07, 0.07, 0.2));
    pores = smoothstep(0.16, 0.07, cp.x);
  }

  // Faint branching surface vessels on the muscle.
  float vein = 1.0 - abs(gnoise(p * 0.045 + 3.0) + 0.5 * gnoise(p * 0.11));
  vein = smoothstep(0.9, 0.985, vein);

  // ---- per tissue colour, roughness, wetness
  float mott = fbm3(p * 0.035 + 2.0);
  vec3 cMuscle = mix(vec3(0.15, 0.008, 0.018), vec3(0.32, 0.018, 0.026), smoothstep(-0.5, 0.6, mott));
  cMuscle = mix(cMuscle, vec3(0.14, 0.02, 0.06), smoothstep(0.2, 0.9, fbm3(p * 0.06 + 9.0)) * 0.5);
  cMuscle = mix(cMuscle, vec3(0.17, 0.035, 0.12), vein * 0.55);
  cMuscle = mix(cMuscle, cMuscle * vec3(0.85, 0.8, 1.05), atrium * 0.6);

  vec3 cFat = mix(vec3(0.62, 0.42, 0.14), vec3(0.78, 0.58, 0.26), smoothstep(0.1, 0.9, lob));
  cFat = mix(cFat, vec3(0.7, 0.36, 0.16), smoothstep(0.2, 0.8, fbm3(p * 0.05)) * 0.35);

  vec3 cRich = mix(vec3(0.3, 0.014, 0.02), vec3(0.46, 0.035, 0.035), smoothstep(-0.4, 0.6, fbm3(p * 0.05 + 4.0)));
  vec3 cPoor = mix(vec3(0.035, 0.05, 0.24), vec3(0.07, 0.1, 0.34), smoothstep(-0.4, 0.6, fbm3(p * 0.05 + 6.0)));
  vec3 cCorA = vec3(0.6, 0.06, 0.06);
  vec3 cCorV = vec3(0.12, 0.07, 0.26);

  float fibers = 0.5 + 0.22 * fib + 0.12 * fib2;
  float blotch = fbm3(p * 0.04 + 1.7);
  vec3 cCut = mix(vec3(0.27, 0.016, 0.022), vec3(0.5, 0.045, 0.045), fibers);
  cCut = mix(cCut, vec3(0.17, 0.01, 0.025), smoothstep(0.1, 0.8, blotch) * 0.45);
  cCut = mix(cCut, vec3(0.56, 0.1, 0.09), smoothstep(0.45, 0.95, fib2) * 0.18);
  cCut = mix(cCut, vec3(0.12, 0.01, 0.02), pores * 0.75);
  // Where the section meets a chamber: the pale, glistening endocardium.
  // Where it meets the outside: the darker epicardium.
  float endo = smoothstep(0.08, 0.35, min(cut, inner) * 2.0);
  float epi = smoothstep(0.08, 0.35, min(cut, outer) * 2.0);
  cCut = mix(cCut, vec3(0.62, 0.22, 0.2), endo * 0.6);
  cCut = mix(cCut, vec3(0.16, 0.015, 0.03), epi * 0.6);

  vec3 cInnerRich = mix(vec3(0.24, 0.01, 0.02), vec3(0.42, 0.03, 0.035), smoothstep(-0.5, 0.5, mott));
  vec3 cInnerPoor = mix(vec3(0.09, 0.03, 0.15), vec3(0.17, 0.06, 0.24), smoothstep(-0.5, 0.5, mott));
  vec3 cInner = mix(cInnerRich, cInnerPoor, side);

  vec3 albedo =
    cMuscle * muscle + cFat * fat * outer + cRich * vRich + cPoor * vPoor +
    cCorA * corA + cCorV * corV + cCut * cut + cInner * inner;
  albedo /= max(muscle + fat * outer + vRich + vPoor + corA + corV + cut + inner, 1e-3);

  float rough = 0.42 * muscle + 0.38 * fat + 0.3 * (vRich + vPoor) + 0.3 * (corA + corV) + 0.5 * cut + 0.3 * inner;
  float coat = 0.85 * muscle + 0.85 * fat + 0.75 * (vRich + vPoor + corA + corV) + 0.7 * cut + 0.6 * inner;
  float coatRough = 0.13 + 0.09 * cut + 0.08 * inner;

  // ---- normals
  vec3 Nn = N;
  vec3 objGrad = g0 * (0.9 * muscle + 0.6 * (vRich + vPoor) + 0.5 * inner + 0.3 * cut)
    + gf * (0.18 * muscle + 0.1 * inner + 0.05 * (vRich + vPoor))
    + glob * (1.4 * fat * outer)
    + gfib * (0.35 * cut) + g0 * 0.25 * cut;
  Nn = bump(N, toView(objGrad), 0.55);
  // The wet film smooths the small bumps but keeps the broad ones.
  vec3 Nc = bump(N, toView(g0 * (0.3 * muscle + 0.15 * inner + 0.2 * (vRich + vPoor) + 0.3 * cut) + glob * 0.6 * fat * outer + gf * 0.02 + gfib * 0.25 * cut), 0.5);

  vec3 wrap = mix(mix(vec3(0.42, 0.1, 0.07), vec3(0.5, 0.35, 0.18), fat * outer), vec3(0.12, 0.16, 0.35), vPoor + corV) * (0.7 + 0.6 * thin);
  vec3 transTint = mix(mix(vec3(0.9, 0.12, 0.08), vec3(0.95, 0.6, 0.2), fat), vec3(0.1, 0.16, 0.7), vPoor + corV) * (0.25 + thin);

  float occl = pow(ao, 1.25);
  float shadow = keyShadow(dot(N, normalize(${v3(KEY_LIGHT)})));
  vec3 col = shade(Nn, Nc, V, albedo, rough, coat, coatRough, wrap, occl, thin, transTint, shadow);
  // Grazing light skimming the wet outer surface.
  float rim = pow(1.0 - clamp(dot(Nc, V), 0.0, 1.0), 4.0);
  col += mix(vec3(0.9, 0.22, 0.2), vec3(0.3, 0.4, 1.0), vPoor + corV) * rim * 0.35 * outer * occl;

  // Deep inside a chamber the light dies away.
  float depth = clamp((2.0 - p.z) / 70.0, 0.0, 1.0);
  col *= mix(1.0, mix(1.0, 0.18, smoothstep(0.0, 1.0, depth)) * smoothstep(0.0, 0.8, ao), inner);
  gl_FragColor = vec4(toneMap(col), 1.0);
}
`;

export const TISSUE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

/** Valve leaflets: thin, pale, translucent fibrous tissue. */
export const LEAFLET_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vObj;
${COMMON_GLSL}
void main() {
  // The section removes the front of each valve along with the heart wall.
  if (vObj.z > ${f(SECTION_Z)}) discard;
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float n = gnoise(vObj * 0.35);
  vec3 albedo = uColor * (0.8 + 0.2 * n);
  vec3 col = shade(N, N, V, albedo, 0.4, 0.7, 0.16, vec3(0.6, 0.35, 0.3), 0.75, 1.0, vec3(0.9, 0.35, 0.25), 1.0);
  gl_FragColor = vec4(toneMap(col), 0.94);
}
`;

export const PARTICLE_VERTEX = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;
attribute float aSize;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = smoothstep(0.55, 0.0, r);
  float glow = pow(1.0 - r, 2.2);
  vec3 c = vColor * (glow * 0.6 + core * 0.95) + vec3(1.0) * core * core * 0.12;
  gl_FragColor = vec4(c * vAlpha, 0.0);
}
`;

/** Chordae tendineae: fine pale cords, clipped at the section. */
export const CHORD_VERTEX = /* glsl */ `
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CHORD_FRAGMENT = /* glsl */ `
varying vec3 vObj;
void main() {
  if (vObj.z > ${f(SECTION_Z)}) discard;
  gl_FragColor = vec4(vec3(0.86, 0.76, 0.72) * 0.8, 0.8);
}
`;
