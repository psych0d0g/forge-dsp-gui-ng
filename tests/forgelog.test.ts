import { describe, expect, it } from "vitest";
import { decodeLog, logText } from "../src/lib/device";

const rec = (boot: number, ms: number, level: number, mod: number, ev: number, p1: number, p2: number) => {
  const b = new Uint8Array(12), v = new DataView(b.buffer);
  v.setUint16(0, boot, true); v.setUint32(2, ms, true); b[6] = level << 5 | mod; b[7] = ev;
  v.setUint16(8, p1, true); v.setUint16(10, p2, true);
  return b;
};

describe("FORGE.LOG (forge-dsp-firmware#60)", () => {
  it("decodes the records as the DEV unit wrote them", () => {
    // first records from the DEV V40-96ELN, 13.11.2026
    const b = new Uint8Array([...rec(57, 24833, 1, 6, 1, 1, 12), ...rec(58, 0, 1, 1, 1, 8, 0), ...rec(58, 8472, 5, 3, 2, 1, 256),
      ...rec(58, 24829, 4, 4, 1, 0, 0), 1, 2, 3]);   // a cut record at the end is ignored
    const r = decodeLog(b);
    expect(r).toHaveLength(4);
    expect(r[1]).toEqual({ boot: 58, ms: 0, level: 1, module: 1, event: 1, p1: 8, p2: 0 });
    expect(r.map(logText)).toEqual(["Log-Datei begonnen (Format 1, 12 Byte je Satz)", "Start (Watchdog)",
      "Kern 1: läuft", "Preset 1 geladen"]);
  });
  it("names error counters and DSP problems", () => {
    expect(logText(decodeLog(rec(1, 5, 2, 2, 34, 3, 0))[0])).toBe("DSP meldet Fehlerzustand (Typ 34), jetzt 3×");
    expect(logText(decodeLog(rec(1, 5, 2, 3, 1, 3, 0x0202))[0])).toBe("DSP-EEPROM von Kern 3 neu geschrieben (2 Versuche), Prüfsumme falsch");
    expect(logText(decodeLog(rec(1, 5, 2, 1, 2, 0x3f, 1))[0])).toMatch(/DSP-Neustart.*Fehlerzustand/);
  });
});
