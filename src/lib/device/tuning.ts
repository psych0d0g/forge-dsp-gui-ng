// A tuning as a file, in the format the original GUI writes ("Konfiguration speichern") and
// forge-dsp-firmware's c45b3 tool and microSD loader read:
//
//   [96ELN]
//   FILE_v10 = "gain.out.1=200"
//   FILE_v10 = "biquad.1.1.calc=[1,1000,35,1414,0,128]"
//
// Each line is a set command. Covers the loaded preset (mixer, gains, mute, phase, delays,
// biquads) and the device settings (output names, MODC blocks).
import { bytesHex, type Biquad, type DeviceState } from "./model";

export type Entry = [register: string, valueText: string];
const LABEL = "FILE_v10";

const bq = (b: Biquad) => `[${b.type},${b.f},${b.gain},${b.q},${b.b},${b.flags}]`;
const bypass = (b: Biquad) => b.type === 0 || (b.flags & 0x80) === 0;
const keys = (o: object) => Object.keys(o).map(Number).sort((a, b) => a - b);

/** the state as set commands; storage that was never written (255, 32767) is left out */
export function stateToEntries(s: DeviceState): Entry[] {
  const out: Entry[] = [];
  if (s.mixer.position) out.push(["mixer.position", String(s.mixer.position)]);
  for (const p of keys(s.mixer.values)) for (const c of keys(s.mixer.values[p])) for (const g of keys(s.mixer.values[p][c])) {
    const v = s.mixer.values[p][c][g];
    if (v !== 255) out.push([`mixer.${p}.${c}.${g}`, String(v)]);
  }
  const list = (name: string, v: number[], blank: number, count = v.length) =>
    v.slice(0, count).forEach((x, i) => { if (x !== blank) out.push([`${name}.${i + 1}`, String(x)]); });
  list("gain.in", s.gain.in, 255);
  list("gain.spdif", s.gain.spdif, 255);
  list("gain.out", s.gain.out, 255);
  list("mute.out", s.mute, 255);
  list("phase.out", s.phase, 255);
  list("delay", s.delay.out, 32767);
  list("delay.in", s.delay.in, 32767, s.gain.in.length);  // the firmware lists 8, only the inputs are input delays
  for (const n of keys(s.channelNames)) if (s.channelNames[n]) out.push([`system.channel.name.${n}`, `"${s.channelNames[n]}"`]);
  for (const n of keys(s.modc)) {
    const m = s.modc[n];
    out.push([`modc.${n}`, `[${m.enable},${m.type},${bytesHex(m.flags)},${m.events.join(",")},${bytesHex(m.sets)}]`]);
  }
  for (const ch of keys(s.biquads)) for (const n of keys(s.biquads[ch])) {
    const b = s.biquads[ch][n];
    if (b.type !== 255) out.push([`biquad.${ch}.${n}.calc`, bq(b)]);
  }
  return out;
}

export function toCfg(model: string, entries: Entry[], comments: string[] = []): string {
  return [...comments.map((c) => `; ${c}`), `[${model}]`, ...entries.map(([r, v]) => `${LABEL} = "${r}=${v}"`)].join("\n") + "\n";
}

export function parseCfg(text: string): { model: string | null; entries: Entry[] } {
  let model: string | null = null;
  const entries: Entry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) { model ??= line.slice(1, -1); continue; }
    const m = /^[^=]+?\s*=\s*"(.*)"$/.exec(line);
    if (!m || !m[1].includes("=")) continue;
    const i = m[1].indexOf("=");
    let reg = m[1].slice(0, i).trim();
    if (/^biquad\.\d+\.\d+$/.test(reg)) reg += ".calc";  // stored values as read: written through calc
    entries.push([reg, m[1].slice(i + 1).trim()]);
  }
  return { model, entries };
}

/** equal filters compare equal: any bypass is the same, whatever its f/q say */
function canonical(reg: string, v: string): string {
  if (reg.startsWith("biquad.")) {
    const n = v.replace(/[[\]]/g, "").split(",").map(Number);
    if (n[0] === 0 || ((n[5] ?? 128) & 0x80) === 0) return "bypass";
  }
  return v.replace(/\s+/g, "");
}

/** entries of the file whose value differs from the device (what a restore has to write) */
export function entriesToWrite(file: Entry[], s: DeviceState): Entry[] {
  const have = new Map(stateToEntries(s).map(([r, v]) => [r, canonical(r, v)]));
  const out = new Map<string, string>();
  for (const [r, v] of file) if (canonical(r, v) !== (have.get(r) ?? (r.startsWith("biquad.") ? "bypass" : undefined))) out.set(r, v);
  // mixer.position last: the values are in place before the profile becomes active
  return [...out].sort(([a], [b]) => Number(a === "mixer.position") - Number(b === "mixer.position"));
}

/** registers a restore may write; anything else in a file is refused (it is user input) */
export const restorable = (reg: string) =>
  /^(mixer\.(position|\d+\.\d+\.\d+)|gain\.(in|out|spdif)\.\d+|(mute|phase)\.out\.\d+|delay\.(in\.)?\d+|system\.channel\.name\.\d+|modc\.\d+|biquad\.\d+\.\d+\.calc|extender\.ir\.custom\.\d+)$/.test(reg);

export { bypass as isBypass };
