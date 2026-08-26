/** Homepage DN42 topology packet motion. Distances are SVG viewBox units. */

export const TOPO_PACKET_SPEED = 26;
export const TOPO_MAX_DT_SEC = 0.05;
export const TOPO_MIN_PATH_LEN = 1e-3;

/** Clamp a rAF interval so a background tab resume cannot zip packets. */
export function clampFrameDt(nowMs: number, lastMs: number, maxDt = TOPO_MAX_DT_SEC): number {
  const raw = (nowMs - lastMs) / 1000;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, maxDt);
}

/** Integrate path distance. Never divide accumulated wall time by the current length. */
export function advanceOffsetDist(
  offsetDist: number,
  dtSec: number,
  speed = TOPO_PACKET_SPEED,
): number {
  if (!Number.isFinite(offsetDist)) return 0;
  if (!Number.isFinite(dtSec) || dtSec <= 0) return offsetDist;
  if (!Number.isFinite(speed)) return offsetDist;
  return offsetDist + speed * dtSec;
}

/**
 * Phase in [0, 1) from accumulated viewBox distance.
 * `speedLen` should be a cached reference length so a flickering getTotalLength()
 * cannot inflate SPEED/len. `placeLen` is sampled only to reject unusable paths.
 */
export function packetPhase(
  offsetDist: number,
  placeLen: number,
  speedLen = placeLen,
): number | null {
  if (!Number.isFinite(placeLen) || placeLen < TOPO_MIN_PATH_LEN) return null;
  if (!Number.isFinite(speedLen) || speedLen < TOPO_MIN_PATH_LEN) return null;
  if (!Number.isFinite(offsetDist)) return null;
  let u = (offsetDist / speedLen) % 1;
  if (u < 0) u += 1;
  return u;
}

export function packetPointDistance(u: number, placeLen: number, reverse: boolean): number {
  const phase = reverse ? 1 - u : u;
  return phase * placeLen;
}
