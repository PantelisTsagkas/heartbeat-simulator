/**
 * Routes that blood particles follow through the heart illustration,
 * in the same 400 x 440 coordinate space as the SVG.
 *
 * The picture is a front view cut open, so the heart's right side is on
 * the viewer's left.
 *
 * Systemic circulation: left ventricle -> aorta -> body -> venae cavae
 * -> right atrium.
 * Pulmonary circulation: right ventricle -> pulmonary artery -> lungs
 * -> pulmonary veins -> left atrium.
 *
 * Blood is oxygen-poor (blue) from the body through the right side to the
 * lungs, and oxygen-rich (warm) from the lungs through the left side to
 * the body. Note the pulmonary artery carries oxygen-poor blood and the
 * pulmonary veins carry oxygen-rich blood.
 */

export type FlowKind =
  /** Veins into the atria: fairly steady. */
  | "return"
  /** Atria into ventricles, through the tricuspid or mitral valve. */
  | "fill"
  /** Ventricles into the great arteries, through the semilunar valves. */
  | "eject";

export type Oxygen = "poor" | "rich";

type Point = [number, number];
/** x0, y0, x1, y1 */
type Rect = [number, number, number, number];

interface RouteSpec {
  kind: FlowKind;
  oxygen: Oxygen;
  /** Half-width of the stream. */
  spread: number;
  count: number;
  points: Point[];
  /**
   * Areas where this vessel passes behind another structure. Particles are
   * not drawn there, so they never appear to be inside the wrong vessel.
   */
  hidden?: Rect[];
}

/** Right ventricle, up its outflow tract, through the pulmonary valve. */
const RIGHT_VENTRICLE_OUT: Point[] = [
  [174, 326],
  [194, 290],
  [198, 250],
  [192, 214],
  [196, 184],
  [214, 150],
];
/** Left ventricle, up its outflow tract, through the aortic valve. */
const LEFT_VENTRICLE_OUT: Point[] = [
  [258, 348],
  [250, 292],
  [242, 242],
  [238, 208],
  [226, 184],
  [204, 164],
  [197, 140],
];

/** The ascending aorta passes behind the pulmonary trunk. */
const BEHIND_PULMONARY_TRUNK: Rect = [186, 150, 222, 194];
/** The right pulmonary artery passes behind the ascending aorta. */
const BEHIND_AORTA: Rect = [181, 122, 213, 156];
/** The right pulmonary veins pass behind the right atrium to reach the left. */
const BEHIND_RIGHT_ATRIUM: Rect = [73, 150, 246, 232];
/** The descending aorta runs down behind the heart. */
const BEHIND_HEART: Rect = [270, 148, 312, 240];

const ROUTE_SPECS: RouteSpec[] = [
  // Systemic veins: body -> right atrium
  { kind: "return", oxygen: "poor", spread: 6, count: 10, points: [[128, 50], [128, 110], [128, 164], [126, 194]] },
  { kind: "return", oxygen: "poor", spread: 5.5, count: 9, points: [[92, 344], [93, 292], [97, 244], [116, 208]] },
  // Right atrium -> tricuspid valve -> right ventricle
  { kind: "fill", oxygen: "poor", spread: 9, count: 16, points: [[126, 192], [138, 218], [150, 246], [160, 288], [174, 326]] },
  // Right ventricle -> pulmonary valve -> pulmonary trunk -> left and right lungs
  { kind: "eject", oxygen: "poor", spread: 5, count: 14, points: [...RIGHT_VENTRICLE_OUT, [250, 134], [300, 130], [350, 128]] },
  { kind: "eject", oxygen: "poor", spread: 5, count: 14, points: [...RIGHT_VENTRICLE_OUT, [186, 140], [120, 138], [52, 138]], hidden: [BEHIND_AORTA] },
  // Pulmonary veins: lungs -> left atrium (two from each lung)
  { kind: "return", oxygen: "rich", spread: 2.5, count: 6, points: [[372, 170], [330, 180], [298, 186]] },
  { kind: "return", oxygen: "rich", spread: 2.5, count: 6, points: [[370, 200], [332, 200], [298, 194]] },
  { kind: "return", oxygen: "rich", spread: 2.5, count: 9, points: [[38, 174], [72, 177], [150, 182], [250, 186], [282, 188]], hidden: [BEHIND_RIGHT_ATRIUM] },
  { kind: "return", oxygen: "rich", spread: 2.5, count: 9, points: [[38, 200], [72, 200], [150, 198], [250, 194], [282, 192]], hidden: [BEHIND_RIGHT_ATRIUM] },
  // Left atrium -> mitral valve -> left ventricle
  { kind: "fill", oxygen: "rich", spread: 8, count: 16, points: [[290, 186], [282, 212], [276, 240], [270, 292], [258, 348]] },
  // Left ventricle -> aortic valve -> aorta: around the arch and up its three branches
  { kind: "eject", oxygen: "rich", spread: 6, count: 16, points: [...LEFT_VENTRICLE_OUT, [196, 108], [214, 88], [246, 82], [276, 98], [290, 130], [290, 168]], hidden: [BEHIND_PULMONARY_TRUNK, BEHIND_HEART] },
  { kind: "eject", oxygen: "rich", spread: 3, count: 8, points: [...LEFT_VENTRICLE_OUT, [197, 104], [198, 78], [196, 54]], hidden: [BEHIND_PULMONARY_TRUNK] },
  { kind: "eject", oxygen: "rich", spread: 3, count: 8, points: [...LEFT_VENTRICLE_OUT, [198, 104], [216, 86], [231, 76], [232, 46]], hidden: [BEHIND_PULMONARY_TRUNK] },
  { kind: "eject", oxygen: "rich", spread: 3, count: 8, points: [...LEFT_VENTRICLE_OUT, [197, 106], [214, 88], [244, 83], [259, 84], [268, 54]], hidden: [BEHIND_PULMONARY_TRUNK] },
];

export interface FlowRoute {
  kind: FlowKind;
  oxygen: Oxygen;
  spread: number;
  count: number;
  hidden: Rect[];
  /** Evenly spaced samples along the route: x0, y0, x1, y1, ... */
  samples: Float32Array;
}

const SAMPLES = 128;

/** Catmull-Rom spline through the waypoints, resampled to even spacing. */
function buildSamples(points: Point[]): Float32Array {
  const dense: Point[] = [];
  const at = (i: number) => points[Math.min(points.length - 1, Math.max(0, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let step = 0; step < 16; step++) {
      const u = step / 16;
      const u2 = u * u;
      const u3 = u2 * u;
      const axis = (k: 0 | 1) =>
        0.5 *
        (2 * p1[k] +
          (p2[k] - p0[k]) * u +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
          (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3);
      dense.push([axis(0), axis(1)]);
    }
  }
  dense.push(points[points.length - 1]);

  const lengths = [0];
  for (let i = 1; i < dense.length; i++) {
    lengths.push(
      lengths[i - 1] +
        Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]),
    );
  }
  const total = lengths[lengths.length - 1];
  const out = new Float32Array(SAMPLES * 2);
  let j = 1;
  for (let i = 0; i < SAMPLES; i++) {
    const target = (i / (SAMPLES - 1)) * total;
    while (j < dense.length - 1 && lengths[j] < target) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const u = (target - lengths[j - 1]) / span;
    out[i * 2] = dense[j - 1][0] + (dense[j][0] - dense[j - 1][0]) * u;
    out[i * 2 + 1] = dense[j - 1][1] + (dense[j][1] - dense[j - 1][1]) * u;
  }
  return out;
}

export const FLOW_ROUTES: readonly FlowRoute[] = ROUTE_SPECS.map((spec) => ({
  kind: spec.kind,
  oxygen: spec.oxygen,
  spread: spec.spread,
  count: spec.count,
  hidden: spec.hidden ?? [],
  samples: buildSamples(spec.points),
}));

/**
 * Point at position s (0..1) along a route, pushed sideways by `lateral`
 * units so a stream has some width. Writes into `out` to avoid allocating.
 */
export function pointOnRoute(
  route: FlowRoute,
  s: number,
  lateral: number,
  out: { x: number; y: number },
): void {
  const clamped = Math.min(1, Math.max(0, s)) * (SAMPLES - 1);
  const i = Math.min(SAMPLES - 2, Math.floor(clamped));
  const u = clamped - i;
  const { samples } = route;
  const x0 = samples[i * 2];
  const y0 = samples[i * 2 + 1];
  const dx = samples[i * 2 + 2] - x0;
  const dy = samples[i * 2 + 3] - y0;
  const length = Math.hypot(dx, dy) || 1;
  out.x = x0 + dx * u + (-dy / length) * lateral;
  out.y = y0 + dy * u + (dx / length) * lateral;
}

/** True where the route is passing behind another structure. */
export function isHidden(route: FlowRoute, x: number, y: number): boolean {
  for (const [x0, y0, x1, y1] of route.hidden) {
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  }
  return false;
}
