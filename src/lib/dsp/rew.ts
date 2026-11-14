// Filters from REW (Room EQ Wizard, #23): its "Filter Settings" text export (Equalizer "Generic",
// also the Equalizer APO form) as biquads of the Forge. One filter per line:
//
//   Filter  1: ON  PK       Fc   63.0 Hz  Gain  -5.0 dB  Q  4.00
//   Filter  2: ON  LSC      Fc  100.0 Hz  Gain   3.0 dB  Q  0.71
//   Filter  3: ON  HP       Fc   40.0 Hz
//   Filter  4: OFF None
//
// Values outside what the firmware takes (gain −12…+6 dB in the original) are limited and marked.
import { tk, type Key } from "../i18n/index.svelte";
import type { Biquad } from "../device/model";
import type { Limits } from "../device/limits";

export interface RewFilter {
  /** REW's filter number */
  nr: number;
  /** the REW type as written (PK, LSC, HP …) */
  kind: string;
  /** the biquad, null when the Forge has no such filter */
  bq: Biquad | null;
  /** why it is not taken or what was changed */
  note: Key | null;
}

const Q_BUTTER = 707;
const num = (re: RegExp, s: string) => { const m = re.exec(s); return m ? Number(m[1].replace(",", ".")) : null; };

/** REW type -> Forge type and what it needs; null = no counterpart */
function mapType(kind: string): { type: number; q?: "given" | number; gain?: boolean } | null {
  switch (kind.replace(/\s+/g, " ").toUpperCase()) {
    case "PK": case "PEQ": return { type: 1, q: "given", gain: true };
    case "LP": case "LP 12DB": return { type: 3 };
    case "HP": case "HP 12DB": return { type: 9 };
    case "LPQ": return { type: 7, q: "given" };
    case "HPQ": return { type: 13, q: "given" };
    case "LP1": case "LP 6DB": return { type: 2 };
    case "HP1": case "HP 6DB": return { type: 8 };
    case "LS": case "LS 12DB": return { type: 14, q: Q_BUTTER, gain: true };
    case "HS": case "HS 12DB": return { type: 15, q: Q_BUTTER, gain: true };
    case "LSC": case "LSQ": return { type: 14, q: "given", gain: true };
    case "HSC": case "HSQ": return { type: 15, q: "given", gain: true };
    case "NO": return { type: 16, q: "given" };
    case "AP": return { type: 20, q: "given" };
    case "BP": return { type: 17, q: "given" };
  }
  return null;
}

/**
 * The filters of a REW export. Lines that are no filters are left out; filters that are off are
 * left out too. canType: whether the device computes a Forge type (band pass needs the port).
 */
export function parseRew(text: string, lim: Limits, canType: (type: number) => boolean = () => true): RewFilter[] {
  const out: RewFilter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // REW numbers its filters; Equalizer APO may write "Filter: ON PK …" without one
    const m = /^\s*Filter\s*(\d*)\s*:\s*(ON|OFF)\s+(.+)$/i.exec(raw);
    if (!m || m[2].toUpperCase() === "OFF") continue;
    const rest = m[3];
    const kind = (/^([A-Za-z]+\d?(?:\s+(?:6|12)\s*dB)?)/i.exec(rest)?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (!kind || /^none$/i.test(kind)) continue;
    const nr = m[1] ? Number(m[1]) : out.length + 1;
    const t = mapType(kind);
    if (!t || !canType(t.type)) { out.push({ nr, kind, bq: null, note: tk("rew.notSupported") }); continue; }
    const fc = num(/Fc\s+([\d.,]+)\s*Hz/i, rest);
    if (fc === null) { out.push({ nr, kind, bq: null, note: tk("rew.noFrequency") }); continue; }
    const gainDb = num(/Gain\s+(-?[\d.,]+)\s*dB/i, rest) ?? 0;
    const qGiven = num(/\bQ\s+([\d.,]+)/i, rest);
    let note: Key | null = null;
    const clamp = (v: number, [a, b]: [number, number]) => { const c = Math.min(b, Math.max(a, v)); if (c !== v) note = tk("rew.limited"); return c; };
    const f = clamp(Math.round(fc), lim.freq);
    let q = t.q === "given" ? Math.round((qGiven ?? (t.type === 16 ? 30 : 0.707)) * 1000) : t.q ?? 0;
    if (q && t.type !== 16) q = clamp(q, lim.bqQ);  // the notch keeps its Q only as bandwidth
    const gain = t.gain ? clamp(Math.round(gainDb * 10), lim.bqGain) : 0;
    // notch: the Forge takes its bandwidth in Hz (f / Q)
    const b = t.type === 16 ? clamp(Math.max(1, Math.round(f / (q / 1000))), lim.bqB) : 0;
    out.push({ nr, kind, bq: { type: t.type, f, gain, q: t.type === 16 ? 0 : q, b, flags: 0x80 }, note });
  }
  return out;
}

const EMPTY: Biquad = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };

/**
 * Where the filters go in a channel (slot number -> biquad). replace: the channel holds only them
 * afterwards (its other filters are emptied); otherwise they take the empty slots. lost: how many
 * did not fit.
 */
export function planRew(slots: Record<number, Biquad>, filters: Biquad[], replace: boolean): { writes: [number, Biquad][]; lost: number } {
  const nrs = Object.keys(slots).map(Number).sort((a, b) => a - b);
  const room = replace ? nrs : nrs.filter((n) => slots[n].type === 0);
  const writes: [number, Biquad][] = [];
  filters.slice(0, room.length).forEach((bq, i) => writes.push([room[i], bq]));
  if (replace) for (const n of room.slice(filters.length)) if (slots[n].type !== 0) writes.push([n, { ...EMPTY }]);
  return { writes, lost: Math.max(0, filters.length - room.length) };
}
