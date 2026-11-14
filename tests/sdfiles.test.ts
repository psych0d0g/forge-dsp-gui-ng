import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/lib/protocol";
import { encodeValue, type Value } from "../src/lib/protocol/request";
import { backupInfo, backupInfoText, cardBackups, crc16, freeSlot, sdBackup, sdRestore, sdDelete, sdDownload, sdList, sdNameFor, sdUpload, usedSlots, validSdName, type SdLink } from "../src/lib/device";
import { DemoCard } from "../src/lib/device/demo";

const calls: string[] = [];
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
      calls.push(`${reg}=${value}`);
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

describe("backup on the card before an update (forge-dsp-firmware#61)", () => {
  it("writes every part into the first free slot and checks the sizes", async () => {
    const card = new DemoCard();
    const l = link(card);
    const info = (await backupInfo(l))!;
    expect(info).toEqual({ flash: 262144, eeprom: 4096, preset: 65536, cores: 3 });
    card.files.set("FLASH_1.BIN", new Uint8Array(1));                 // slot 1 taken
    calls.length = 0;
    const seen: number[] = [];
    const r = await sdBackup(l, info, (i) => seen.push(i));
    expect(r.slot).toBe(2);
    expect(calls).toEqual(["flash", "eeprom", "preset", "1", "2", "3"].map((p) => `system.sd.backup.${p}=2`));
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(usedSlots(await sdList(l))).toEqual([1, 2]);
  });

  it("no support (original or older firmware) and a full card", async () => {
    const old = link(new DemoCard(), (line, reg) => (reg === "system.sd.backup" ? " !.1 system.sd.backup unknown command" : line));
    expect(await backupInfo(old)).toBeNull();
    const files = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ name: `EEPROM_${n}.BIN`, size: 4096 }));
    expect(freeSlot(files)).toBeNull();
    const card = new DemoCard();
    files.forEach((f) => card.files.set(f.name, new Uint8Array(1)));
    await expect(sdBackup(link(card), { flash: 1, eeprom: 1, preset: 0, cores: 0 })).rejects.toThrow(/9 Sicherungen/);
  });

  it("a failing part stops the backup", async () => {
    const l = link(new DemoCard(), (line, reg) => (reg === "system.sd.backup.preset" ? ` !.1 ${reg} unknown command` : line));
    await expect(sdBackup(l, { flash: 262144, eeprom: 4096, preset: 65536, cores: 3 })).rejects.toThrow(/Presets/);
  });
});

describe("backups back from the card (forge-dsp-firmware#65)", () => {
  it("lists the slots with the parts that can go back, reads INFO and restores", async () => {
    const card = new DemoCard();
    const l = link(card);
    await sdBackup(l, { flash: 262144, eeprom: 4096, preset: 65536, cores: 2 });
    const files = await sdList(l);
    const [b] = cardBackups(files);
    expect(b.slot).toBe(1);
    expect(b.flash).toBe(true);
    expect(b.parts.map((p) => p.part)).toEqual(["1", "2", "eeprom", "preset"]);
    expect(await backupInfoText(l, 1, files)).toBe("96ELN-4.0, 2.2.0-demo");
    calls.length = 0;
    await sdRestore(l, "preset", 1);
    expect(calls).toEqual(["system.sd.restore.preset=1"]);
    card.files.delete("INFO_1.TXT");
    await expect(sdRestore(l, "eeprom", 1)).rejects.toThrow();     // without INFO the firmware refuses
  });
});
