import { t } from "../i18n/index.svelte";
import type { DeviceState, PoolChannel } from "./model";

/**
 * Biquad pools (port firmware, forge-dsp-firmware#47): every DSP core has one pool that its
 * channels share. A channel owns consecutive biquads; changing the lengths moves the stored bands
 * with their channel (band b stays band b), bands beyond a new, shorter length are dropped, and the
 * device restarts to load the new DSP program.
 */
export interface PoolCore {
  core: number;
  size: number;
  channels: PoolChannel[];
}

/** the pools grouped by core, in the order the device lists them */
export function poolCores(s: DeviceState): PoolCore[] {
  const out: PoolCore[] = [];
  for (const c of s.pools ?? []) {
    let k = out.find((x) => x.core === c.core);
    if (!k) out.push((k = { core: c.core, size: c.size, channels: [] }));
    k.channels.push(c);
  }
  return out;
}

export const poolOf = (s: DeviceState, ch: number) => poolCores(s).find((k) => k.channels.some((c) => c.ch === ch)) ?? null;
export const freeOf = (k: PoolCore, lengths = k.channels.map((c) => c.len)) => k.size - lengths.reduce((a, b) => a + b, 0);

/** highest band of a channel that is in use (type ≠ 0), 0 if none */
export function lastUsed(s: DeviceState, ch: number): number {
  let last = 0;
  for (const [n, bq] of Object.entries(s.biquads[ch] ?? {})) if (bq.type !== 0 && Number(n) > last) last = Number(n);
  return last;
}

/** bands in use that new lengths would drop, per channel */
export function lostBands(s: DeviceState, k: PoolCore, lengths: number[]): { ch: number; bands: number[] }[] {
  return k.channels.map((c, i) => ({
    ch: c.ch,
    bands: Object.entries(s.biquads[c.ch] ?? {}).filter(([n, bq]) => bq.type !== 0 && Number(n) > lengths[i]).map(([n]) => Number(n)).sort((a, b) => a - b),
  })).filter((x) => x.bands.length);
}

/** why lengths cannot be used, "" if they can */
export function checkLengths(k: PoolCore, lengths: number[]): string {
  if (lengths.length !== k.channels.length || lengths.some((n) => !Number.isInteger(n))) return t("biquads.invalidValues");
  const low = k.channels.find((c, i) => lengths[i] < c.min);
  if (low) return t("biquads.atLeastNBiquads", { n: low.min, ch: low.ch });
  if (lengths.some((n) => n > 255)) return t("biquads.atMost255Biquads");
  const f = freeOf(k, lengths);
  return f < 0 ? t("biquads.nBiquadsMoreThan", { n: -f, size: k.size }) : "";
}

/**
 * More biquads for one channel without losing a band: first the free ones of the pool, then the
 * unused bands at the end of the other channels (the channel with most unused first), never below
 * their minimum. -> new lengths of the core and how many the channel gets (0: nothing available)
 */
export function proposeGrow(s: DeviceState, ch: number, want: number): { core: number; lengths: number[]; got: number } | null {
  const k = poolOf(s, ch);
  if (!k) return null;
  const lengths = k.channels.map((c) => c.len);
  const i = k.channels.findIndex((c) => c.ch === ch);
  let got = Math.min(want, Math.max(0, freeOf(k)));
  const spare = k.channels.map((c, j) => (j === i ? 0 : c.len - Math.max(c.min, lastUsed(s, c.ch))));
  while (got < want) {
    const j = spare.reduce((best, v, x) => (v > spare[best] ? x : best), 0);
    if (spare[j] <= 0) break;
    spare[j]--;
    lengths[j]--;
    got++;
  }
  lengths[i] = Math.min(255, lengths[i] + got);
  return { core: k.core, lengths, got };
}
