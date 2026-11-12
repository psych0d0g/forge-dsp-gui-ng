import type { Answer } from "../protocol/answer";
import type { Value } from "../protocol/request";

/** `gain.*.scale` = [min, max, raw value of 0 dB, dB per step, dB at min(, channels)] */
export interface GainScale {
  min: number;
  max: number;
  zero: number;
  step: number;
  minDb: number;
}

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
  /** port extensions, null when the firmware does not have them */
  clickless: number | null;
  supply: Value | null;
  temperature: number | null;
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
    errors: [],
    clickless: null,
    supply: null,
    temperature: null,
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
          return false;
        case "errors":
          s.errors = Array.isArray(v) ? v.map((e) => nums(e)) : [];
          return true;
        case "supply":
          if (p.length === 2) { s.supply = v; return true; }
          return false;
        case "temperature":
          if (p.length === 2) { s.temperature = num(v); return true; }
          return false;
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
