// Crossover wizard (#25): roles of the output pairs (sub, low, mid, high), crossover frequencies and
// slope -> high and low passes per output, polarity and names. The outputs come in pairs (1/2,
// 3/4, …: left odd, right even), as the original GUI and the DSP programs pair them.
import type { Biquad } from "../device/model";
import { tk, type Key } from "../i18n/index.svelte";

export type Role = "off" | "sub" | "low" | "mid" | "high";
export const ROLES: Role[] = ["off", "sub", "low", "mid", "high"];
/** order from the bottom; a band takes everything between its neighbours */
const RANK: Record<Exclude<Role, "off">, number> = { sub: 0, low: 1, mid: 2, high: 3 };
export const ROLE_NAME: Record<Role, Key> = { off: tk("xover.roleOff"), sub: tk("xover.roleSub"), low: tk("xover.roleLow"),
  mid: tk("xover.roleMid"), high: tk("xover.roleHigh") };
/** short names for the outputs (the device takes 16 characters) */
export const ROLE_SHORT: Record<Role, Key> = { off: tk("xover.roleOff"), sub: tk("xover.shortSub"), low: tk("xover.shortLow"),
  mid: tk("xover.shortMid"), high: tk("xover.shortHigh") };

export type Slope = "bw6" | "bw12" | "lr12" | "lr24" | "bw24" | "lr48";
export const SLOPES: { id: Slope; name: Key; invert: boolean }[] = [
  { id: "lr24", name: tk("xover.lr24"), invert: false },
  { id: "lr48", name: tk("xover.lr48"), invert: false },
  { id: "bw24", name: tk("xover.bw24"), invert: false },
  { id: "lr12", name: tk("xover.lr12"), invert: true },   // second order: the bands are 180° apart at fc
  { id: "bw12", name: tk("xover.bw12"), invert: true },
  { id: "bw6", name: tk("xover.bw6"), invert: false },
];

/** the low or high pass of a slope at f, as biquads of the firmware (types 2…13, q in 1/1000) */
export function passes(slope: Slope, f: number, high: boolean): Biquad[] {
  const b = (type: number, q = 707): Biquad => ({ type: high ? type + 6 : type, f, gain: 0, q, b: 0, flags: 0x80 });
  switch (slope) {
    case "bw6": return [b(2)];
    case "bw12": return [b(3)];
    case "lr12": return [b(5)];
    case "lr24": return [b(3), b(3)];                     // Linkwitz-Riley 4th order = two Butterworth 2nd order
    case "bw24": return [b(7, 541), b(7, 1307)];          // Butterworth 4th order
    case "lr48": return [b(7, 541), b(7, 1307), b(7, 541), b(7, 1307)];
  }
}

export interface XoverSetup {
  /** role per output pair (index 0 = outputs 1/2) */
  roles: Role[];
  /** the crossover below each band (Hz), used where a band sits above another one */
  freq: Record<"low" | "mid" | "high", number>;
  slope: Slope;
  /** high pass below the lowest band (subsonic), 0 = none */
  subsonic: number;
}

export const DEFAULT_FREQ = { low: 80, mid: 400, high: 3000 };

export interface OutputPlan { out: number; role: Role; filters: Biquad[]; invert: boolean; name: string }

/** the bands in use, from the bottom */
export const bandsInUse = (roles: Role[]) =>
  [...new Set(roles.filter((r): r is Exclude<Role, "off"> => r !== "off"))].sort((a, b) => RANK[a] - RANK[b]);

/**
 * Filters, polarity and name of every output of a pair with a role. Between two neighbouring bands
 * in use the crossover frequency of the upper one applies. With 2nd-order slopes every band above a
 * crossover is inverted against the one below (counted from the bottom).
 */
export function planCrossover(s: XoverSetup, names: Record<Role, string>): OutputPlan[] {
  const bands = bandsInUse(s.roles);
  const inv = SLOPES.find((x) => x.id === s.slope)?.invert ?? false;
  const out: OutputPlan[] = [];
  s.roles.forEach((role, pair) => {
    if (role === "off") return;
    const i = bands.indexOf(role);
    const below = i > 0 ? s.freq[role as "low" | "mid" | "high"] : 0;
    const above = i < bands.length - 1 ? s.freq[bands[i + 1] as "low" | "mid" | "high"] : 0;
    const filters = [
      ...(below ? passes(s.slope, below, true) : s.subsonic ? passes("bw12", s.subsonic, true) : []),
      ...(above ? passes(s.slope, above, false) : []),
    ];
    for (const side of [0, 1]) out.push({ out: pair * 2 + 1 + side, role, filters, invert: inv && i % 2 === 1,
      name: `${names[role]} ${side ? "R" : "L"}` });
  });
  return out;
}

/** what is no crossover filter (EQ bands, shelves, all passes …) stays when the wizard writes */
export const isCrossoverFilter = (b: Biquad) => b.type >= 2 && b.type <= 13;

/**
 * The writes for one output: its crossover filters (high/low passes) are replaced by the planned
 * ones, the rest stays. Slots: the old crossover filters first, then empty ones. lost: did not fit.
 */
export function crossoverWrites(slots: Record<number, Biquad>, filters: Biquad[]): { writes: [number, Biquad][]; lost: number } {
  const nrs = Object.keys(slots).map(Number).sort((a, b) => a - b);
  const old = nrs.filter((n) => isCrossoverFilter(slots[n]));
  const room = [...old, ...nrs.filter((n) => slots[n].type === 0)];
  const writes: [number, Biquad][] = filters.slice(0, room.length).map((bq, i) => [room[i], bq]);
  for (const n of old.slice(filters.length)) writes.push([n, { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 }]);
  return { writes, lost: Math.max(0, filters.length - room.length) };
}
