import { crc16 } from "./sdfiles";
import type { Transport } from "../transport/types";
import { SimTarget } from "../boot/sim";
import { emptyState, type DeviceState } from "./model";

/** A Forge 96ELN with a plausible tuning, to look at the interface without a device. */
/** the demo device; n = 2: a second one behind the slave port (RS485 chain, #15), an ETON CORE D8 */
export function demoState(n = 1): DeviceState {
  const s = emptyState();
  Object.assign(s.identity, { keyInfo: "DEMO-96ELN-4.0-0000000000000000-CCBYNCSA-20261112-MDD", model: "96ELN", pcb: "4.0",
    firmware: "1.11.6000", port: "2.0.0", sampleRate: 96000, analogInPairs: 3, spdifPairs: 1, outPairs: 4, presets: 4,
    modcBlocks: 32, keyInfoList: ["96ELN-4.0", "CORED8-4.0", "CORED8-4.1"] });
  s.features = { fr: [10, 22000], hw: [110, 96, 63, 63, 2173, 2173] };
  const sc = { min: 0, max: 255, zero: 223, step: 0.5, minDb: -111.5 };
  s.scales = { out: sc, in: sc, spdif: { ...sc, zero: 255, minDb: -127.5 }, mixer: [0, 100, 1, 0, 8] };
  s.gain = { out: [211, 211, 215, 215, 223, 223, 199, 199], in: [223, 223, 223, 223, 223, 223], spdif: [255, 255] };
  s.mute = [0, 0, 0, 0, 0, 0, 1, 1];
  s.limiter = { t: [0, 0, -30, -30, -60, -60, 0, 0], attack: 1, release: 100 };
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
  s.vuOut = [200, 197, 196, 193, 180, 178, 150, 148];
  s.events = { 58: 231, 59: 231 };  // volume block 2: -12 dB
  if (n === 2) {
    Object.assign(s.identity, { keyInfo: DEMO_KEY2, model: "CORED8", pcb: "4.1" });
    s.gain.out = [223, 223, 219, 219, 207, 207, 223, 223];
    s.mute = [0, 0, 0, 0, 0, 0, 0, 0];
    ["Tür L", "Tür R", "Kick L", "Kick R", "Center", "Rear", "Sub 1", "Sub 2"].forEach((x, i) => (s.channelNames[i + 1] = x));
  }
  return s;
}
const DEMO_KEY2 = "DEMO-CORED8-4.1-0000000000000002-CCBYNCSA-20261112-MDD";

/** Accepts every write, knows no reads: the demo state is already complete. */
/** a few records as the DEV unit wrote them (forge-dsp-firmware#60, docs/log-format.md) */
function demoLog(): Uint8Array {
  const recs = [[57, 24833, 1, 6, 1, 1, 12], [58, 0, 1, 1, 1, 8, 0], [58, 8472, 5, 3, 2, 1, 256], [58, 10666, 5, 3, 2, 2, 256],
    [58, 10668, 5, 3, 2, 3, 256], [58, 24829, 4, 4, 1, 0, 0], [59, 0, 1, 1, 1, 1, 0], [59, 9210, 2, 2, 5, 4, 0],
    [59, 9211, 2, 1, 2, 0x2f, 0], [60, 0, 1, 1, 1, 32, 0], [60, 24901, 4, 4, 1, 1, 0]];
  const b = new Uint8Array(recs.length * 12), v = new DataView(b.buffer);
  recs.forEach(([boot, ms, lvl, mod, ev, p1, p2], i) => {
    v.setUint16(i * 12, boot, true); v.setUint32(i * 12 + 2, ms, true); b[i * 12 + 6] = lvl << 5 | mod; b[i * 12 + 7] = ev;
    v.setUint16(i * 12 + 8, p1, true); v.setUint16(i * 12 + 10, p2, true);
  });
  return b;
}

/** the microSD of the demo (forge-dsp-firmware#59): same commands and answers as the firmware */
export class DemoCard {
  files = new Map<string, Uint8Array>([["PRESET_1.CFG", new TextEncoder().encode('[96ELN]\nFILE_v10 = "gain.out.1=199"\n')],
    ["FORGE.LOG", demoLog()]]);
  private open: { name: string; mode: 1 | 2; block: number; data: number[] } | null = null;
  line(kind: string, reg: string, line: string): string {
    line = line.trimEnd();   // the transport hands in the line with CR LF
    const val = /=(.*?)(;[0-9A-Fa-f]{2})?$/.exec(line)?.[1] ?? "";
    const str = val.replace(/^"|"$/g, "");
    const ok = ` *.1 ${reg} ok`, bad = ` !.1 ${reg} unknown command`;
    const word = reg.split(".")[2] ?? "";
    if (kind === "get") {
      if (reg === "system.sd") return ` <.1 system.sd=[1,1,3,30424]`;
      if (reg === "system.sd.backup") return ` <.1 system.sd.backup=[${DEMO_BACKUP.join(",")}]`;  // forge-dsp-firmware#61
      if (reg === "system.sd.files") return ` <.1 system.sd.files=[${[...this.files].map(([n, d]) => `"${n}:${d.length}"`).join(",")}]`;
      if (word === "read" && this.open?.mode === 1) {
        const d = this.files.get(this.open.name)!;
        const b = d.subarray(this.open.block * 128, this.open.block * 128 + 128);
        const out = ` <.1 system.sd.read=[${this.open.block},"${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}",${b.length ? crc16(b) : 0}]`;
        if (b.length) this.open.block++;
        return out;
      }
      return bad;
    }
    const name = str.toUpperCase();
    switch (word) {
      case "open": if (!this.files.has(name)) return bad; this.open = { name, mode: 1, block: 0, data: [] }; return ok;
      case "create": this.open = { name, mode: 2, block: 0, data: [] }; return ok;
      case "seek": if (this.open?.mode !== 1) return bad; this.open.block = Number(val); return ok;
      case "write": {
        const [hex, c] = str.split(":");
        const b = new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
        if (this.open?.mode !== 2 || parseInt(c, 16) !== crc16(b)) return bad;
        this.open.data.push(...b);
        return ok;
      }
      case "close":
        if (this.open?.mode === 2) this.files.set(this.open.name, new Uint8Array(this.open.data));
        this.open = null;
        return ok;
      case "delete": return this.files.delete(name) ? ok : bad;
      case "backup": {  // set system.sd.backup.<part>=slot: a file of the size of the part
        const part = reg.split(".")[3] ?? "", slot = Number(val);
        if (!(slot >= 1 && slot <= 9)) return ` !.1 ${reg} command out of range`;
        const sizes: Record<string, [string, number]> = { flash: ["FLASH", DEMO_BACKUP[0]], eeprom: ["EEPROM", DEMO_BACKUP[1]],
          preset: ["PRESET", DEMO_BACKUP[2]], 1: ["DSP1", 65536], 2: ["DSP2", 65536], 3: ["DSP3", 65536] };
        if (!sizes[part]) return bad;
        this.files.set(`${sizes[part][0]}_${slot}.BIN`, new Uint8Array(sizes[part][1]));
        this.files.set(`INFO_${slot}.TXT`, new TextEncoder().encode("96ELN-4.0\n2.2.0-demo\n"));
        return ok;
      }
      case "restore": {  // forge-dsp-firmware#65: needs INFO_S.TXT; the real Forge restarts afterwards
        const part = reg.split(".")[3] ?? "", slot = Number(val);
        const file = { eeprom: "EEPROM", preset: "PRESET", 1: "DSP1", 2: "DSP2", 3: "DSP3" }[part];
        if (!file) return bad;
        if (!this.files.has(`INFO_${slot}.TXT`)) return ` !.1 ${reg} unknown para`;
        if (!this.files.has(`${file}_${slot}.BIN`)) return bad;
        return ok;
      }
    }
    return bad;
  }
}

/** flash, MCU EEPROM, preset EEPROM, DSP cores as get system.sd.backup reports them */
const DEMO_BACKUP = [262144, 4096, 65536, 3];

export class DemoTransport implements Transport {
  name = "Demo";
  sd = new DemoCard();
  errors = "[[129,1],[3,2]]";
  dbgOut = 4;
  events: Record<number, number> = { 58: 231, 59: 231 };
  dbgMode = 4;
  /** a simulated bootloader target, so the firmware page can be tried without a device */
  bytes = new SimTarget();
  private fn: (l: string) => void = () => {};
  async write(line: string) {
    await this.bytes.write(new TextEncoder().encode(line));
    if (/system\.boot/.test(line)) { this.bytes.started = false; return; }
    const m = /^(get|set)\.(\S+) ([^=;\s]+)/.exec(line);
    if (!m) return;
    // a chain of two: device 2 answers like device 1 (with its own identity), nobody behind it
    const target = Number(m[2]);
    if (target > 2) return;
    const emit = (l: string) => this.fn(target === 2
      ? l.replace(/^(\s*[<>*!#])\.1 /, "$1.2 ").replace(/"DEMO-96ELN-4\.0-[^"]*"/, `"${DEMO_KEY2}"`) : l);
    let out = m[1] === "set" ? ` *.1 ${m[3]} ok` : ` !.1 ${m[3]} unknown command`;
    if (m[1] === "set" && m[3] === "system.errors") this.errors = "[]";
    const ev = /^event\.(\d+)\.value$/.exec(m[3]);
    if (ev && m[1] === "set") this.events[Number(ev[1])] = Number(/=(\d+)/.exec(line)?.[1] ?? 0);
    if (ev && m[1] === "get") out = ` <.1 ${m[3]}=${this.events[Number(ev[1])] ?? 255}`;
    if (m[1] === "set" && m[3] === "system.debug.out") this.dbgOut = Number(/=(\d+)/.exec(line)?.[1] ?? 0);
    if (m[1] === "set" && m[3] === "system.debug.mode") this.dbgMode = Number(/=(\d+)/.exec(line)?.[1] ?? 0);
    if (m[1] === "get" && m[3] === "system.debug.out") out = ` <.1 system.debug.out=${this.dbgOut}`;
    if (m[1] === "get" && m[3] === "system.debug.mode") out = ` <.1 system.debug.mode=${this.dbgMode}`;
    if (m[3].startsWith("system.sd")) {
      setTimeout(() => emit(this.sd.line(m[1], m[3], line)), 15);
      return;
    }
    if (m[1] === "get" && m[3] === "system.vu") {  // music-like movement on the digital input
      const t = Date.now() / 1000;
      const l = Math.round(214 + 14 * Math.sin(t * 2.1) * Math.sin(t * 0.37) + 4 * Math.sin(t * 9));
      // open analog inputs rustle like on the DEV unit (-50 … -105 dBFS), the digital one plays
      const n = [117, 78, 110, 152, 40, 72].map((v) => v + Math.round(3 * Math.sin(t * 7 + v))).join(",");
      out = ` <.1 system.vu=[${n},${l},${l - 3 + Math.round(3 * Math.sin(t * 5))}]`;
    } else if (m[1] === "get" && m[3] === "system.vu.out") {  // follows the input, per output a fixed gain
      const t = Date.now() / 1000;
      const l = Math.round(214 + 14 * Math.sin(t * 2.1) * Math.sin(t * 0.37) + 4 * Math.sin(t * 9));
      out = ` <.1 system.vu.out=[${[-14, -17, -18, -21, -34, -36, -64, -66].map((g) => Math.max(0, l + g)).join(",")}]`;
    } else if (m[1] === "get" && m[3] === "system.temperature.celsius") out = " <.1 system.temperature.celsius=38.50";
    else if (m[1] === "get") {
      const fixed: Record<string, string> = {
        "system.ping": '"pong"', "system.key.info": '"DEMO-96ELN-4.0-0000000000000000-CCBYNCSA-20261112-MDD"',
        "system.feature.attributes.hw": "[110,96,63,63,2173,2173]", "system.errors": this.errors, "system.supply": "[3320,13800]",
        "i2c.1.scan": "[&H20,&H22,&H40,&H4E,&H68,&HA0,&HA8,&HE0]", "i2c.2.scan": "[&H68,&H6A,&H90,&HA0,&HA2]",
        "i2c.1.32.122": "&H04,&B00000100", "i2c.2.144.27": "&H01,&B00000001",
        "system.hardware.dsp": "[0,52648,900,0,0,0,41247,1750,0,0,0]",
      };
      if (fixed[m[3]]) out = ` <.1 ${m[3]}=${fixed[m[3]]}`;
    }
    setTimeout(() => emit(out), 15);
  }
  onLine(fn: (l: string) => void) { this.fn = fn; }
  async close() {}
}
