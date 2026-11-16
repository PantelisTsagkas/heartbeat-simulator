/**
 * Routes that blood particles follow through the heart illustration,
 * in the same 400 x 440 coordinate space as the SVG.
 *
 * The picture is a front view, so the heart's right side is on the
 * viewer's left. Oxygen-poor blood (blue) enters from the body, passes
 * through the right side and leaves for the lungs. Oxygen-rich blood
 * (warm) returns from the lungs, passes through the left side and leaves
 * through the aorta.
 */

export type FlowKind =
  /** Veins into the atria: fairly steady. */
  | "return"
  /** Atria into ventricles: only while the ventricles are relaxed. */
  | "fill"
  /** Ventricles into the great arteries: a burst on each contraction. */
  | "eject";

export type Oxygen = "poor" | "rich";

interface RouteSpec {
  kind: FlowKind;
  oxygen: Oxygen;
  /** Half-width of the stream. */
  spread: number;
  count: number;
  points: [number, number][];
}

const RIGHT_VENTRICLE_OUT: [number, number][] = [
  [176, 318],
  [198, 270],
  [222, 224],
  [236, 186],
  [252, 154],
  [278, 143],
];
const LEFT_VENTRICLE_OUT: [number, number][] = [
  [254, 332],
  [236, 280],
  [213, 226],
  [198, 186],
  [190, 142],
];

const ROUTE_SPECS: RouteSpec[] = [
  // Body -> right atrium
  {
    kind: "return",
    oxygen: "poor",
    spread: 3,
    count: 7,
    points: [
      [105, 46],
      [119, 76],
      [123, 114],
      [127, 150],
      [128, 174],
    ],
  },
  {
    kind: "return",
    oxygen: "poor",
    spread: 3,
    count: 7,
    points: [
      [135, 42],
      [123, 74],
      [124, 114],
      [127, 150],
      [124, 174],
    ],
  },
  // Right atrium -> right ventricle
  {
    kind: "fill",
    oxygen: "poor",
    spread: 10,
    count: 16,
    points: [
      [126, 168],
      [138, 200],
      [154, 240],
      [168, 284],
      [176, 318],
    ],
  },
  // Right ventricle -> lungs
  {
    kind: "eject",
    oxygen: "poor",
    spread: 7,
    count: 16,
    points: [...RIGHT_VENTRICLE_OUT, [318, 130], [348, 112]],
  },
  {
    kind: "eject",
    oxygen: "poor",
    spread: 4,
    count: 9,
    points: [...RIGHT_VENTRICLE_OUT, [306, 139], [334, 144], [356, 141]],
  },
  // Lungs -> left atrium
  {
    kind: "return",
    oxygen: "rich",
    spread: 2.5,
    count: 6,
    points: [
      [369, 164],
      [336, 172],
      [304, 180],
    ],
  },
  {
    kind: "return",
    oxygen: "rich",
    spread: 2.5,
    count: 6,
    points: [
      [367, 198],
      [334, 192],
      [304, 185],
    ],
  },
  // Left atrium -> left ventricle
  {
    kind: "fill",
    oxygen: "rich",
    spread: 10,
    count: 16,
    points: [
      [302, 182],
      [291, 216],
      [277, 256],
      [264, 298],
      [254, 332],
    ],
  },
  // Left ventricle -> body, around the aortic arch and up its branches
  {
    kind: "eject",
    oxygen: "rich",
    spread: 8,
    count: 16,
    points: [
      ...LEFT_VENTRICLE_OUT,
      [200, 104],
      [224, 90],
      [256, 90],
      [278, 108],
      [285, 136],
    ],
  },
  {
    kind: "eject",
    oxygen: "rich",
    spread: 3.5,
    count: 7,
    points: [...LEFT_VENTRICLE_OUT, [198, 106], [196, 76], [192, 54]],
  },
  {
    kind: "eject",
    oxygen: "rich",
    spread: 3.5,
    count: 7,
    points: [...LEFT_VENTRICLE_OUT, [204, 102], [228, 84], [230, 46]],
  },
  {
    kind: "eject",
    oxygen: "rich",
    spread: 3.5,
    count: 7,
    points: [
      ...LEFT_VENTRICLE_OUT,
      [202, 103],
      [226, 90],
      [254, 90],
      [267, 56],
    ],
  },
];

export interface FlowRoute {
  kind: FlowKind;
  oxygen: Oxygen;
  spread: number;
  count: number;
  /** Evenly spaced samples along the route: x0, y0, x1, y1, ... */
  samples: Float32Array;
}

const SAMPLES = 96;

/** Catmull-Rom spline through the waypoints, resampled to even spacing. */
function buildSamples(points: [number, number][]): Float32Array {
  const dense: [number, number][] = [];
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
        Math.hypot(
          dense[i][0] - dense[i - 1][0],
          dense[i][1] - dense[i - 1][1],
        ),
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
