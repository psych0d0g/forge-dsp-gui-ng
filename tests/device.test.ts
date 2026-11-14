import v40 from "./fixtures/V40-96ELN.json";
import v30 from "./fixtures/V30-96LN.json";
import { describe, expect, it } from "vitest";
import { ForgeClient, parseAnswer, parseValue } from "../src/lib/protocol";
import type { Transport } from "../src/lib/transport/types";
import { deviceHasChip, modcWrites, vuSum } from "../src/lib/device";
import { alignFromDistances, applyAnswer, inputDelayGroup, limitsOf, bytesHex, cmToSamples, dbToRaw, delayGroups, delayMax, emptyState, exportState,
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
  it("asks a lost answer once more (#2)", async () => {
    const t = new Recorded(fixture("V40-96ELN"));
    let lost = 0;
    const write = t.write.bind(t);
    t.write = async (line: string) => {
      if (line.trim() === "get.1 gain.out" && !lost++) { t.sent.push(line.trim()); return; }  // first one: no answer
      return write(line);
    };
    const s = await readDevice(new ForgeClient(t, 100, 10));
    expect(t.sent.filter((l) => l === "get.1 gain.out").length).toBe(2);
    expect(s.gain.out.slice(0, 2)).toEqual([223, 199]);
  });
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
    expect(s.inputNames?.[7]).toBe("TV");                              // system.channel.in.N (#55)
    expect(s.limits.out).toEqual([5840, 3, 3, 3, 3, 2, 2, 2, 2]);      // system.limits (#54)
    expect(delayGroups(s).map((g) => g.channels)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(inputDelayGroup(s)?.channels).toEqual([1, 2, 3, 4, 5, 6]);
    expect(limitsOf(s).bqGain).toEqual([-120, 60]);
    expect(limitsOf(s).types).toHaveLength(23);
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
    expect(inputDelayGroup(s)).toBeNull();                              // the 96LN has no input delays
    expect(delayGroups(s).map((g) => g.channels)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(Object.keys(s.biquads).length).toBeGreaterThan(0);
  });

  it("original firmware: port registers are not asked after the first refusal", async () => {
    const portOnly = /system\.firmware\.port|key\.info\.list|mixer\.in|biquad\.clickless|system\.supply|system\.limits|system\.channel\.in|system\.vu/;
    const t = new Recorded(fixture("V40-96ELN"), (r) => portOnly.test(r));
    const s = await readDevice(new ForgeClient(t, 100, 10));
    expect(s.identity.port).toBeNull();
    expect(isPort(s)).toBe(false);
    expect(s.clickless).toBeNull();
    expect(t.sent.filter((r) => portOnly.test(r))).toEqual(["get.1 system.firmware.port"]);
    expect(s.inputNames).toBeNull();                                     // names stay in the browser then
    expect(limitsOf(s).bqGain).toEqual([-120, 60]);                      // BASCOM defaults
    expect(s.gain.out[0]).toBe(223);
  });
});

describe("applyAnswer", () => {
  it("keeps input and output levels apart (forge-dsp-firmware#52)", () => {
    const s = emptyState();
    const ap = (l: string) => applyAnswer(s, parseAnswer(l)!);
    expect(ap(" <.1 system.vu=[0,0,0,0,0,0,162,202]")).toBe(true);
    expect(ap(" <.1 system.vu.out=[190,150,191,151,190,150,191,152]")).toBe(true);
    expect(s.vu).toEqual([0, 0, 0, 0, 0, 0, 162, 202]);
    expect(s.vuOut).toEqual([190, 150, 191, 151, 190, 150, 191, 152]);
    expect(ap(" <.1 system.vu.x=[1]")).toBe(false);
  });
  it("sums the outputs per side for the header meter", () => {
    // two equal left outputs: +3 dB (6 steps), right only output 2
    expect(vuSum([200, 150, 200, 0, 0, 0, 0, 0], 0)).toBe(206);
    expect(vuSum([200, 150, 200, 0, 0, 0, 0, 0], 1)).toBe(150);
    expect(vuSum([0, 0, 0, 0], 0)).toBe(0);
    expect(vuSum([255, 0, 255, 0], 0)).toBe(255);                      // capped at 0 dBFS
    // own assignment: left only output 5, right outputs 1 and 2, the rest not counted
    const sides = [1, 1, -1, -1, 0, -1, -1, -1];
    expect(vuSum([200, 200, 255, 255, 180, 255, 255, 255], 0, sides)).toBe(180);
    expect(vuSum([200, 200, 255, 255, 180, 255, 255, 255], 1, sides)).toBe(206);
  });
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

import { entriesToWrite, parseCfg, restorable, stateToEntries, toCfg } from "../src/lib/device";
import { setLineRaw } from "../src/lib/protocol";

describe("tuning file", () => {
  it("round trip in the format of the original GUI", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V40-96ELN")), 100, 10));
    const entries = stateToEntries(s);
    const cfg = toCfg(s.identity.model, entries, ["test"]);
    expect(cfg.startsWith("; test\n[96ELN]\n")).toBe(true);
    expect(cfg).toContain('FILE_v10 = "gain.out.2=199"');
    expect(cfg).toContain('FILE_v10 = "biquad.1.1.calc=[1,1000,35,1414,0,128]"');
    expect(cfg).toContain('FILE_v10 = "modc.9=[1,108,02D7280F,0,0,0,0,1E100000]"');
    expect(cfg).toContain('FILE_v10 = "system.channel.name.1="Front L""');
    expect(cfg).not.toMatch(/delay\.in\.[78]=/);
    const back = parseCfg(cfg);
    expect(back.model).toBe("96ELN");
    expect(back.entries).toEqual(entries);
    expect(entriesToWrite(back.entries, s)).toEqual([]);          // nothing differs from the device
    expect(entries.every(([r]) => restorable(r))).toBe(true);
  });
  it("finds what differs, treats every bypass alike, position last", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V40-96ELN")), 100, 10));
    const file = parseCfg(`[96ELN]
FILE_v10 = "mixer.position=2"
FILE_v10 = "gain.out.2=150"
FILE_v10 = "gain.out.1=223"
FILE_v10 = "biquad.1.2=[0,500,0,707,0,0]"
FILE_v10 = "biquad.3.1.calc=[3,80,0,707,0,128]"
`).entries;
    expect(entriesToWrite(file, s)).toEqual([["gain.out.2", "150"], ["biquad.3.1.calc", "[3,80,0,707,0,128]"], ["mixer.position", "2"]]);
    expect(restorable("system.boot")).toBe(false);
    expect(restorable("i2c.1.32.4")).toBe(false);
    expect(setLineRaw("modc.9", "[1,108,02D7280F,0,0,0,0,1E100000]", { checksum: true }))
      .toMatch(/^set\.1 modc\.9=\[1,108,02D7280F,0,0,0,0,1E100000\];[0-9A-F]{2}\r\n$/);
  });
});

import { availableTypes, emptyModc, eventOptions, modcName, modcText, modcType, wordGet, wordSet } from "../src/lib/device";

describe("MODC blocks", () => {
  it("text as the firmware prints it, names, available types", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V40-96ELN")), 100, 10));
    expect(modcText(s.modc[9])).toBe("[1,108,02D7280F,0,0,0,0,1E100000]");
    expect(modcText(emptyModc())).toBe("[0,0,00000000,0,0,0,0,00000000]");
    expect(modcName(108)).toBe("Loudness");
    expect(modcName(200)).toBe("Typ 200");
    const types = availableTypes(s).map((t) => t.type);
    expect(types).toContain(108);      // port extension, version 20
    expect(types).toContain(66);
    expect(types).not.toContain(79);   // ES9038PRO: not in this model
    expect(eventOptions(32).at(-1)).toEqual({ value: 128, label: "128: Ausgang Block 32" });
  });
});

import { sumsActive, sumsActiveAnywhere, sumsMapping, sumsShares } from "../src/lib/device";

describe("signal sums (All Over)", () => {
  it("on maps A to the left and B to the right outputs, off clears them", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V40-96ELN")), 100, 10));
    for (const c of Object.keys(s.mixer.values[1])) for (const g of [9, 10]) if (s.mixer.values[1][+c][g] !== undefined) s.mixer.values[1][+c][g] = 0;
    expect(sumsActive(s, 1)).toBe(false);
    const on = sumsMapping(s, 1, true);
    expect(on).toHaveLength(8);
    expect(on.slice(0, 2)).toEqual([[3, 9, 100], [4, 10, 100]]);     // output 1 <- A, output 2 <- B
    for (const [c, g, v] of on) s.mixer.values[1][c][g] = v;
    expect(sumsActive(s, 1)).toBe(true);
    expect(sumsActiveAnywhere(s)).toBe(true);
    expect(sumsMapping(s, 1, true)).toEqual([]);                      // already as wanted
    // shares set by the user are remembered at switch-off and come back at switch-on
    s.mixer.values[1][3][9] = 40; s.mixer.values[1][4][10] = 0; s.mixer.values[1][4][9] = 25;
    const kept = sumsShares(s, 1);
    expect(kept["3.9"]).toBe(40);
    for (const [c, g, v] of sumsMapping(s, 1, false)) s.mixer.values[1][c][g] = v;
    expect(sumsActive(s, 1)).toBe(false);
    const back = sumsMapping(s, 1, true, kept);
    for (const [c, g, v] of back) s.mixer.values[1][c][g] = v;
    expect(sumsShares(s, 1)).toEqual(kept);
    expect(back).toContainEqual([3, 9, 40]);
    expect(back).toContainEqual([4, 9, 25]);
    // nothing remembered above 0: the default mapping, here three shares differ from it
    expect(sumsMapping(s, 1, true, { "3.9": 0 })).toEqual([[3, 9, 100], [4, 9, 0], [4, 10, 100]]);
    const off = sumsMapping(s, 1, false);
    expect(off).toHaveLength(8);
    expect(off.every(([, , v]) => v === 0)).toBe(true);
  });
});

describe("MODC dialog fields", () => {
  it("TCXO correction: signed tenths of a hertz over sets 1/2, as the original GUI stores it", () => {
    const sets = [0, 0, 4, 0];
    wordSet(sets, 1, -125);                       // -12.5 Hz
    expect(sets).toEqual([0x83, 0xff, 4, 0]);
    expect(wordGet(sets, 1, true)).toBe(-125);
    expect(wordGet(sets, 1)).toBe(0xff83);
    wordSet(sets, 1, 1000);
    expect(wordGet(sets, 1, true)).toBe(1000);
    const clock = modcType(68)!.fields!;
    expect(clock[0]).toMatchObject({ kind: "word", signed: true, div: 10, unit: "Hz" });
    expect(clock[1].kind === "choice" && clock[1].options.length).toBe(9);
  });
  it("shutdown delays in steps of 250 ms; every OEM dialog has fields", () => {
    const f = modcType(193)!.fields!.filter((x) => x.kind === "byte");
    expect(f.map((x) => [x.i, x.mul])).toEqual([[1, 0.25], [3, 0.25], [4, 0.25], [2, 0.05]]);
    for (const t of [16, 17, 82, 86, 84, 108, 106, 109, 96, 97, 66, 193, 68, 51, 52, 50, 49]) expect(modcType(t)?.fields?.length, String(t)).toBeGreaterThan(0);
    // indices stay inside the four events/sets/flags
    for (const t of [16, 17, 82, 86, 84, 108, 106, 109, 96, 97, 66, 193, 68, 48, 49, 50, 51, 52])
      for (const x of modcType(t)!.fields!) expect(x.i >= 1 && x.i + (x.kind === "word" ? 1 : 0) <= 4, `${t} ${x.label}`).toBe(true);
  });
});


describe("input delays", () => {
  it("the analog inputs share one pool; models without input delay have none", async () => {
    const s = await readDevice(new ForgeClient(new Recorded(fixture("V40-96ELN")), 100, 10));
    const g = inputDelayGroup(s)!;
    expect(g.channels).toEqual([1, 2, 3, 4, 5, 6]);            // the firmware lists 8, 7/8 mirror output delays
    s.delay.in = [100, 0, 0, 0, 0, 0, 0, 0];
    expect(delayMax(s, g, 2, s.delay.in)).toBe(5840 - 100);
    expect(delayMax(s, g, 1, s.delay.in)).toBe(5840);
    const none = emptyState();
    expect(inputDelayGroup(none)).toBeNull();
  });
});

import { checkLengths, lostBands, poolCores, proposeGrow } from "../src/lib/device";

describe("biquad pools (forge-dsp-firmware#47)", () => {
  const dev = () => {
    const s = emptyState();
    applyAnswer(s, parseAnswer(" <.1 system.biquads=[[35,1,72,1,172],[36,1,72,1,172],[1,3,60,3,196],[2,3,60,3,196],[3,3,38,1,196],[4,3,38,3,196]]")!);
    const off = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
    for (const [ch, n] of [[1, 60], [2, 60], [3, 38], [4, 38], [35, 72], [36, 72]]) {
      s.biquads[ch] = {};
      for (let i = 1; i <= n; i++) s.biquads[ch][i] = { ...off };
    }
    s.biquads[1][1] = { type: 1, f: 1000, gain: -30, q: 707, b: 0, flags: 128 };
    s.biquads[2][50] = { type: 1, f: 2000, gain: -30, q: 707, b: 0, flags: 128 };
    return s;
  };
  it("reads system.biquads", () => {
    const k = poolCores(dev());
    expect(k.map((x) => [x.core, x.size, x.channels.map((c) => c.len)])).toEqual([[1, 172, [72, 72]], [3, 196, [60, 60, 38, 38]]]);
  });
  it("grows from the free biquads first, then from unused bands at the end", () => {
    const s = dev();
    expect(proposeGrow(s, 35, 10)).toEqual({ core: 1, lengths: [82, 72], got: 10 });          // 28 free in core 1
    const g = proposeGrow(s, 3, 100)!;
    expect(g.got).toBe(100);
    expect(g.lengths.reduce((a, b) => a + b, 0)).toBe(196);
    expect(g.lengths[1]).toBeGreaterThanOrEqual(50);                                           // band 50 of output 2 stays
    expect(lostBands(s, poolCores(s)[1], g.lengths)).toEqual([]);
    expect(proposeGrow(s, 3, 500)!.got).toBe(196 - 38 - 3 - 50 - 3);                          // all unused, minimum 3 each
  });
  it("checks lengths and reports bands that would be dropped", () => {
    const s = dev(), k = poolCores(s)[1];
    expect(checkLengths(k, [60, 60, 38, 38])).toBe("");
    expect(checkLengths(k, [2, 60, 38, 38])).toMatch(/mindestens 3/);
    expect(checkLengths(k, [60, 60, 38, 39])).toMatch(/1 Biquads mehr/);
    expect(lostBands(s, k, [60, 40, 58, 38])).toEqual([{ ch: 2, bands: [50] }]);
  });
});

import { planCopy } from "../src/lib/device";
describe("copy a channel (#5)", () => {
  const bq = (type: number, f = 1000, gain = 0) => ({ type, f, gain, q: 707, b: 0, flags: 0x80 });
  it("makes the target equal, writes only what differs, reports what does not fit", () => {
    const src = { 1: bq(1, 100, 30), 2: bq(0), 3: bq(4, 2000), 4: bq(1, 8000, -20) };
    const dst = { 1: bq(1, 100, 30), 2: bq(1, 500, 10), 3: bq(0) };
    const p = planCopy(src, dst);
    expect(p.writes.map(([n]) => n)).toEqual([2, 3]);          // 1 is already equal
    expect(p.writes[0][1].type).toBe(0);                       // place 2 cleared
    expect(p.writes[1][1]).toEqual(bq(4, 2000));
    expect(p.lost).toEqual([4]);                               // the target has only 3 places
  });
  it("empty places compare equal whatever their stored values", () => {
    expect(planCopy({ 1: { type: 0, f: 5, gain: 1, q: 1, b: 1, flags: 0 } }, { 1: { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 } }).writes).toEqual([]);
  });
});

import { sumResponse, coeffs as bqCoeffs } from "../src/lib/dsp/biquad";
describe("crossover sum (#5)", () => {
  const f = [100, 1000, 10000];
  it("two equal channels: +6 dB; one inverted: cancelled", () => {
    const flat = { list: [], gain: 1, invert: false, delay: 0 };
    expect(sumResponse([flat, flat], f, 96000).db.map((v) => Math.round(v * 10) / 10)).toEqual([6, 6, 6]);
    expect(Math.max(...sumResponse([flat, { ...flat, invert: true }], f, 96000).db)).toBeLessThan(-200);
  });
  it("a Linkwitz-Riley 4 pair sums flat", () => {
    const lr = (type: number) => bqCoeffs({ type, f: 2000, gain: 0, q: 707, b: 0, flags: 0x80 }, 96000);
    // LR4 = two Butterworth 12 dB sections: type 3 low pass, type 9 high pass (biquad.ts TYPES)
    const lp = { list: [lr(3), lr(3)], gain: 1, invert: false, delay: 0 };
    const hp = { list: [lr(9), lr(9)], gain: 1, invert: false, delay: 0 };
    for (const v of sumResponse([lp, hp], [200, 1000, 2000, 4000, 20000], 96000).db) expect(Math.abs(v)).toBeLessThan(0.1);
  });
  it("a delay of half a period at 1 kHz cancels two equal channels there", () => {
    const a = { list: [], gain: 1, invert: false, delay: 0 }, b = { ...a, delay: 48 };   // 0.5 ms at 96 kHz
    expect(sumResponse([a, b], [1000], 96000).db[0]).toBeLessThan(-60);
  });
});

import { masterDb, masterOf, masterValue } from "../src/lib/device";
describe("master volume (#3)", () => {
  it("uses the volume block's events, 255 = 0 dB, 0.5 dB per step", () => {
    const s = emptyState();
    expect(masterOf(s)).toBeNull();
    s.modc[4] = { enable: 1, type: 16, flags: [255, 0, 0, 0], events: [58, 59, 0, 0], sets: [0, 0, 0, 0] };
    s.modc[2] = { enable: 0, type: 16, flags: [0, 0, 0, 0], events: [1, 2, 0, 0], sets: [0, 0, 0, 0] };     // off: ignored
    expect(masterOf(s)).toEqual({ block: 4, odd: 58, even: 59 });
    s.modc[4].events = [58, 0, 0, 0];
    expect(masterOf(s)).toEqual({ block: 4, odd: 58, even: 58 });                                     // one event for all
    expect(masterDb(255)).toBe(0);
    expect(masterDb(231)).toBe(-12);
    expect(masterValue(-12)).toBe(231);
    expect(masterValue(-200)).toBe(0);
    const ap = (l: string) => applyAnswer(s, parseAnswer(l)!);
    expect(ap(" <.1 event.58.value=200")).toBe(true);
    expect(s.events[58]).toBe(200);
  });
});

import { autoPort, listPorts } from "../src/lib/transport/native";
import { releasesFromApi } from "../src/lib/boot/releases";

describe("desktop app: port choice", () => {
  const ttyS = Array.from({ length: 32 }, (_, i) => ({ name: `/dev/ttyS${i}`, vid: null, pid: null, product: null }));
  const forge = { name: "/dev/ttyUSB0", vid: 0x10c4, pid: 0xea60, product: "CP2102 USB to UART" };
  const other = { name: "/dev/ttyACM0", vid: 0x2e8a, pid: 0x000c, product: "Pico" };
  it("opens the only CP2102 without asking", () => {
    expect(autoPort([...ttyS, forge])).toBe(forge);
    expect(autoPort([...ttyS, forge, { ...forge, name: "/dev/ttyUSB1" }])).toBeNull();
    expect(autoPort(ttyS)).toBeNull();
  });
  it("shows USB ports only, the Forge first; all on request", () => {
    expect(listPorts([...ttyS, other, forge], false).map((p) => p.name)).toEqual(["/dev/ttyUSB0", "/dev/ttyACM0"]);
    const all = listPorts([...ttyS, other, forge], true);
    expect(all).toHaveLength(34);
    expect(all[2].name).toBe("/dev/ttyS0");
    expect(all[12].name).toBe("/dev/ttyS10");
  });
});

describe("desktop app: firmware releases from the API", () => {
  it("lists port and original releases with the API's SHA-256", () => {
    const rel = releasesFromApi([
      { tag_name: "v2.1.0", name: "2.1.0", published_at: "2026-11-12T10:00:00Z", draft: false, prerelease: false, html_url: "u",
        assets: [{ name: "b.hex", size: 2, digest: "sha256:ab" }, { name: "SHA256SUMS", size: 1 }, { name: "a.hex", size: 1, digest: null }] },
      { tag_name: "0.0.1116000", name: null, published_at: "2026-10-01T00:00:00Z", draft: false, prerelease: false, html_url: "o",
        assets: [{ name: "o.hex", size: 3, digest: "sha256:cd" }] },
      { tag_name: "v9.9.9", name: "x", published_at: "2026-12-01T00:00:00Z", draft: true, prerelease: false, html_url: "d", assets: [{ name: "d.hex", size: 1 }] },
      { tag_name: "bringup", name: "x", published_at: "2026-12-01T00:00:00Z", draft: false, prerelease: false, html_url: "d", assets: [{ name: "d.hex", size: 1 }] },
    ]);
    expect(rel.map((r) => r.tag)).toEqual(["v2.1.0", "0.0.1116000"]);
    expect(rel[0].assets).toEqual([{ file: "a.hex", size: 1, sha256: "" }, { file: "b.hex", size: 2, sha256: "ab" }]);
    expect(rel[1].original).toBe(true);
  });
});

import { choiceGet, choiceSet } from "../src/lib/device/modc";

describe("MODC fields: packed choices", () => {
  it("reads and writes only the field's bits", () => {
    const f = { shift: 5, width: 3 };
    expect(choiceGet(64, f)).toBe(2);                 // ES9038PRO default: fast, minimum phase
    expect(choiceSet(0x47, f, 7)).toBe(0xe7);         // other bits kept
    expect(choiceSet(0xff, { shift: 1, width: 2 }, 0)).toBe(0xf9);
    expect(choiceGet(0x83, { shift: 0, width: 2 })).toBe(3);
    expect(choiceSet(5, {}, 300)).toBe(300 & 0xff);   // whole byte as before
  });
  it("every type of the firmware has a dialog now", () => {
    for (const t of [3, 16, 17, 48, 49, 50, 51, 52, 53, 66, 68, 69, 79, 82, 84, 86, 96, 97, 106, 108, 109, 193])
      expect(modcType(t)?.fields?.length, `type ${t}`).toBeGreaterThan(0);
  });
});

describe("output limiter (forge-dsp-firmware#58)", () => {
  it("reads thresholds, attack and release; without the block it stays null", () => {
    const s = emptyState();
    for (const l of [" <.1 system.dsp.limiter=[0,-30,0,0,-240,0,0,-5]", " <.1 system.dsp.limiter.attack=1", " <.1 system.dsp.limiter.release=250"])
      applyAnswer(s, parseAnswer(l)!);
    expect(s.limiter).toEqual({ t: [0, -30, 0, 0, -240, 0, 0, -5], attack: 1, release: 250 });
    const o = emptyState();
    applyAnswer(o, parseAnswer(" !.1 system.dsp.limiter unknown command")!);
    expect(o.limiter).toBeNull();
  });
});

describe("only the biquads in use (forge-dsp-firmware#64)", () => {
  it("fills the empty places from the closing line", () => {
    const s = emptyState();
    for (const l of [" <.1 biquad.3.2=[1,1000,30,707,0,128]", " <.1 biquad.used=[3,4,35,2]"]) applyAnswer(s, parseAnswer(l)!);
    expect(Object.keys(s.biquads[3])).toEqual(["1", "2", "3", "4"]);
    expect(s.biquads[3][2]).toEqual({ type: 1, f: 1000, gain: 30, q: 707, b: 0, flags: 128 });
    expect(s.biquads[3][1].type).toBe(0);
    expect(Object.keys(s.biquads[35])).toEqual(["1", "2"]);
  });
});

describe("writes of a control block (#26)", () => {
  const blk = (sets: number[], events = [4, 0, 6, 128]) => ({ enable: 1, type: 193, flags: [0, 0, 0, 0], events, sets });
  it("the last block is fixed: only the changed parts, one by one", () => {
    expect(modcWrites(32, 32, blk([4, 5, 4, 4]), blk([0, 5, 4, 8]))).toEqual([["modc.32.sets.1", "0"], ["modc.32.sets.4", "8"]]);
    expect(modcWrites(32, 32, blk([4, 5, 4, 4]), blk([4, 5, 4, 4], [4, 0, 7, 128]))).toEqual([["modc.32.events.3", "7"]]);
    expect(modcWrites(32, 32, blk([4, 5, 4, 4]), blk([4, 5, 4, 4]))).toEqual([]);
  });
  it("other blocks whole", () => {
    expect(modcWrites(7, 32, blk([4, 5, 4, 4]), blk([0, 5, 4, 4]))).toEqual([["modc.7", "[1,193,00000000,4,0,6,128,00050404]"]]);
  });
});

describe("blocks about a chip only with the chip (#26)", () => {
  const dev = (model: string, other?: number) => {
    const s = emptyState();
    s.identity.model = model;
    if (other !== undefined) s.features.hw = [110, 96, 63, 63, other, other];
    return s;
  };
  it("S/PDIF receiver CT7302: all but the 96LN, when found", () => {
    expect(deviceHasChip(dev("96ELN", 2173), 69)).toBe(true);    // DEV Forge, PCB 4.0
    expect(deviceHasChip(dev("96ELN", 0x807), 69)).toBe(false);  // receiver not found
    expect(deviceHasChip(dev("96LN"), 69)).toBe(false);
    expect(deviceHasChip(dev("CORED8"), 69)).toBe(true);         // no report: the model decides
  });
  it("ES9038PRO: only the 96ELN-3", () => {
    expect(deviceHasChip(dev("96ELN", 2173), 79)).toBe(false);
    expect(deviceHasChip(dev("96ELN3", 0x87d), 79)).toBe(true);
    expect(deviceHasChip(dev("96ELN3", 0x879), 79)).toBe(false);
  });
});
