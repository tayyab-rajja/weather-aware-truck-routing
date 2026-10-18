/** Polyline helpers for truck scrubber (RoadWatch-style). */
export type LngLat = [number, number];

export interface RouteIndex {
  points: LngLat[];
  cum: number[];
  total: number;
}

const MILES_PER_DEG = 69;

function segMiles(a: LngLat, b: LngLat): number {
  const meanLat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * Math.cos(meanLat);
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy) * MILES_PER_DEG;
}

export function buildRouteIndex(points: LngLat[]): RouteIndex {
  const cum = new Array(points.length).fill(0);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += segMiles(points[i - 1], points[i]);
    cum[i] = total;
  }
  return { points, cum, total: total || 1 };
}

export function pointAtFraction(idx: RouteIndex, fraction: number): LngLat {
  if (!idx.points.length) return [0, 0];
  const f = Math.min(1, Math.max(0, fraction));
  const target = f * idx.total;
  let lo = 0;
  let hi = idx.cum.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idx.cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  if (i <= 0) return idx.points[0];
  if (i >= idx.points.length) return idx.points[idx.points.length - 1];
  const segStart = idx.cum[i - 1];
  const segLen = idx.cum[i] - segStart || 1;
  const t = (target - segStart) / segLen;
  const a = idx.points[i - 1];
  const b = idx.points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function sliceByFraction(idx: RouteIndex, f0: number, f1: number): LngLat[] {
  const start = Math.min(f0, f1);
  const end = Math.max(f0, f1);
  const out: LngLat[] = [pointAtFraction(idx, start)];
  const startMi = start * idx.total;
  const endMi = end * idx.total;
  for (let i = 0; i < idx.points.length; i++) {
    if (idx.cum[i] > startMi && idx.cum[i] < endMi) out.push(idx.points[i]);
  }
  out.push(pointAtFraction(idx, end));
  return out;
}
