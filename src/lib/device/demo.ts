import type { Transport } from "../transport/types";
import { SimTarget } from "../boot/sim";
import { emptyState, type DeviceState } from "./model";

/** A Forge 96ELN with a plausible tuning, to look at the interface without a device. */
export function demoState(): DeviceState {
  const s = emptyState();
  Object.assign(s.identity, { keyInfo: "DEMO-96ELN-4.0-0000000000000000-CCBYNCSA-20261112-MDD", model: "96ELN", pcb: "4.0",
    firmware: "1.11.6000", port: "2.0.0", sampleRate: 96000, analogInPairs: 3, spdifPairs: 1, outPairs: 4, presets: 4,
    modcBlocks: 32, keyInfoList: ["96ELN-4.0", "CORED8-4.0", "CORED8-4.1"] });
  s.features = { fr: [10, 22000], hw: [110, 96, 63, 63, 2173, 2173] };
  const sc = { min: 0, max: 255, zero: 223, step: 0.5, minDb: -111.5 };
  s.scales = { out: sc, in: sc, spdif: { ...sc, zero: 255, minDb: -127.5 }, mixer: [0, 100, 1, 0, 8] };
  s.gain = { out: [211, 211, 215, 215, 223, 223, 199, 199], in: [223, 223, 223, 223, 223, 223], spdif: [255, 255] };
  s.mute = [0, 0, 0, 0, 0, 0, 1, 1];
  s.phase = [0, 0, 0, 1, 0, 0, 0, 0];
  s.delay = { out: [0, 12, 48, 55, 96, 96, 0, 0], in: [0, 0, 24, 24, 0, 0, 0, 0] };
  s.mixer = { position: 1, input: 3, inputMax: 5, values: {} };
  for (let p = 1; p <= 4; p++) {
    const g: Record<number, Record<number, number>> = {};
    for (let c = 1; c <= 10; c++) {
      g[c] = {};
      for (let i = 1; i <= 10; i++) if (i <= 8 || (c > 2 && i <= 10)) g[c][i] = 0;
    }
    g[1][10] = p === 1 ? 3 : p === 2 ? 2 : 1;
    for (let o = 1; o <= 8; o++) g[o + 2][p === 3 ? (o % 2 ? 2 : 1) : o % 2 ? 8 : 7] = 100;  // left/right of one source
    s.mixer.values[p] = g;
  }
  ["Hochton L", "Hochton R", "Mittelton L", "Mittelton R", "Tiefton L", "Tiefton R", "Sub L", "Sub R"]
    .forEach((n, i) => (s.channelNames[i + 1] = n));
  for (const ch of [1, 2, 3, 4, 5, 6, 7, 8, 35, 36]) {
    s.biquads[ch] = {};
    for (let n = 1; n <= (ch > 30 ? 72 : ch % 4 === 1 || ch % 4 === 2 ? 60 : 38); n++) s.biquads[ch][n] = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
  }
  const on = (type: number, f: number, gain = 0, q = 707, b = 0) => ({ type, f, gain, q, b, flags: 128 });
  // slots in the device are in no particular order; the page lines the filters up by frequency
  for (const ch of [1, 2]) { s.biquads[ch][1] = on(1, 6300, -35, 2000); s.biquads[ch][2] = on(9, 3200); s.biquads[ch][3] = on(15, 12000, 15); s.biquads[ch][4] = on(9, 3200); s.biquads[ch][5] = on(18, 4500, 20, 0, 1500); s.biquads[ch][6] = on(1, 9000, -20, 3000); }
  for (const ch of [3, 4]) { s.biquads[ch][1] = on(9, 320); s.biquads[ch][2] = on(3, 3200); s.biquads[ch][3] = on(3, 3200); s.biquads[ch][4] = on(1, 1250, -40, 3000); s.biquads[ch][5] = on(15, 9000, 20); }
  for (const ch of [5, 6]) { s.biquads[ch][1] = on(9, 70); s.biquads[ch][2] = on(3, 320); s.biquads[ch][3] = on(1, 125, -50, 4000); }
  for (const ch of [7, 8]) { s.biquads[ch][1] = on(13, 28, 0, 900); s.biquads[ch][2] = on(3, 70); s.biquads[ch][3] = on(3, 70); s.biquads[ch][4] = on(1, 45, 30, 2500); s.biquads[ch][5] = on(22, 70, 0, 707, 60); }
  s.identity.modcBlocks = 32;
  s.modcVersions = Array(64).fill(20);
  s.pools = [[35, 1, 72, 1, 172], [36, 1, 72, 1, 172], [5, 2, 60, 3, 196], [6, 2, 60, 3, 196], [7, 2, 38, 1, 196], [8, 2, 38, 3, 196],
    [1, 3, 60, 3, 196], [2, 3, 60, 3, 196], [3, 3, 38, 1, 196], [4, 3, 38, 3, 196]].map(([ch, core, len, min, size]) => ({ ch, core, len, min, size }));
  s.limits = { biquad: [10, 22000, -120, 60, 1, 10000, 0, 22000], types: Array.from({ length: 23 }, (_, i) => i),
    out: [5840, 3, 3, 3, 3, 2, 2, 2, 2], in: [5840, 1, 1, 1, 1, 1, 1], names: [16, 16] };
  s.inputNames = { 1: "", 2: "", 3: "", 4: "", 5: "", 6: "", 7: "PC", 8: "PC" };
  const blk = (enable: number, type: number, flags: number[], events: number[], sets: number[]) => ({ enable, type, flags, events, sets });
  s.modc = { 1: blk(1, 86, [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 127, 0]), 2: blk(1, 16, [255, 0, 0, 0], [58, 59, 0, 0], [255, 0, 0, 0]),
    3: blk(1, 108, [15, 215, 40, 15], [98, 0, 0, 0], [100, 0, 16, 39]), 4: blk(0, 106, [8, 0, 0, 0], [62, 0, 0, 0], [4, 0, 0, 0]),
    5: blk(1, 96, [1, 0, 0, 0], [0, 6, 0, 0], [3, 2, 0, 0]), 31: blk(1, 68, [1, 0, 0, 0], [0, 0, 0, 0], [0x83, 0xff, 4, 0]), 32: blk(1, 193, [0, 0, 0, 0], [4, 0, 6, 128], [4, 5, 4, 4]) };
  s.preset = { loaded: 1, select: 255 };
  s.clickless = 1;
  s.supply = [3320, 13800];
  s.temperature = 38.5;
  s.vu = [0, 0, 0, 0, 0, 0, 215, 213];
  return s;
}

/** Accepts every write, knows no reads: the demo state is already complete. */
export class DemoTransport implements Transport {
  name = "Demo";
  /** a simulated bootloader target, so the firmware page can be tried without a device */
  bytes = new SimTarget();
  private fn: (l: string) => void = () => {};
  async write(line: string) {
    await this.bytes.write(new TextEncoder().encode(line));
    if (/system\.boot/.test(line)) { this.bytes.started = false; return; }
    const m = /^(get|set)\.(\S+) ([^=;\s]+)/.exec(line);
    if (!m) return;
    let out = m[1] === "set" ? ` *.1 ${m[3]} ok` : ` !.1 ${m[3]} unknown command`;
    if (m[1] === "get" && m[3] === "system.vu") {  // music-like movement on the digital input
      const t = Date.now() / 1000;
      const l = Math.round(214 + 14 * Math.sin(t * 2.1) * Math.sin(t * 0.37) + 4 * Math.sin(t * 9));
      out = ` <.1 system.vu=[0,0,0,0,0,0,${l},${l - 3 + Math.round(3 * Math.sin(t * 5))}]`;
    } else if (m[1] === "get" && m[3] === "system.temperature.celsius") out = " <.1 system.temperature.celsius=38.50";
    else if (m[1] === "get") {
      const fixed: Record<string, string> = {
        "system.ping": '"pong"', "system.key.info": '"DEMO-96ELN-4.0-0000000000000000-CCBYNCSA-20261112-MDD"',
        "system.feature.attributes.hw": "[110,96,63,63,2173,2173]", "system.errors": "[[129,1],[3,2]]", "system.supply": "[3320,13800]",
        "i2c.1.scan": "[&H20,&H22,&H40,&H4E,&H68,&HA0,&HA8,&HE0]", "i2c.2.scan": "[&H68,&H6A,&H90,&HA0,&HA2]",
        "i2c.1.32.122": "&H04,&B00000100", "i2c.2.144.27": "&H01,&B00000001",
        "system.hardware.dsp": "[0,52648,900,0,0,0,41247,1750,0,0,0]",
      };
      if (fixed[m[3]]) out = ` <.1 ${m[3]}=${fixed[m[3]]}`;
    }
    setTimeout(() => this.fn(out), 15);
  }
  onLine(fn: (l: string) => void) { this.fn = fn; }
  async close() {}
}
