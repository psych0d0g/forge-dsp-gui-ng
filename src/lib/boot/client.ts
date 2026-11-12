// chip45boot3 host side, port of c45b3/client.py. Works on raw bytes of the serial port.
import { AUTOBAUD_CHAR, CMD, CrcError, encodeFrame, FrameDecoder, IDENTIFIER, MAX_DATA, OK_BIT } from "./protocol";

/** raw byte access to the port */
export interface ByteLink {
  write(data: Uint8Array): Promise<void>;
  /** bytes that arrived, waiting at most `timeoutMs` for the first one (empty = nothing came) */
  read(timeoutMs: number): Promise<Uint8Array>;
  /** drop what was received so far */
  flush(): void;
}

// ATxmega256A3U of the Forge
export const APP_SIZE = 0x40000;   // start of the boot section: the application ends here
export const EEPROM_SIZE = 0x1000;
export const PAGE_SIZE = 512;
const AUTOBAUD_REPEAT = 16, CRC_RETRIES = 3;

export class BootError extends Error {}
export class NoAnswer extends BootError {}
export class Refused extends BootError {}
export class TargetCrcError extends BootError {}

const now = () => Date.now();

export class Bootloader {
  constructor(private link: ByteLink, private timeoutMs = 3000, private log: (m: string) => void = () => {}) {}

  /** autobaud bursts until STX c45b3 ETX comes back, for at most `waitMs` */
  async connect(waitMs: number, burstMs = 300): Promise<boolean> {
    const end = now() + waitMs;
    let seen: number[] = [], n = 0;
    const found = () => seen.some((_, i) => IDENTIFIER.every((c, k) => seen[i + k] === c));
    while (now() < end) {
      n++;
      await this.link.write(new Uint8Array(AUTOBAUD_REPEAT).fill(AUTOBAUD_CHAR));
      const burstEnd = now() + burstMs;
      while (now() < burstEnd) {
        seen.push(...(await this.link.read(Math.max(1, burstEnd - now()))));
        if (found()) {
          this.log(`Bootloader antwortet nach ${n} Versuchen`);
          await new Promise((r) => setTimeout(r, 50));
          this.link.flush();
          return true;
        }
      }
      seen = seen.slice(-IDENTIFIER.length);
    }
    return false;
  }

  private async readFrame(timeoutMs: number): Promise<Uint8Array> {
    const dec = new FrameDecoder(), end = now() + timeoutMs;
    while (now() < end) {
      for (const c of await this.link.read(Math.max(1, end - now()))) {
        const p = dec.feed(c);
        if (p) return p;
      }
    }
    throw new NoAnswer("keine Antwort vom Bootloader");
  }

  /** one frame out, the answer payload back */
  async transact(payload: number[], timeoutMs = this.timeoutMs): Promise<Uint8Array> {
    const cmd = payload[0];
    this.link.flush();
    await this.link.write(encodeFrame(payload));
    const ans = await this.readFrame(timeoutMs);
    if (ans.length === 2 && ans[0] === 0x65 && ans[1] === 0x30) throw new TargetCrcError("Bootloader meldet Übertragungsfehler");  // "e0"
    if (!ans.length) throw new BootError("leere Antwort");
    if (ans[0] === (cmd | OK_BIT)) return ans;
    if (ans[0] === cmd) throw new Refused(`Befehl 0x${cmd.toString(16)} abgelehnt`);
    throw new BootError(`unerwartete Antwort auf 0x${cmd.toString(16)}`);
  }

  /** for commands that may be repeated */
  private async retry(payload: number[], timeoutMs?: number): Promise<Uint8Array> {
    let last: unknown;
    for (let i = 0; i < CRC_RETRIES; i++) {
      try {
        return await this.transact(payload, timeoutMs);
      } catch (e) {
        if (!(e instanceof CrcError || e instanceof TargetCrcError)) throw e;
        last = e;
      }
    }
    throw last;
  }

  async bootloaderVersion(): Promise<[number, number]> {
    const a = await this.retry([CMD.VERSION_BOOTLOADER]);
    return [a[1], a[2]];
  }

  /** version from "FW_VERSION:xx.yy" in the application, null when there is none */
  async firmwareVersion(): Promise<[number, number] | null> {
    try {
      const a = await this.retry([CMD.VERSION_FIRMWARE], 5000);  // the target scans the whole flash
      return [a[1], a[2]];
    } catch (e) {
      if (e instanceof Refused || e instanceof NoAnswer) return null;
      throw e;
    }
  }

  setAddress(a: number) {
    return this.retry([CMD.SET_ADDRESS, (a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff]);
  }

  async startApplication() {
    await this.transact([CMD.START_APPLICATION]);
  }

  private async readMemory(cmd: number, start: number, size: number, progress?: (done: number) => void): Promise<Uint8Array> {
    const out = new Uint8Array(size);
    let got = 0, failures = 0;
    await this.setAddress(start);
    while (got < size) {
      let a: Uint8Array;
      try {
        a = await this.transact([cmd, Math.min(MAX_DATA, size - got)]);
      } catch (e) {
        if (!(e instanceof CrcError || e instanceof TargetCrcError || e instanceof NoAnswer) || ++failures > CRC_RETRIES) throw e;
        await this.setAddress(start + got);  // reads advance the address: set it again
        continue;
      }
      failures = 0;
      const data = a.subarray(1);
      if (!data.length) break;  // end of the memory
      out.set(data.subarray(0, size - got), got);
      got += data.length;
      progress?.(Math.min(got, size));
    }
    return out.subarray(0, Math.min(got, size));
  }

  readFlash(start: number, size: number, progress?: (done: number) => void) { return this.readMemory(CMD.FLASH_READ, start, size, progress); }
  readEeprom(start: number, size: number, progress?: (done: number) => void) { return this.readMemory(CMD.EEPROM_READ, start, size, progress); }

  /**
   * Programs the application flash from address 0; the target verifies every page. The image is
   * padded to whole pages with 0xFF. Never sends the empty final frame of the Windows tool: the
   * target would erase the page behind the image, which is the bootloader for a full image.
   */
  async writeFlash(image: Uint8Array, progress?: (done: number) => void): Promise<number> {
    const len = Math.ceil(image.length / PAGE_SIZE) * PAGE_SIZE;
    if (!image.length) throw new BootError("leeres Image");
    if (len > APP_SIZE) throw new BootError("Das Image ist größer als der Anwendungsbereich");
    const data = new Uint8Array(len).fill(0xff);
    data.set(image);
    await this.setAddress(0);
    for (let off = 0; off < len; off += MAX_DATA) {
      // no retry: after a lost answer the state of the target is unknown
      await this.transact([CMD.FLASH_WRITE, ...data.subarray(off, off + MAX_DATA)]);
      progress?.(off + MAX_DATA);
    }
    return len;
  }
}

/** padded image as the target holds it after writeFlash, for the read-back comparison */
export function paddedImage(image: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(image.length / PAGE_SIZE) * PAGE_SIZE).fill(0xff);
  out.set(image);
  return out;
}

/** true when the ASCII text occurs in the image (identity strings of the firmware) */
export function imageContains(image: Uint8Array, text: string): boolean {
  const t = new TextEncoder().encode(text);
  outer: for (let i = 0; i + t.length <= image.length; i++) {
    for (let k = 0; k < t.length; k++) if (image[i + k] !== t[k]) continue outer;
    return true;
  }
  return false;
}
