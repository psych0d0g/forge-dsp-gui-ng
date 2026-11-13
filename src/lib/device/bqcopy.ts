import type { Biquad } from "./model";

const EMPTY: Biquad = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
const same = (a: Biquad, b: Biquad) =>
  a.type === b.type && (a.type === 0 || (a.f === b.f && a.gain === b.gain && a.q === b.q && a.b === b.b && a.flags === b.flags));

/**
 * Copy one channel's biquads onto another (#5): place n of the target gets place n of the source,
 * places the source does not use are cleared. Only differing places are written. Bands of the source
 * beyond the target's places do not fit (the pools of the port firmware give channels different lengths).
 */
export function planCopy(src: Record<number, Biquad>, dst: Record<number, Biquad>): { writes: [number, Biquad][]; lost: number[] } {
  const writes: [number, Biquad][] = [];
  for (const n of Object.keys(dst).map(Number).sort((a, b) => a - b)) {
    const want = src[n] && src[n].type !== 0 ? { ...src[n] } : EMPTY;
    if (!same(want, dst[n])) writes.push([n, want.type === 0 ? { ...EMPTY } : want]);
  }
  const lost = Object.entries(src).filter(([n, bq]) => bq.type !== 0 && !dst[Number(n)]).map(([n]) => Number(n)).sort((a, b) => a - b);
  return { writes, lost };
}
