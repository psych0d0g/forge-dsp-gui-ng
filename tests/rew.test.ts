import { describe, expect, it } from "vitest";
import { parseRew, planRew } from "../src/lib/dsp/rew";
import { DEFAULT_LIMITS } from "../src/lib/device";

// as REW 5.40 writes it (File › Export › Filter settings as text, Equaliser: Generic)
const EXPORT = `Filter Settings file

Room EQ V5.40
Dated: 14.11.2026 18:30:00

Notes:Front L

Equaliser: Generic
Front L
Filter  1: ON  PK       Fc   63,0 Hz  Gain  -8,0 dB  Q  4,00
Filter  2: ON  PK       Fc   125 Hz  Gain -15.5 dB  Q 6.000
Filter  3: ON  LSC      Fc   90.0 Hz  Gain   4.0 dB  Q  0.71
Filter  4: ON  HP       Fc   35.0 Hz
Filter  5: ON  LS 6dB   Fc  100 Hz  Gain 3.0 dB
Filter  6: ON  NO       Fc  2000 Hz  Q 20.0
Filter  7: OFF PK       Fc  500 Hz  Gain -3.0 dB  Q 2.00
Filter  8: ON  None
Filter  9: ON  Modal    Fc  45.0 Hz  Gain -6.0 dB  Q 8.0  T60 target 400 ms
Filter 10: ON  BP       Fc  1000 Hz  Q 2.0
`;

describe("filters from REW (#23)", () => {
  it("types, values and what does not fit", () => {
    const r = parseRew(EXPORT, DEFAULT_LIMITS, (t) => t !== 17);
    expect(r.map((x) => x.nr)).toEqual([1, 2, 3, 4, 5, 6, 9, 10]);                     // off and None left out
    expect(r[0]).toMatchObject({ kind: "PK", bq: { type: 1, f: 63, gain: -80, q: 4000, flags: 128 }, note: null });  // decimal comma
    expect(r[1]).toMatchObject({ bq: { gain: -120, q: 6000 }, note: "rew.limited" });   // the original takes −12 dB at most
    expect(r[2].bq).toMatchObject({ type: 14, f: 90, gain: 40, q: 710 });
    expect(r[3].bq).toMatchObject({ type: 9, f: 35, gain: 0 });                        // Butterworth 12 dB
    expect(r[4]).toMatchObject({ kind: "LS 6dB", bq: null, note: "rew.notSupported" }); // first-order shelf
    expect(r[5].bq).toMatchObject({ type: 16, f: 2000, b: 100 });                        // notch: bandwidth f / Q
    expect(r[6]).toMatchObject({ kind: "Modal", bq: null });
    expect(r[7]).toMatchObject({ kind: "BP", bq: null });                                // band pass: not on this device
  });
  it("nothing to take from other text", () => {
    expect(parseRew("Hallo\nFilter: kaputt", DEFAULT_LIMITS)).toEqual([]);
  });
});

describe("REW filters into a channel (#23)", () => {
  const e = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
  const pk = (f: number) => ({ type: 1, f, gain: -30, q: 2000, b: 0, flags: 128 });
  const slots = { 1: pk(100), 2: { ...e }, 3: pk(300), 4: { ...e } };
  it("into the empty slots", () => {
    expect(planRew(slots, [pk(50), pk(60), pk(70)], false)).toEqual({ writes: [[2, pk(50)], [4, pk(60)]], lost: 1 });
  });
  it("replacing the channel: the rest is emptied", () => {
    expect(planRew(slots, [pk(50)], true)).toEqual({ writes: [[1, pk(50)], [3, e]], lost: 0 });
  });
});
