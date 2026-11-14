import { describe, expect, it } from "vitest";
import { compareRows, diffEntries, inPreset, stateToEntries } from "../src/lib/device";
import { demoPreset, demoState } from "../src/lib/device/demo";

const names = { out: (n: number) => `Out ${n}`, in: (n: number) => `In ${n}` };

describe("compare two tunings (#24)", () => {
  it("only what differs; bypass in any form is the same, a missing biquad is bypass", () => {
    expect(diffEntries(
      [["gain.out.1", "200"], ["biquad.1.1.calc", "[0,1000,0,707,0,0]"], ["biquad.1.2.calc", "[1,1000,30,707,0,128]"]],
      [["gain.out.1", "200"], ["biquad.1.1.calc", "[1,500,0,707,0,0]"], ["biquad.1.3.calc", "[0,0,0,0,0,0]"]],
    )).toEqual([{ reg: "biquad.1.2.calc", a: "[1,1000,30,707,0,128]", b: "bypass" }]);
  });

  it("rows in words, in the order of the pages", () => {
    const s = demoState();
    const rows = compareRows(stateToEntries(s), stateToEntries(demoPreset(2)), s, names, inPreset);
    expect(rows.map((r) => r.group)).toEqual(["levels", "levels", "outputs", "outputs", "delay", "filters", "filters"]);
    expect(rows[0]).toMatchObject({ label: "Pegel Out 1", a: "-6 dB", b: "-7 dB" });
    expect(rows[2]).toMatchObject({ label: "Stumm Out 7", a: "stumm", b: "an" });
    expect(rows[4]).toMatchObject({ label: "Laufzeit Out 2", a: "0.13 ms", b: "0.23 ms" });
    expect(rows[5]).toMatchObject({ label: "Out 1, Band 1", b: "EQ (Güte), 6300 Hz, -4.5 dB, Q 2" });
    expect(rows[6]).toMatchObject({ label: "Out 3, Band 7", a: "aus", b: "EQ (Güte), 750 Hz, +3 dB, Q 1.41" });
  });

  it("the same preset: nothing; channel names and control blocks are not part of a preset", () => {
    const s = demoState(), b = demoState();
    b.channelNames[1] = "anders";
    expect(compareRows(stateToEntries(s), stateToEntries(b), s, names, inPreset)).toEqual([]);
    expect(compareRows(stateToEntries(s), stateToEntries(b), s, names)[0]).toMatchObject({ group: "names", b: '"anders"' });
  });
});
