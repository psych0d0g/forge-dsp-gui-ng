import type { DeviceState } from "./model";

/**
 * Limits the pages work with. The defaults are those of the upstream BASCOM firmware 1.11.6000
 * (its range tables and constants); whatever the device reports replaces them. Limits the
 * firmware cannot report yet are collected in forge-dsp-firmware#54.
 */
export interface Limits {
  /** Hz, system.feature.attributes.fr */
  freq: [number, number];
  /** biquad gain in 0.1 dB (data_ranges_biquad_*) */
  bqGain: [number, number];
  /** biquad q in 1/1000 */
  bqQ: [number, number];
  /** biquad b (bandwidth in Hz, degrees for type 22) */
  bqB: [number, number];
  /** mixer value (percent), mixer.scale */
  mixer: [number, number];
  /** output delay: samples shared by the delay lines of one DSP, and channels per DSP */
  delayPool: number;
  delayPoolChannels: number;
  /** characters of a channel name */
  nameLength: number;
}

export const DEFAULT_LIMITS: Limits = {
  freq: [10, 22000],
  bqGain: [-120, 60],
  bqQ: [1, 10000],
  bqB: [0, 22000],
  mixer: [0, 100],
  delayPool: 5840,
  delayPoolChannels: 4,
  nameLength: 16,
};

const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : null;

/** defaults, replaced by what this device reports */
export function limitsOf(s: DeviceState): Limits {
  const l = { ...DEFAULT_LIMITS };
  l.freq = pair(s.features.fr) ?? l.freq;
  l.mixer = pair(s.scales.mixer) ?? l.mixer;
  return l;
}
