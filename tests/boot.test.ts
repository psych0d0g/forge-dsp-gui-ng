import { describe, expect, it } from "vitest";
import { crc16, encodeFrame, FrameDecoder, CrcError } from "../src/lib/boot/protocol";
import { parseHex, HexError } from "../src/lib/boot/ihex";
import { Bootloader, imageContains, NoAnswer, paddedImage, BootError } from "../src/lib/boot/client";
import { SimTarget } from "../src/lib/boot/sim";

describe("framing", () => {
  it("CRC and frames as the Python tool (c45b3/protocol.py)", () => {
    // vectors computed with forge-dsp-firmware tools/c45b3-host
    expect(crc16([0x11])).toBe(0xe3e0);
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);   // CRC-16/CCITT-FALSE check value
    expect([...encodeFrame([0x11])]).toEqual([0x02, 0x11, 0xe3, 0xe0, 0x03]);
    expect([...encodeFrame([0x21, 0, 0, 2, 0])]).toEqual([0x02, 0x21, 0x00, 0x00, 0x1b, 0x82, 0x00, 0xd5, 0x8b, 0x03]);   // 0x02 in the data is stuffed
  });
  it("decoder: round trip with stuffing, bad CRC", () => {
    const payload = [0x22, 0x02, 0x03, 0x1b, 0xff, 0x00];
    const d = new FrameDecoder();
    let got: Uint8Array | null = null;
    for (const c of encodeFrame(payload)) got = d.feed(c) ?? got;
    expect([...got!]).toEqual(payload);
    const bad = [...encodeFrame([0x11])];
    bad[1] ^= 1;
    const d2 = new FrameDecoder();
    expect(() => bad.forEach((c) => d2.feed(c))).toThrow(CrcError);
  });
});

describe("Intel HEX", () => {
  it("reads data across segments, fills gaps, checks sums", () => {
    const img = parseHex(":020000040000FA\n:0400000001020304F2\n:02000800AABB91\n:00000001FF\n");
    expect([...img]).toEqual([1, 2, 3, 4, 0xff, 0xff, 0xff, 0xff, 0xaa, 0xbb]);
    expect(() => parseHex(":0400000001020304F3\n:00000001FF\n")).toThrow(HexError);
    expect(() => parseHex(":0400000001020304F2\n")).toThrow(/Ende-Satz/);
    expect(() => parseHex("hello\n")).toThrow(HexError);
  });
});

describe("bootloader client against the simulated target", () => {
  const image = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7 + 3) & 0xff);

  it("connects, reads versions, writes, verifies, starts", async () => {
    const t = new SimTarget();
    t.deaf = 2;
    const bl = new Bootloader(t, 200);
    expect(await bl.connect(2000, 20)).toBe(true);
    expect(await bl.bootloaderVersion()).toEqual([1, 0]);
    expect(await bl.firmwareVersion()).toEqual([2, 0]);
    const steps: number[] = [];
    const n = await bl.writeFlash(image, (d) => steps.push(d));
    expect(n).toBe(5120);                                   // padded to whole pages
    expect(steps.at(-1)).toBe(5120);
    expect([...(await bl.readFlash(0, n))]).toEqual([...paddedImage(image)]);
    expect(t.flash[5119]).toBe(0xff);
    expect(t.flash[5120]).toBe(0xff);                       // nothing behind the image was touched
    expect(t.boot.every((b) => b === 0xb0)).toBe(true);
    await bl.startApplication();
    expect(t.started).toBe(true);
  });

  it("reads the EEPROM to its end", async () => {
    const t = new SimTarget();
    t.eeprom.set([1, 2, 3], 0xffd);
    const bl = new Bootloader(t, 200);
    await bl.connect(500, 20);
    const ee = await bl.readEeprom(0, 0x1000);
    expect(ee.length).toBe(0x1000);
    expect([...ee.subarray(0xffd)]).toEqual([1, 2, 3]);
  });

  it("a full image ends exactly at the boot section and leaves it alone", async () => {
    const t = new SimTarget();
    const bl = new Bootloader(t, 200);
    await bl.connect(500, 20);
    await bl.writeFlash(new Uint8Array(0x40000).fill(0x5a));
    expect(t.flash.every((b) => b === 0x5a)).toBe(true);
    expect(t.boot.every((b) => b === 0xb0)).toBe(true);
    await expect(bl.writeFlash(new Uint8Array(0x40001))).rejects.toThrow(BootError);
  });

  it("stops at a lost answer instead of repeating a write", async () => {
    const t = new SimTarget();
    const bl = new Bootloader(t, 60);
    await bl.connect(500, 20);
    t.dropAnswer = 5;                                       // set address, then the 4th data frame
    await expect(bl.writeFlash(image)).rejects.toThrow(NoAnswer);
  });

  it("no bootloader: connect gives up", async () => {
    const t = new SimTarget();
    t.deaf = 1000;
    expect(await new Bootloader(t, 50).connect(120, 20)).toBe(false);
  });

  it("identity strings in an image", () => {
    const img = new TextEncoder().encode("xx96ELN-4.0\0CORED8-4.0\0");
    expect(imageContains(img, "CORED8-4.0")).toBe(true);
    expect(imageContains(img, "96LN-3.0")).toBe(false);
  });
});
