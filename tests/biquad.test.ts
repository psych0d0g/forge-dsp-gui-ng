import { describe, expect, it } from "vitest";
import fx from "./fixtures/biquad.json";
import { chainResponse, coeffs, logFreqs, response, TYPES, BYPASS, viewRange } from "../src/lib/dsp/biquad";

/** 5.23 two's complement in 28 bits */
const fix = (h: string) => { let x = parseInt(h, 16) & 0x0fffffff; if (x & 0x08000000) x -= 1 << 28; return x / 8388608; };

describe("biquad coefficients", () => {
  it("match the firmware for all types (fixture from its native build)", () => {
    for (const c of fx.cases) {
      const [type, f, gain, q, b] = c.in;
      const [A2, A1, B2, B1, B0] = c.raw.map(fix);
      const got = coeffs({ type, f, gain, q, b, flags: 128 }, fx.rate);
      // 5.23 words are truncated: 1.2e-7 per coefficient
      for (const [name, want] of [["b0", B0], ["b1", B1], ["b2", B2], ["a1", -A1], ["a2", -A2]] as const)
        expect(got[name], `${name} of ${JSON.stringify(c.in)}`).toBeCloseTo(want, 5);
    }
    expect(new Set(fx.cases.map((c) => c.in[0])).size).toBe(22);
  });
  it("every listed type is covered by the fixture, and bypass cases", () => {
    const tested = new Set(fx.cases.map((c) => c.in[0]));
    for (const t of TYPES) if (t.type !== 0) expect(tested.has(t.type), t.name).toBe(true);
    expect(coeffs({ type: 1, f: 1000, gain: 60, q: 707, b: 0, flags: 0 }, 96000)).toBe(BYPASS);   // not enabled
    expect(coeffs({ type: 0, f: 1000, gain: 60, q: 707, b: 0, flags: 128 }, 96000)).toBe(BYPASS);
    expect(coeffs({ type: 22, f: 80, gain: 0, q: 707, b: 0, flags: 128 }, 96000)).toBe(BYPASS);
  });
});

describe("response", () => {
  it("EQ: gain at f, flat far away; all pass: flat, -90 deg at f", () => {
    const eq = coeffs({ type: 1, f: 1000, gain: 60, q: 1414, b: 0, flags: 128 }, 96000);
    const r = chainResponse([eq], [20, 1000, 20000], 96000);
    expect(r.db[1]).toBeCloseTo(6, 2);
    expect(Math.abs(r.db[0])).toBeLessThan(0.05);
    const ap = coeffs({ type: 21, f: 500, gain: 0, q: 0, b: 0, flags: 128 }, 96000);
    const a = chainResponse([ap], [500], 96000);
    expect(a.db[0]).toBeCloseTo(0, 6);
    expect(a.phase[0]).toBeCloseTo(-90, 3);
    const [re, im] = response(BYPASS, 1234, 96000);
    expect([re, im]).toEqual([1, 0]);
  });
  it("chains multiply: two Butterworth low passes are -6 dB at f (Linkwitz-Riley 24)", () => {
    const lp = coeffs({ type: 3, f: 2000, gain: 0, q: 0, b: 0, flags: 128 }, 96000);
    expect(chainResponse([lp, lp], [2000], 96000).db[0]).toBeCloseTo(-6.02, 1);
    expect(logFreqs(10, 1000, 3)).toEqual([10, 100, 1000]);
  });
});

describe("section of the curve", () => {
  const full: [number, number] = [10, 22000];
  it("an octave and at least 750 Hz around the filters, on 1-2-5 ends, inside the full range", () => {
    expect(viewRange([3200, 6300, 12000], full)).toEqual([1000, 22000]);     // 1600 -> 1000; 24000 -> capped
    expect(viewRange([80, 320], full)).toEqual([10, 2000]);                   // 80 - 750 < 10; 320 + 750 = 1070 -> 2000
    expect(viewRange([1000], full)).toEqual([200, 2000]);                     // 250 -> 200; 2000
    expect(viewRange([], full)).toEqual(full);
    expect(viewRange([0], full)).toEqual(full);
  });
});
