// Compare two tunings (#24): the device against a file, or two presets. Both sides are register
// entries as in a .cfg file (stateToEntries, parseCfg); the rows say in words what differs.
import { t, tk, tx, type Key } from "../i18n/index.svelte";
import { typeInfo } from "../dsp/biquad";
import { canonical, type Entry } from "./tuning";
import { rawToDb, sourceNames, samplesToMs, type DeviceState } from "./model";

export type CompareGroup = "mixer" | "levels" | "outputs" | "delay" | "filters" | "names" | "modc";
export const COMPARE_GROUPS: CompareGroup[] = ["mixer", "levels", "outputs", "delay", "filters", "names", "modc"];
export const COMPARE_GROUP_NAME: Record<CompareGroup, Key> = {
  mixer: tk("compare.groupMixer"), levels: tk("compare.groupLevels"), outputs: tk("compare.groupOutputs"),
  delay: tk("compare.groupDelay"), filters: tk("compare.groupFilters"), names: tk("compare.groupNames"), modc: tk("compare.groupModc"),
};

export interface CompareRow { reg: string; group: CompareGroup; label: string; a: string; b: string }

/** registers that belong to a preset; channel names and control blocks are device settings */
export const inPreset = (reg: string) => !/^(system\.channel\.name|modc)\./.test(reg);

/** value of a register that is not in a list: what the device takes for it */
function absent(reg: string): string | undefined {
  if (reg.startsWith("biquad.")) return "bypass";
  if (reg.startsWith("system.channel.name.")) return '""';
  return undefined;
}

/** registers whose value differs between a and b, in the order of the groups, then numerically */
export function diffEntries(a: Entry[], b: Entry[]): { reg: string; a: string | undefined; b: string | undefined }[] {
  const ma = new Map(a.map(([r, v]) => [r, v])), mb = new Map(b.map(([r, v]) => [r, v]));
  const out: { reg: string; a: string | undefined; b: string | undefined }[] = [];
  for (const reg of new Set([...ma.keys(), ...mb.keys()])) {
    const va = ma.get(reg) ?? absent(reg), vb = mb.get(reg) ?? absent(reg);
    const ca = va === undefined ? undefined : canonical(reg, va), cb = vb === undefined ? undefined : canonical(reg, vb);
    if (ca !== cb) out.push({ reg, a: va, b: vb });
  }
  const order = (r: string) => COMPARE_GROUPS.indexOf(groupOf(r));
  return out.sort((x, y) => order(x.reg) - order(y.reg) || x.reg.localeCompare(y.reg, "en", { numeric: true }));
}

export function groupOf(reg: string): CompareGroup {
  if (reg.startsWith("mixer.")) return "mixer";
  if (reg.startsWith("gain.")) return "levels";
  if (/^(mute|phase)\.out\./.test(reg)) return "outputs";
  if (reg.startsWith("delay.")) return "delay";
  if (reg.startsWith("biquad.")) return "filters";
  if (reg.startsWith("system.channel.name.")) return "names";
  return "modc";
}

export interface Names { out(ch: number): string; in(n: number): string }

const nums = (v: string) => v.replace(/[[\]\s]/g, "").split(",").map(Number);
const num = (v: string) => Number(v);
const fmt = (x: number, digits = 1) => String(Number(x.toFixed(digits)));
const db = (x: number) => `${x > 0 ? "+" : ""}${fmt(x)} dB`;

/** the channel of a biquad: outputs 1..n, 35/36 the signal sums */
const bqChannel = (ch: number, n: Names) => (ch === 35 ? tx(tk("common.sumA")) : ch === 36 ? tx(tk("common.sumB")) : n.out(ch));
/** row C of the mixer: 1/2 the sums, 3.. the outputs; column G: 1..8 inputs, 9/10 the sums */
const mixRow = (c: number, n: Names) => (c <= 2 ? bqChannel(c + 34, n) : n.out(c - 2));
const mixCol = (g: number, n: Names) => (g >= 9 ? bqChannel(g + 26, n) : n.in(g));

export function describeReg(reg: string, n: Names): string {
  const p = reg.split(".");
  if (reg === "mixer.position") return t("compare.mixerProfile");
  if (p[0] === "mixer") {
    const [prof, c, g] = p.slice(1).map(Number);
    if (c === 1 && g === 10) return t("compare.inputSelect", { p: prof });
    return t("compare.mixerCell", { p: prof, to: mixRow(c, n), from: mixCol(g, n) });
  }
  if (p[0] === "gain") {
    const ch = num(p[2]);
    return p[1] === "out" ? t("compare.levelOut", { name: n.out(ch) }) : p[1] === "in" ? t("compare.levelIn", { name: n.in(ch) })
      : t("compare.levelSpdif", { name: n.in(ch + 6) });
  }
  if (p[0] === "mute") return t("compare.muteOf", { name: n.out(num(p[2])) });
  if (p[0] === "phase") return t("compare.phaseOf", { name: n.out(num(p[2])) });
  if (p[0] === "delay") return p[1] === "in" ? t("compare.delayIn", { name: n.in(num(p[2])) }) : t("compare.delayOut", { name: n.out(num(p[1])) });
  if (p[0] === "biquad") return t("compare.filterBand", { name: bqChannel(num(p[1]), n), n: p[2] });
  if (reg.startsWith("system.channel.name.")) return t("compare.nameOf", { n: p[3] });
  if (p[0] === "modc") return t("compare.modcBlock", { n: p[1] });
  return reg;
}

/** the value in words, with the scales of the connected device */
export function describeValue(reg: string, v: string | undefined, s: DeviceState): string {
  if (v === undefined) return "—";
  const p = reg.split(".");
  if (p[0] === "mixer") {
    if (reg === "mixer.position") return t("common.profileN", { n: num(v) });
    if (p[2] === "1" && p[3] === "10") return sourceNames(s).find((x) => x.value === num(v))?.label ?? v;
    return `${num(v)} %`;
  }
  if (p[0] === "gain") {
    const sc = s.scales[p[1] as "out" | "in" | "spdif"];
    return sc ? db(rawToDb(sc, num(v))) : v;
  }
  if (p[0] === "mute") return num(v) ? t("compare.muted") : t("compare.on");
  if (p[0] === "phase") return num(v) ? t("compare.inverted") : t("compare.normal");
  if (p[0] === "delay") {
    const rate = s.identity.sampleRate || 96000;
    return `${fmt(samplesToMs(num(v), rate), 2)} ms`;
  }
  if (p[0] === "biquad") {
    if (canonical(reg, v) === "bypass") return t("compare.bypass");
    const [type, f, gain, q, b] = nums(v);
    const ti = typeInfo(type);
    const parts = [ti ? tx(ti.name) : t("common.typeN", { n: type }), `${f} Hz`];
    if (ti?.gain) parts.push(db(gain / 10));
    if (ti?.q) parts.push(`Q ${fmt(q / 1000, 2)}`);
    if (ti?.b) parts.push(ti.b.startsWith("Winkel") ? `${b}°` : `${t("compare.bandwidth")} ${b} Hz`);
    return parts.join(", ");
  }
  if (reg.startsWith("system.channel.name.")) return v === '""' ? t("compare.noName") : v;
  return v;
}

export function compareRows(a: Entry[], b: Entry[], s: DeviceState, n: Names, only: (reg: string) => boolean = () => true): CompareRow[] {
  return diffEntries(a.filter(([r]) => only(r)), b.filter(([r]) => only(r)))
    .map((d) => ({ reg: d.reg, group: groupOf(d.reg), label: describeReg(d.reg, n), a: describeValue(d.reg, d.a, s), b: describeValue(d.reg, d.b, s) }));
}
