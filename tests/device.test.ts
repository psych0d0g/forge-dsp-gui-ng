import v40 from "./fixtures/V40-96ELN.json";
import v30 from "./fixtures/V30-96LN.json";
import { describe, expect, it } from "vitest";
import { ForgeClient, parseAnswer, parseValue } from "../src/lib/protocol";
import type { Transport } from "../src/lib/transport/types";
import { alignFromDistances, applyAnswer, bytesHex, cmToSamples, dbToRaw, delayGroups, delayMax, emptyState, exportState,
  hexBytes, isPort, modcTypeVersion, parseKeyInfo, rawToDb, readDevice, samplesToCm, samplesToMs } from "../src/lib/device";

/** answers recorded from the firmware's own command interpreter (tests/fixtures/make_fixture.py) */
const FIXTURES: Record<string, { answers: Record<string, string[]> }> = { "V40-96ELN": v40, "V30-96LN": v30 };
const fixture = (name: string) => FIXTURES[name].answers;

class Recorded implements Transport {
  name = "recorded";
  sent: string[] = [];
  private fn: (l: string) => void = () => {};
  constructor(private answers: Record<string, string[]>, private drop: (req: string) => boolean = () => false) {}
  async write(line: string) {
    const req = line.trim();
    this.sent.push(req);
    const out = this.drop(req) ? [` !.1 ${req.slice(6)} unknown command`] : this.answers[req] ?? [];
    setTimeout(() => out.forEach((l) => this.fn(l)), 0);
  }
  onLine(fn: (l: string) => void) { this.fn = fn; }
  async close() {}
}

describe("values", () => {
  it("keeps hex fields as text", () => {
    expect(parseValue("[1,108,02D7280F,0,0,0,0,1E100000]")).toEqual([1, 108, "02D7280F", 0, 0, 0, 0, "1E100000"]);
    expect(parseValue("-111.5")).toBe(-111.5);
  });
  it("hex bytes of modc flags and sets", () => {
    expect(hexBytes("02D7280F")).toEqual([2, 0xd7, 0x28, 0x0f]);
    expect(hexBytes(1000000)).toEqual([1, 0, 0, 0]);       // "01000000" parsed as a number
    expect(hexBytes(0)).toEqual([0, 0, 0, 0]);
    expect(bytesHex([2, 0xd7, 0x28, 0x0f])).toBe("02D7280F");
  });
  it("key info and gain scale", () => {
    expect(parseKeyInfo("BNS-96ELN-4.0-ABCDEF0102030405-CCBYNCSA-20990101-MDD")).toEqual({ model: "96ELN", pcb: "4.0" });
    const s = { min: 0, max: 255, zero: 223, step: 0.5, minDb: -111.5 };
    expect(rawToDb(s, 199)).toBe(-12);
    expect(dbToRaw(s, -12)).toBe(199);
    expect(dbToRaw(s, 40)).toBe(255);
  });
});

describe("readDevice", () => {
  it("reads a V40-96ELN with the port firmware", async () => {
    const t = new Recorded(fixture("V40-96ELN"));
    const progress: number[] = [];
    const s = await readDevice(new ForgeClient(t, 100, 10), (p) => progress.push(p.done / p.total));
    expect(s.identity).toMatchObject({ model: "96ELN", pcb: "4.0", firmware: "1.11.6000", port: "9.8.7-test",
      sampleRate: 96000, analogInPairs: 3, spdifPairs: 1, outPairs: 4, presets: 4, modcBlocks: 32 });
    expect(s.identity.keyInfoList).toEqual(["96ELN-4.0", "CORED8-4.0", "CORED8-4.1"]);
    expect(isPort(s)).toBe(true);
    expect(s.features.fr).toEqual([10, 22000]);
    expect(s.panes.bq[0]).toBe("BQ22.36");
    expect(s.scales.out).toEqual({ min: 0, max: 255, zero: 223, step: 0.5, minDb: -111.5 });
    expect(s.gain.out.slice(0, 2)).toEqual([223, 199]);
    expect(s.gain.in[0]).toBe(200);
    expect(s.mute[2]).toBe(1);
    expect(s.phase[3]).toBe(1);
    expect(s.delay.out[1]).toBe(48);
    const groups = delayGroups(s);                           // 8 outputs on 2 DSPs, 5840 samples each
    expect(groups.map((g) => g.channels)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(groups.map((g) => g.budget)).toEqual([5840, 5840]);
    expect(delayMax(s, groups[0], 1)).toBe(5840 - 48);       // what channel 2 uses is gone for channel 1
    expect(delayMax(s, groups[0], 2)).toBe(5840);
    expect(s.mixer.position).toBe(1);
    expect(s.mixer.values[1][3][2]).toBe(100);
    expect(s.mixer.values[1][4][1]).toBe(80);
    expect(s.biquads[1][1]).toEqual({ type: 1, f: 1000, gain: 35, q: 1414, b: 0, flags: 128 });
    expect(s.biquads[2][3]).toMatchObject({ type: 22, f: 80, b: 45 });
    expect(s.modc[9]).toEqual({ enable: 1, type: 108, flags: [2, 0xd7, 0x28, 0x0f], events: [0, 0, 0, 0], sets: [0x1e, 0x10, 0, 0] });
    expect(modcTypeVersion(s, 0x6c)).toBe(20);              // loudness: port extension
    expect(modcTypeVersion(s, 0x6d)).toBe(20);              // analog mixer
    expect(s.channelNames[1]).toBe("Front L");
    expect(s.clickless).toBe(1);
    expect(s.preset.loaded).toBe(0);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(t.sent).toContain("get.1 system.feature.attributes.hw");   // sub lists are followed
    expect(JSON.parse(exportState(s)).state.identity.model).toBe("96ELN");
  });

  it("reads a V30-96LN", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V30-96LN")), 100, 10));
    expect(s.identity).toMatchObject({ model: "96LN", pcb: "3.0", presets: 8 });
    expect(Object.keys(s.biquads).length).toBeGreaterThan(0);
  });

  it("original firmware: port registers are not asked after the first refusal", async () => {
    const portOnly = /system\.firmware\.port|key\.info\.list|mixer\.in|biquad\.clickless|system\.supply/;
    const t = new Recorded(fixture("V40-96ELN"), (r) => portOnly.test(r));
    const s = await readDevice(new ForgeClient(t, 100, 10));
    expect(s.identity.port).toBeNull();
    expect(isPort(s)).toBe(false);
    expect(s.clickless).toBeNull();
    expect(t.sent.filter((r) => portOnly.test(r))).toEqual(["get.1 system.firmware.port"]);
    expect(s.gain.out[0]).toBe(223);
  });
});

describe("applyAnswer", () => {
  it("takes single values and events into the state", () => {
    const s = emptyState();
    const ap = (l: string) => applyAnswer(s, parseAnswer(l)!);
    expect(ap(" <.1 gain.out=[1,2,3,4]")).toBe(true);
    expect(ap(" <.1 gain.out.2=150")).toBe(true);
    expect(s.gain.out).toEqual([1, 150, 3, 4]);
    expect(ap(" #.1 preset.loaded=2")).toBe(true);
    expect(s.preset.loaded).toBe(2);
    expect(ap(" <.1 mixer.2.5.8=100")).toBe(true);
    expect(s.mixer.values[2][5][8]).toBe(100);
    expect(ap(" <.1 system.temperature=325.20")).toBe(true);          // no unit = kelvin
    expect(s.temperature).toBeCloseTo(52.05, 2);
    expect(ap(" <.1 system.temperature.celsius=41.50")).toBe(true);
    expect(s.temperature).toBe(41.5);
    expect(ap(" <.1 system.temperature.fahrenheit=212.00")).toBe(true);
    expect(s.temperature).toBeCloseTo(100, 6);
    expect(ap(" <.1 system.temperature.celsius=nop")).toBe(true);
    expect(s.temperature).toBeNull();
    expect(ap(" *.1 gain.out.1 ok")).toBe(false);
    expect(ap(" !.1 foo unknown command")).toBe(false);
    expect(ap(" <.1 something.else=1")).toBe(false);
  });
});

describe("delay units and alignment", () => {
  it("converts as the firmware does", () => {
    expect(samplesToMs(48, 96000)).toBeCloseTo(0.5, 9);
    expect(samplesToCm(48, 96000)).toBeCloseTo(17.15, 2);     // firmware: delay.2.cm=17.15
    expect(cmToSamples(17.15, 96000)).toBe(48);
  });
  it("aligns to the farthest speaker", () => {
    expect(alignFromDistances([100, 134.3, null, 0], 96000)).toEqual([96, 0, 0, 0]);
  });
});

import { chipAt, ct7302Locked, errorName, es9018Locked, hardwareCheck, isEeprom, parseDspBoot, parseRegister, parseScan } from "../src/lib/device";

describe("diagnostics", () => {
  it("i2c answers that are not lists stay text", () => {
    const a = parseAnswer(" <.1 i2c.1.32.122=&HE4,&B11100100")!;
    expect(a.value).toBe("&HE4,&B11100100");
    expect(parseRegister(a.value)).toBe(0xe4);
    expect(parseScan(parseAnswer(" <.1 i2c.1.scan=[&H20,&H22,&H40,&H4E,&H68,&HA0,&HA8,&HE0]")!.value))
      .toEqual([0x20, 0x22, 0x40, 0x4e, 0x68, 0xa0, 0xa8, 0xe0]);
    expect(parseAnswer(" <.1 i2c.1.state=1, 1, &H01, &B00000001")!.value).toBe("1, 1, &H01, &B00000001");
  });
  it("chips, lock bits, error names", () => {
    expect(chipAt(2, 0x90)?.name).toBe("ES9018");
    expect(chipAt(1, 0x90)).toBeUndefined();
    expect(isEeprom(0xa8)).toBe(true);
    expect(ct7302Locked(0xe4)).toBe(false);    // measured without a signal
    expect(ct7302Locked(0x04)).toBe(true);
    expect(es9018Locked(0x01)).toBe(true);
    expect(errorName(3)).toBe("DSP 2: Kern antwortet nicht");        // tas3108_2_rdy (bit 2) + 1
    expect(errorName(5)).toBe("DSP 3: Kern antwortet nicht");
    expect(errorName(2)).toBe("DSP 1: Programmspeicher antwortet nicht");
    expect(errorName(129)).toMatch(/Schnittstelle/);
  });
  it("DSP start and hardware check", () => {
    const b = parseDspBoot([0, 52648, 900, 0, 0, 2, 41236, 1750, 0, 0, 0])!;
    expect(b.buses[1]).toEqual({ bus: 2, startMs: 2, edges: 41236, quietMs: 1750, timeout: false, retries: 0 });
    expect(b.restarted).toBe(false);
    expect(parseDspBoot([0, 52646, 900, 0, 0, 41244, 1750, 0])!.buses[1].quietMs).toBe(1750);   // before 2.0.0
    expect(hardwareCheck([110, 96, 63, 63, 2173, 2173])!.ok).toBe(true);
    expect(hardwareCheck([110, 96, 63, 43, 2173, 2173])!.ok).toBe(false);
  });
});
