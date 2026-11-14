import type { Answer } from "../protocol/answer";
import { t, tk, tx } from "../i18n/index.svelte";
import type { Value } from "../protocol/request";
import { limitsOf, type Limits } from "./limits";

/** `gain.*.scale` = [min, max, raw value of 0 dB, dB per step, dB at min(, channels)] */
export interface GainScale {
  min: number;
  max: number;
  zero: number;
  step: number;
  minDb: number;
}

/** one channel of a biquad pool: system.biquads = [[channel, core, biquads, minimum, pool size], …] */
export interface PoolChannel { ch: number; core: number; len: number; min: number; size: number }

/** `biquad.CH.N` = [type, f, gain (0.1 dB), q (1/1000), b, flags] */
export interface Biquad {
  type: number;
  f: number;
  gain: number;
  q: number;
  b: number;
  flags: number;
}

/** `modc.N` = [enable, type, flags (4 bytes hex), event 1..4, sets (4 bytes hex)] */
export interface Modc {
  enable: number;
  type: number;
  flags: number[];
  events: number[];
  sets: number[];
}

export interface DeviceState {
  identity: {
    /** system.key.info as sent, e.g. "BNS-96ELN-4.0-<serial>-CCBYNCSA-<date>-MDD" */
    keyInfo: string;
    model: string;
    pcb: string;
    /** protocol level (BASCOM version the GUI features depend on), e.g. "1.11.6000" */
    firmware: string;
    /** version of the C port (system.firmware.port); null = original BASCOM firmware */
    port: string | null;
    sampleRate: number;
    analogInPairs: number;
    spdifPairs: number;
    outPairs: number;
    presets: number;
    modcBlocks: number;
    /** identities this build can take (port only) */
    keyInfoList: string[];
  };
  /** system.feature.attributes.<name> */
  features: Record<string, Value>;
  /** system.gui.panes.<name>: pages of the original GUI, tells which channels exist */
  panes: Record<string, string[]>;
  scales: { out: GainScale | null; in: GainScale | null; spdif: GainScale | null; mixer: number[] | null };
  gain: { out: number[]; in: number[]; spdif: number[] };
  mute: number[];
  phase: number[];
  /** samples */
  delay: { out: number[]; in: number[] };
  mixer: {
    position: number;
    /** input select of the active position (port: mixer.in), null if unknown */
    input: number | null;
    inputMax: number | null;
    /** values[position][channel][gain], 1-based keys as in mixer.P.C.G */
    values: Record<number, Record<number, Record<number, number>>>;
  };
  /** biquads[channel][n], 1-based keys as in biquad.CH.N */
  biquads: Record<number, Record<number, Biquad>>;
  modc: Record<number, Modc>;
  /** version per MODC type & 0x3F (modc.version.attributes.aa..ad, 16 each); 0 = not available */
  modcVersions: number[];
  preset: { loaded: number | null; select: number | null };
  channelNames: Record<number, string>;
  errors: number[][];
  /** system.limits.<name> as the device reports them (port firmware, forge-dsp-firmware#54) */
  limits: Record<string, number[]>;
  /** biquad pools per DSP core (system.biquads, forge-dsp-firmware#47); null = fixed counts */
  pools: PoolChannel[] | null;
  /** names of the inputs in the device (system.channel.in.N, #55); null = the firmware has none */
  inputNames: Record<number, string> | null;
  /** port extensions, null when the firmware does not have them */
  clickless: number | null;
  supply: Value | null;
  /** input levels in1..in8 in the gain scale (255 = 0 dBFS RMS, 0.5 dB per step); null = the
   * firmware has no system.vu (forge-dsp-firmware#52) */
  vu: number[] | null;
  /** output levels 1..8, same scale (system.vu.out, forge-dsp-firmware#52); null = not available */
  vuOut: number[] | null;
  /** output limiter of the port firmware (forge-dsp-firmware#58): threshold per output in tenths of
   *  dBFS (0 = off, -240..0), attack in tenths of ms, release in ms; null without the block */
  limiter: { t: number[]; attack: number | null; release: number | null } | null;
  /** event values read with event.N.value (the master fader uses those of the volume block) */
  events: Record<number, number>;
  /** MCU temperature in °C */
  temperature: number | null;
  /** ms from the clock start to each start phase, -1 = not reached, last: ms in the bootloader
   * before (system.startup.time, forge-dsp-firmware#67); null = the firmware has none */
  startup: number[] | null;
  /** ms since power-on as read (system.uptime) and when it was read (Date.now()); null = none */
  uptime: { ms: number; at: number } | null;
}

export function emptyState(): DeviceState {
  return {
    identity: { keyInfo: "", model: "", pcb: "", firmware: "", port: null, sampleRate: 0, analogInPairs: 0,
      spdifPairs: 0, outPairs: 0, presets: 0, modcBlocks: 0, keyInfoList: [] },
    features: {},
    panes: {},
    scales: { out: null, in: null, spdif: null, mixer: null },
    gain: { out: [], in: [], spdif: [] },
    mute: [],
    phase: [],
    delay: { out: [], in: [] },
    mixer: { position: 0, input: null, inputMax: null, values: {} },
    biquads: {},
    modc: {},
    modcVersions: [],
    preset: { loaded: null, select: null },
    channelNames: {},
    limits: {},
    pools: null,
    inputNames: null,
    errors: [],
    clickless: null,
    supply: null,
    vu: null,
    vuOut: null,
    limiter: null,
    events: {},
    temperature: null,
    startup: null,
    uptime: null,
  };
}

const num = (v: Value | undefined): number | null => (typeof v === "number" ? v : null);
const nums = (v: Value | undefined): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);
const strs = (v: Value | undefined): string[] => (Array.isArray(v) ? v.map(String) : []);

/** 4 bytes as the firmware prints them: 8 hex digits, first byte first ("02D7280F"); the parser
 * turns all-digit values into numbers, so a number is padded back to 8 digits. */
export function hexBytes(v: Value | undefined): number[] {
  const s = String(v ?? "").padStart(8, "0");
  const out: number[] = [];
  for (let i = 0; i + 2 <= s.length && out.length < 4; i += 2) out.push(parseInt(s.slice(i, i + 2), 16) || 0);
  return out;
}

export function bytesHex(b: number[]): string {
  return b.map((x) => (x & 0xff).toString(16).toUpperCase().padStart(2, "0")).join("");
}

function scale(v: Value | undefined): GainScale | null {
  const a = nums(v);
  return a.length >= 5 ? { min: a[0], max: a[1], zero: a[2], step: a[3], minDb: a[4] } : null;
}

/** raw gain value <-> dB with the scale the device reports */
export const rawToDb = (s: GainScale, raw: number) => (raw - s.zero) * s.step;
export const dbToRaw = (s: GainScale, db: number) => Math.min(s.max, Math.max(s.min, Math.round(db / s.step + s.zero)));

/** "BNS-96ELN-4.0-<serial>-..." -> model "96ELN", pcb "4.0" */
export function parseKeyInfo(key: string): { model: string; pcb: string } {
  const m = /^[A-Z]+-([A-Z0-9]+)-(\d+\.\d+)-/.exec(key);
  return m ? { model: m[1], pcb: m[2] } : { model: "", pcb: "" };
}

function setIndexed(list: number[], index: number, v: Value | undefined) {
  const n = num(v);
  if (n !== null && index >= 1) list[index - 1] = n;
}

/**
 * Takes one answer line (get answer, set echo or event) into the state. Returns true when the
 * line was understood. Used while reading the device and for lines that arrive on their own.
 */
export function applyAnswer(s: DeviceState, a: Answer): boolean {
  if (a.kind === "error" || a.kind === "info" || a.value === undefined) return false;
  const p = a.register.split(".");
  const v = a.value;
  const n = (i: number) => Number(p[i]);
  switch (p[0]) {
    case "system":
      switch (p[1]) {
        case "key":
          if (p[2] === "info" && p[3] === "list") s.identity.keyInfoList = strs(v);
          else if (p[2] === "info" && p.length === 3) {
            s.identity.keyInfo = String(v);
            Object.assign(s.identity, parseKeyInfo(s.identity.keyInfo));
          } else return false;
          return true;
        case "firmware":
          if (p[2] === "port") s.identity.port = String(v);
          else if (p.length === 2) s.identity.firmware = String(v);
          else return false;
          return true;
        case "info": {
          if (!Array.isArray(v) || v.length < 7) return false;
          const i = s.identity;
          if (!i.model) i.model = String(v[0]);
          [i.sampleRate, i.analogInPairs, i.spdifPairs, i.outPairs, i.presets, i.modcBlocks] = v.slice(1, 7).map(Number);
          return true;
        }
        case "feature":
          if (p[2] === "attributes" && p.length === 4) { s.features[p[3]] = v; return true; }
          return p[2] === "attributes" && p.length === 3;
        case "gui":
          if (p[2] === "panes" && p.length === 4) { s.panes[p[3]] = strs(v); return true; }
          return p[2] === "panes" && p.length === 3;
        case "channel":
          if (p[2] === "name" && p.length === 4) { s.channelNames[n(3)] = String(v); return true; }
          if (p[2] === "in" && p.length === 4) { (s.inputNames ??= {})[n(3)] = String(v); return true; }
          return false;
        case "biquads":
          if (p.length !== 2 || !Array.isArray(v)) return false;
          s.pools = v.filter(Array.isArray).map((e) => {
            const [ch, core, len, min, size] = (e as Value[]).map(Number);
            return { ch, core, len, min, size: size || 0 };
          });
          return true;
        case "limits":
          if (p.length === 3) { s.limits[p[2]] = nums(v); return true; }
          return p.length === 2;
        case "errors":
          s.errors = Array.isArray(v) ? v.map((e) => nums(e)) : [];
          return true;
        case "vu":
          if (p.length === 2) { s.vu = nums(v); return true; }
          if (p.length === 3 && p[2] === "out") { s.vuOut = nums(v); return true; }
          return false;
        case "dsp":
          if (p[2] !== "limiter") return false;
          if (p.length === 3) { s.limiter = { attack: null, release: null, ...s.limiter, t: nums(v) }; return true; }
          if (p.length === 4 && (p[3] === "attack" || p[3] === "release") && s.limiter) { s.limiter[p[3]] = num(v); return true; }
          return false;
        case "supply":
          if (p.length === 2) { s.supply = v; return true; }
          return false;
        case "startup":
          if (p.length === 3 && p[2] === "time") { s.startup = nums(v); return true; }
          return false;
        case "uptime": {
          const u = nums(v);
          if (p.length !== 2 || u.length !== 2) return false;
          s.uptime = { ms: u[0] * 1000 + u[1], at: Date.now() };
          return true;
        }
        case "temperature": {
          // without a unit the firmware answers in kelvin (as the original); "nop" = no reading
          const t = num(v);
          const unit = p[2] ?? "kelvin";
          if (p.length > 3 || !["kelvin", "celsius", "fahrenheit"].includes(unit)) return false;
          s.temperature = t === null ? null : unit === "kelvin" ? t - 273.15 : unit === "fahrenheit" ? (t - 32) / 1.8 : t;
          return true;
        }
      }
      return false;
    case "gain": {
      const k = p[1] as "out" | "in" | "spdif";
      if (k !== "out" && k !== "in" && k !== "spdif") return false;
      if (p.length === 2) s.gain[k] = nums(v);
      else if (p[2] === "scale") s.scales[k] = scale(v);
      else if (/^\d+$/.test(p[2])) setIndexed(s.gain[k], n(2), v);
      else return false;
      return true;
    }
    case "mute":
    case "phase": {
      if (p[1] !== "out") return false;
      if (p.length === 2) s[p[0]] = nums(v);
      else if (/^\d+$/.test(p[2])) setIndexed(s[p[0]], n(2), v);
      else return false;
      return true;
    }
    case "delay":
      if (p.length === 1) s.delay.out = nums(v);
      else if (p[1] === "in" && p.length === 2) s.delay.in = nums(v);
      else if (p[1] === "in" && /^\d+$/.test(p[2] ?? "")) setIndexed(s.delay.in, n(2), v);
      else if (/^\d+$/.test(p[1]) && p.length === 2) setIndexed(s.delay.out, n(1), v);
      else return false;
      return true;
    case "mixer":
      if (p[1] === "position") s.mixer.position = num(v) ?? 0;
      else if (p[1] === "scale") s.scales.mixer = nums(v);
      else if (p[1] === "in" && p.length === 2) s.mixer.input = num(v);
      else if (p[1] === "in" && p[2] === "max") s.mixer.inputMax = num(v);
      else if (p.length === 4 && p.slice(1).every((x) => /^\d+$/.test(x))) {
        const val = num(v);
        if (val === null) return false;
        ((s.mixer.values[n(1)] ??= {})[n(2)] ??= {})[n(3)] = val;
      } else return false;
      return true;
    case "biquad":
      if (p[1] === "clickless") { s.clickless = num(v); return true; }
      if (p[1] === "used" && p.length === 2) {
        // forge-dsp-firmware#64: after the places in use, [CH,length,…]; the others are empty
        const l = nums(v);
        for (let i = 0; i + 1 < l.length; i += 2) {
          const bq = (s.biquads[l[i]] ??= {});
          for (let k = 1; k <= l[i + 1]; k++) bq[k] ??= { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
        }
        return true;
      }
      if (p.length === 3 && /^\d+$/.test(p[1]) && /^\d+$/.test(p[2])) {
        const b = nums(v);
        if (b.length < 5) return false;
        (s.biquads[n(1)] ??= {})[n(2)] = { type: b[0], f: b[1], gain: b[2], q: b[3], b: b[4], flags: b[5] ?? 128 };
        return true;
      }
      return false;
    case "modc":
      if (p[1] === "version" && p[2] === "attributes" && p.length === 4) {
        const off = ["aa", "ab", "ac", "ad"].indexOf(p[3]);
        if (off < 0) return false;
        nums(v).forEach((x, i) => (s.modcVersions[off * 16 + i] = x));
        return true;
      }
      if (p.length === 2 && /^\d+$/.test(p[1]) && Array.isArray(v) && v.length >= 8) {
        s.modc[n(1)] = { enable: Number(v[0]), type: Number(v[1]), flags: hexBytes(v[2]),
          events: v.slice(3, 7).map(Number), sets: hexBytes(v[7]) };
        return true;
      }
      return p[1] === "version" && p.length === 3;
    case "event":
      if (p.length === 3 && p[2] === "value" && Number.isFinite(n(1))) { s.events[n(1)] = Number(v); return true; }
      return false;
    case "preset":
      if (p[1] === "loaded") s.preset.loaded = num(v);
      else if (p[1] === "select") s.preset.select = num(v);
      else return false;
      return true;
  }
  return false;
}

/** version of a MODC type as the device reports it (0 = the firmware does not have it) */
export const modcTypeVersion = (s: DeviceState, type: number) => s.modcVersions[type & 0x3f] ?? 0;

export const isPort = (s: DeviceState) => s.identity.port !== null;

/** Inputs are numbered as the mixer columns G (= gain.in.N, then gain.spdif): each stereo input
 * takes two numbers, the odd one is its right, the even one its left channel (original GUI, page
 * INMI21: labels R;L;R;L…). 1..analog = analog inputs, the rest digital. */
export const inputSide = (n: number) => (n % 2 ? "R" : "L");
export const inputPairOf = (n: number) => Math.ceil(n / 2);
/** default name of input n: "Eingang 2 L", "Digital R" (in the language of the interface) */
export function inputDefaultName(n: number, analog = 6): string {
  return n <= analog ? t("device.inputN", { n: `${inputPairOf(n)} ${inputSide(n)}` }) : t("device.digitalSide", { side: inputSide(n) });
}
/** short caption where the group already says analog/digital: "2 L", "R" */
export const inputShortName = (n: number, analog = 6) => (n <= analog ? `${inputPairOf(n)} ${inputSide(n)}` : inputSide(n));
/** input numbers in display order: left before right within each pair */
export const inputsLeftFirst = (count: number) =>
  Array.from({ length: count }, (_, i) => (i % 2 ? i : i + 2)).filter((n) => n <= count);

/** Stereo pairs for the level meter as [left, right] input numbers. system.vu is expected in this
 * numbering (forge-dsp-firmware#52). */
export const INPUT_PAIRS: { in: [number, number] }[] = [{ in: [2, 1] }, { in: [4, 3] }, { in: [6, 5] }, { in: [8, 7] }];

/** power sum of outputs (system.vu.out values) as one value of the same scale; sides[i] = side of
 * output i+1 (0 left, 1 right, -1 not counted), default left = 1,3,5,7, right = 2,4,6,8 */
export function vuSum(values: number[], side: 0 | 1, sides: number[] = [0, 1, 0, 1, 0, 1, 0, 1]): number {
  let p = 0;
  for (let i = 0; i < values.length; i++) if (sides[i] === side && values[i] > 0) p += 10 ** (vuToDb(values[i]) / 10);
  return p > 0 ? Math.min(255, Math.round(255 + 20 * Math.log10(p))) : 0;
}

/** level in dBFS from the gain-scale value of system.vu; 0 = no signal */
export const vuToDb = (v: number) => (v > 0 ? (v - 255) / 2 : -Infinity);

/** Output delays: the channels of one DSP share a pool of samples. */
export interface DelayGroup {
  /** 1-based output channels */
  channels: number[];
  /** samples of the pool (used + free) */
  budget: number;
}

export function delayGroups(s: DeviceState, l: Limits = limitsOf(s)): DelayGroup[] {
  // from the device: [samples per DSP, DSP of output 1, …] (system.limits.out)
  const map = s.limits.out;
  if (map && map.length > 1) {
    const by = new Map<number, number[]>();
    map.slice(1, s.delay.out.length + 1).forEach((dsp, i) => by.set(dsp, [...(by.get(dsp) ?? []), i + 1]));
    return [...by.values()].sort((a, b) => a[0] - b[0]).map((channels) => ({ channels, budget: map[0] }));
  }
  const groups: DelayGroup[] = [];
  for (let c = 1; c <= s.delay.out.length; c += l.delayPoolChannels)
    groups.push({ channels: Array.from({ length: Math.min(l.delayPoolChannels, s.delay.out.length - c + 1) }, (_, i) => c + i),
      budget: l.delayPool });
  return groups;
}

/** largest value channel `ch` may take without exceeding the pool of its group; `list` = the
 * delays the group counts in (outputs by default) */
export function delayMax(s: DeviceState, group: DelayGroup, ch: number, list: number[] = s.delay.out): number {
  const others = group.channels.reduce((a, c) => a + (c === ch ? 0 : list[c - 1] ?? 0), 0);
  return Math.max(0, group.budget - others);
}

/** Input delays: the analog inputs (as many as have a level, the firmware lists more) share the
 * delay memory of DSP 1. Empty on models without input delay. */
export function inputDelayGroup(s: DeviceState, l: Limits = limitsOf(s)): DelayGroup | null {
  const map = s.limits.in;
  if (map) return map.length > 1 ? { channels: map.slice(1).map((_, i) => i + 1), budget: map[0] } : null;  // [] = no input delays
  const n = Math.min(s.delay.in.length, s.gain.in.length);
  return n ? { channels: Array.from({ length: n }, (_, i) => i + 1), budget: l.delayPool } : null;
}

export const SPEED_OF_SOUND = 343;  // m/s, as the firmware's cm factor (0.357 cm per sample at 96 kHz)
export const samplesToMs = (n: number, rate: number) => (n / rate) * 1000;
export const samplesToCm = (n: number, rate: number) => (n / rate) * SPEED_OF_SOUND * 100;
export const msToSamples = (ms: number, rate: number) => Math.round((ms / 1000) * rate);
export const cmToSamples = (cm: number, rate: number) => Math.round((cm / 100 / SPEED_OF_SOUND) * rate);

/**
 * Time alignment from the distances listener - speaker (cm): the farthest speaker gets no
 * delay, every other one the time its sound arrives early. Channels without a distance keep 0.
 */
export function alignFromDistances(distCm: (number | null)[], rate: number): number[] {
  const known = distCm.filter((d): d is number => d !== null && d > 0);
  const far = known.length ? Math.max(...known) : 0;
  return distCm.map((d) => (d !== null && d > 0 ? cmToSamples(far - d, rate) : 0));
}

// --- mixer ---------------------------------------------------------------------------------------
// mixer.P.C.G as the firmware numbers it (forge-dsp-firmware docs/dsp-images.md, GUI page INMI21):
// rows C 1/2 = the two pre-processing buses (biquad channels 35/36), C 3..10 = outputs 1..8;
// columns G 1..8 = inputs (1..6 analog = gain.in.N, 7/8 digital = gain.spdif), G 9/10 = the buses
// into an output. mixer.P.1.10 is the input select of the position.
export const MIXER_BUS_ROWS = [1, 2];
export const MIXER_INPUTS = 8;
export const mixerRowOfOutput = (out: number) => out + 2;
export const MIXER_BUS_COLUMNS = [9, 10];

/** names of the input select values per model (original GUI, page_inmi21_radio_labels) */
const SOURCES: Record<string, string[]> = {
  "96LN": ["", tk("device.sPDIFOptical"), tk("device.sPDIFCoaxial"), "Bluetooth"],
  default: ["Bluetooth", "USB Audio", tk("device.sPDIFOptical1"), tk("device.sPDIFOptical2"), tk("device.sPDIFCoaxial")],
};

export function sourceNames(s: DeviceState): { value: number; label: string }[] {
  const names = SOURCES[s.identity.model] ?? SOURCES.default;
  const count = Math.max(names.length, s.mixer.inputMax ?? 0);
  return Array.from({ length: count }, (_, i) => ({ value: i + 1, label: names[i] ? tx(names[i]) : t("common.sourceN", { n: i + 1 }) }));
}

/** The signal sums ("All Over": a common path with its own filter chain in front of all outputs)
 * are in use in a profile when an output takes a share of sum A or B. */
export function sumsActive(s: DeviceState, profile: number): boolean {
  const g = s.mixer.values[profile] ?? {};
  return s.gain.out.some((_, i) => MIXER_BUS_COLUMNS.some((c) => (g[mixerRowOfOutput(i + 1)]?.[c] ?? 0) > 0));
}
export const sumsActiveAnywhere = (s: DeviceState) => Object.keys(s.mixer.values).some((p) => sumsActive(s, Number(p)));

/** shares of the sums on the outputs in a profile, as "row.column" -> value (what "All Over"
 * remembers when it is switched off) */
export function sumsShares(s: DeviceState, profile: number): Record<string, number> {
  const g = s.mixer.values[profile] ?? {}, out: Record<string, number> = {};
  s.gain.out.forEach((_, i) => {
    const row = mixerRowOfOutput(i + 1);
    for (const col of MIXER_BUS_COLUMNS) if (g[row]?.[col] !== undefined) out[`${row}.${col}`] = g[row][col];
  });
  return out;
}

/**
 * Mixer writes [channel row, column, value] that switch the sums on or off. On: back to the
 * remembered shares; without any (never used before) sum A goes to the left (odd) and sum B to
 * the right (even) outputs at full level. Off: no output takes a sum.
 */
export function sumsMapping(s: DeviceState, profile: number, on: boolean, remembered?: Record<string, number>): [number, number, number][] {
  const g = s.mixer.values[profile] ?? {};
  const useRemembered = !!remembered && Object.values(remembered).some((v) => v > 0);
  const out: [number, number, number][] = [];
  s.gain.out.forEach((_, i) => {
    const row = mixerRowOfOutput(i + 1);
    MIXER_BUS_COLUMNS.forEach((col, k) => {
      const want = !on ? 0 : useRemembered ? remembered![`${row}.${col}`] ?? 0 : k === i % 2 ? 100 : 0;
      if (g[row]?.[col] !== undefined && g[row][col] !== want) out.push([row, col, want]);
    });
  });
  return out;
}
