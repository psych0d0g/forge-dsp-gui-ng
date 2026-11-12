import type { Transport } from "../transport/types";
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
  s.delay = { out: [0, 12, 48, 55, 96, 96, 0, 0], in: [0, 0, 0, 0, 0, 0, 0, 0] };
  s.mixer = { position: 1, input: 3, inputMax: 8, values: { 1: {} } };
  ["Hochton L", "Hochton R", "Mittelton L", "Mittelton R", "Tiefton L", "Tiefton R", "Sub L", "Sub R"]
    .forEach((n, i) => (s.channelNames[i + 1] = n));
  for (let ch = 1; ch <= 8; ch++) {
    s.biquads[ch] = {};
    for (let n = 1; n <= 8; n++) s.biquads[ch][n] = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
  }
  s.biquads[1][1] = { type: 9, f: 3200, gain: 0, q: 707, b: 0, flags: 128 };
  s.biquads[5][1] = { type: 3, f: 320, gain: 0, q: 707, b: 0, flags: 128 };
  s.biquads[5][2] = { type: 1, f: 63, gain: 30, q: 1414, b: 0, flags: 128 };
  s.preset = { loaded: 1, select: 255 };
  s.clickless = 1;
  s.supply = [1, 13800];
  s.temperature = 38.5;
  s.vu = [0, 0, 0, 0, 0, 0, 215, 213];
  return s;
}

/** Accepts every write, knows no reads: the demo state is already complete. */
export class DemoTransport implements Transport {
  name = "Demo";
  private fn: (l: string) => void = () => {};
  async write(line: string) {
    const m = /^(get|set)\.(\S+) ([^=;\s]+)/.exec(line);
    if (!m) return;
    let out = m[1] === "set" ? ` *.1 ${m[3]} ok` : ` !.1 ${m[3]} unknown command`;
    if (m[1] === "get" && m[3] === "system.vu") {  // music-like movement on the digital input
      const t = Date.now() / 1000;
      const l = Math.round(214 + 14 * Math.sin(t * 2.1) * Math.sin(t * 0.37) + 4 * Math.sin(t * 9));
      out = ` <.1 system.vu=[0,0,0,0,0,0,${l},${l - 3 + Math.round(3 * Math.sin(t * 5))}]`;
    } else if (m[1] === "get" && m[3] === "system.temperature.celsius") out = " <.1 system.temperature.celsius=38.50";
    setTimeout(() => this.fn(out), 15);
  }
  onLine(fn: (l: string) => void) { this.fn = fn; }
  async close() {}
}
