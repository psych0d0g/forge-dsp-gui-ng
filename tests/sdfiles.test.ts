import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/lib/protocol";
import { encodeValue, type Value } from "../src/lib/protocol/request";
import { crc16, sdDelete, sdDownload, sdList, sdNameFor, sdUpload, validSdName, type SdLink } from "../src/lib/device";
import { DemoCard } from "../src/lib/device/demo";

/** link to the demo card; mangle() may change or drop an answer line */
function link(card: DemoCard, mangle: (line: string, reg: string) => string | null = (l) => l): SdLink {
  const ask = (kind: string, reg: string, value?: Value) => {
    const line = `${kind}.1 ${reg}` + (value !== undefined ? `=${encodeValue(value)}` : "");
    const out = mangle(card.line(kind, reg, line), reg);
    return out === null ? [] : [parseAnswer(out)!];
  };
  return {
    get: async (reg) => ask("get", reg),
    async set(reg, value) {
      const r = ask("set", reg, value);
      const bad = r.find((a) => a.kind === "error");
      return bad ? bad.message ?? "Fehler" : r.length ? "" : "keine Antwort";
    },
  };
}

describe("microSD file transfer (forge-dsp-firmware#59)", () => {
  it("CRC-16/XMODEM as the firmware", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });

  it("uploads, lists, downloads and deletes", async () => {
    const card = new DemoCard();
    const l = link(card);
    const data = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 0xff);
    const seen: number[] = [];
    await sdUpload(l, "LOG.BIN", data, (n) => seen.push(n));
    expect(seen.at(-1)).toBe(1000);
    expect(await sdList(l)).toContainEqual({ name: "LOG.BIN", size: 1000 });
    expect(await sdDownload(l, "LOG.BIN", 1000)).toEqual(data);
    await sdDelete(l, "LOG.BIN");
    expect((await sdList(l)).map((f) => f.name)).not.toContain("LOG.BIN");
  });

  it("repeats a lost or damaged block", async () => {
    const card = new DemoCard();
    const data = new Uint8Array(400).map((_, i) => i & 0xff);
    await sdUpload(link(card), "A.BIN", data);
    let reads = 0;
    const flaky = link(card, (line, reg) => {
      if (reg !== "system.sd.read") return line;
      reads++;
      if (reads === 2) return null;                                       // block 1 lost
      if (reads === 4) return line.replace(/"([0-9A-F])/, (_, c) => `"${c === "0" ? "1" : "0"}`); // block 2: one byte changed
      return line;
    });
    expect(await sdDownload(flaky, "A.BIN", 400)).toEqual(data);
    expect(reads).toBeGreaterThan(5);
  });

  it("gives up on a block that never arrives", async () => {
    const card = new DemoCard();
    await sdUpload(link(card), "A.BIN", new Uint8Array(300));
    const dead = link(card, (line, reg) => (reg === "system.sd.read" && line.includes("read=[1,") ? null : line));
    await expect(sdDownload(dead, "A.BIN", 300)).rejects.toThrow(/Block 1/);
  });

  it("8.3 names", () => {
    expect(validSdName("PRESET_1.CFG")).toBe(true);
    expect(validSdName("toolongname.cfg")).toBe(false);
    expect(validSdName("../x")).toBe(false);
    expect(sdNameFor("mein preset.cfg")).toBe("MEIN_PRE.CFG");
    expect(sdNameFor("log")).toBe("LOG");
  });
});
