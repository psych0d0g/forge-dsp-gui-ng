import { describe, expect, it } from "vitest";
import { coeffs, logFreqs, sumResponse } from "../src/lib/dsp/biquad";
import { crossoverWrites, passes, planCrossover, type XoverSetup } from "../src/lib/dsp/crossover";

const names = { off: "", sub: "Sub", low: "Tiefton", mid: "Mittelton", high: "Hochton" };
const setup = (roles: XoverSetup["roles"], slope: XoverSetup["slope"] = "lr24"): XoverSetup =>
  ({ roles, freq: { low: 80, mid: 400, high: 3000 }, slope, subsonic: 0 });

describe("crossover wizard (#25)", () => {
  it("3 ways + sub: each band between its neighbours", () => {
    const p = planCrossover(setup(["high", "mid", "low", "sub"]), names);
    expect(p.map((o) => [o.out, o.name])).toEqual([[1, "Hochton L"], [2, "Hochton R"], [3, "Mittelton L"], [4, "Mittelton R"],
      [5, "Tiefton L"], [6, "Tiefton R"], [7, "Sub L"], [8, "Sub R"]]);
    const f = (o: number) => p.find((x) => x.out === o)!.filters.map((b) => [b.type, b.f]);
    expect(f(1)).toEqual([[9, 3000], [9, 3000]]);                      // high: high pass only (LR24 = 2x BW12)
    expect(f(3)).toEqual([[9, 400], [9, 400], [3, 3000], [3, 3000]]);  // mid: band pass 400 … 3000
    expect(f(5)).toEqual([[9, 80], [9, 80], [3, 400], [3, 400]]);
    expect(f(7)).toEqual([[3, 80], [3, 80]]);                          // sub: low pass only
    expect(p.every((o) => !o.invert)).toBe(true);
  });

  it("2 ways with 12 dB: the upper band inverted; subsonic below the lowest", () => {
    const p = planCrossover({ ...setup(["high", "low", "off", "off"], "lr12"), subsonic: 30 }, names);
    expect(p.map((o) => o.invert)).toEqual([true, true, false, false]);
    expect(p[2].filters.map((b) => [b.type, b.f])).toEqual([[9, 30], [5, 3000]]);   // the low band ends at the high one's frequency
  });

  it("LR24 adds up flat (electrical sum within 0.1 dB)", () => {
    const rate = 96000, fr = logFreqs(20, 20000, 200);
    const part = (hp: boolean) => ({ list: passes("lr24", 1000, hp).map((b) => coeffs(b, rate)), gain: 1, invert: false, delay: 0 });
    const s = sumResponse([part(false), part(true)], fr, rate);
    expect(Math.max(...s.db.map(Math.abs))).toBeLessThan(0.1);
  });

  it("keeps EQ bands, replaces old crossover filters", () => {
    const e = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
    const eq = { type: 1, f: 200, gain: -30, q: 2000, b: 0, flags: 128 };
    const hp = { type: 9, f: 100, gain: 0, q: 707, b: 0, flags: 128 };
    const slots = { 1: eq, 2: hp, 3: { ...e }, 4: hp };
    const r = crossoverWrites(slots, passes("lr24", 80, true));
    expect(r.writes.map(([n, b]) => [n, b.type, b.f])).toEqual([[2, 9, 80], [4, 9, 80]]);
    expect(crossoverWrites(slots, passes("bw12", 80, true)).writes.map(([n, b]) => [n, b.type])).toEqual([[2, 9], [4, 0]]);
  });
});
