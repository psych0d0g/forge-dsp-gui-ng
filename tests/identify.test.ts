import { describe, expect, it } from "vitest";
import { describeFlash, identifyFlash } from "../src/lib/boot/identify";

// pieces of the real release images (checked against all files of 0.0.1116000 and v2.1.0)
const img = (...parts: string[]) => {
  const b = new Uint8Array(0x40000).fill(0xff);
  let o = 0x200;
  for (const p of parts) { for (let i = 0; i < p.length; i++) b[o + i] = p.charCodeAt(i); o += p.length + 64; }
  return b;
};
const original = (model: string, pcb: string, check: string) => img("@@1.11.6000\0\0\0 * check ", check,
  `["\0\x00${model}\0",\0\x0096000\x003\x001\x004\0,32]\0\0BNS\0${pcb}\0-CCBYNCSA-\0\x0020241206`);
const port = (...ids: string[]) => img("1.11.6000\0 system.firmware.port=\x002.1.0\0\"pong\"\0", ...ids.map((i) => `\0${i}\0`),
  "BNS-\0-CCBYNCSA-20261113-MDD\0");

describe("what runs on the Forge, from its flash (#17)", () => {
  it("original firmware: model, PCB, clock generator", () => {
    expect(identifyFlash(original("96ELN", "4.0", " * check si5338 (E0/E2)"))).toEqual(
      { kind: "original", version: "1.11.6000", model: "96ELN", pcb: "4.0", hasClock: true });
    expect(identifyFlash(original("96ELN", "4.0", " * check es9018 (da)")).hasClock).toBe(false);   // PCB 3.0 says 4.0 too
    expect(identifyFlash(original("CORED8", "4.1", "")).model).toBe("CORED8");
    expect(identifyFlash(original("96LN", "3.0", ""))).toMatchObject({ pcb: "3.0", hasClock: false });
  });

  it("port firmware: the build from its identities", () => {
    expect(identifyFlash(port("96ELN", "4.0", "CORED8", "4.1"))).toEqual(
      { kind: "port", version: "2.1.0", model: "96ELN", pcb: "4.0", hasClock: true });
    expect(identifyFlash(port("96ELN", "4.0")).hasClock).toBe(false);
    expect(identifyFlash(port("96ELN3", "4.0", "4.1")).model).toBe("96ELN3");
    expect(identifyFlash(port("96LN", "3.0")).model).toBe("96LN");
  });

  it("a port image over an older original: the tail of the original behind it does not count", () => {
    const flash = port("96ELN", "4.0", "CORED8", "4.1");                       // the port image starts the flash
    flash.set(original("96ELN", "4.0", " * check si5338").subarray(0x200, 0x1000), 0x8000);   // the old tail further up
    expect(identifyFlash(flash.subarray(0x8000 - 0x200)).kind).toBe("original");              // (the tail alone: original)
    expect(identifyFlash(flash)).toMatchObject({ kind: "port", version: "2.1.0", model: "96ELN", hasClock: true });
  });

  it("empty and unknown flash", () => {
    expect(identifyFlash(new Uint8Array(1024).fill(0xff)).kind).toBe("empty");
    expect(identifyFlash(img("something else")).kind).toBe("unknown");
    expect(describeFlash(identifyFlash(original("96ELN", "4.0", " * check si5338")))).toBe("Original 1.11.6000, 96ELN, PCB 4.x");
  });
});
