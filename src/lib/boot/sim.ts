// A chip45boot3 target for the tests: flash and EEPROM in memory, the commands of the Forge's
// bootloader 1.0 (after forge-dsp-firmware tools/c45b3-host/c45b3/sim.py).
import type { ByteLink } from "./client";
import { AUTOBAUD_CHAR, CMD, encodeFrame, FrameDecoder, IDENTIFIER, OK_BIT } from "./protocol";

export class SimTarget implements ByteLink {
  flash = new Uint8Array(0x40000).fill(0xff);
  boot = new Uint8Array(0x2000).fill(0xb0);  // must never change
  eeprom = new Uint8Array(0x1000).fill(0xff);
  started = false;
  /** drop the answer of the n-th command frame (1-based), to test a lost answer */
  dropAnswer = 0;
  /** autobaud bursts to ignore first (the application is still shutting down) */
  deaf = 0;
  private out: number[] = [];
  private dec = new FrameDecoder();
  private command = false;
  private addr = 0;
  private page: number[] = [];
  private frames = 0;

  async write(data: Uint8Array) {
    for (const c of data) {
      if (!this.command) {
        if (c === AUTOBAUD_CHAR) continue;
        continue;
      }
      let p: Uint8Array | null = null;
      try { p = this.dec.feed(c); } catch { this.out.push(...encodeFrame([0x65, 0x30])); }
      if (p) this.handle(p);
    }
    if (!this.command && data.every((c) => c === AUTOBAUD_CHAR) && !this.started) {
      if (this.deaf > 0) this.deaf--;
      else { this.command = true; this.out.push(...IDENTIFIER); }
    }
  }
  async read(timeoutMs: number) {
    if (!this.out.length) await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 2)));
    const d = Uint8Array.from(this.out);
    this.out = [];
    return d;
  }
  flush() { this.out = []; }

  private answer(payload: number[]) {
    if (++this.frames === this.dropAnswer) return;
    this.out.push(...encodeFrame(payload));
  }
  private handle(p: Uint8Array) {
    const cmd = p[0], ok = cmd | OK_BIT;
    if (cmd === CMD.VERSION_BOOTLOADER) this.answer([ok, 1, 0]);
    else if (cmd === CMD.VERSION_FIRMWARE) this.answer([ok, 2, 0]);
    else if (cmd === CMD.SET_ADDRESS) { this.addr = ((p[1] << 24) | (p[2] << 16) | (p[3] << 8) | p[4]) >>> 0; this.page = []; this.answer([ok]); }
    else if (cmd === CMD.FLASH_WRITE) {
      this.page.push(...p.subarray(1));
      if (this.page.length >= 512) {
        // the real target erases and writes the page it is given, wherever that is
        const mem = this.addr >= this.flash.length ? this.boot : this.flash;
        mem.set(this.page.slice(0, 512), this.addr >= this.flash.length ? this.addr - this.flash.length : this.addr);
        this.addr += 512;
        this.page = [];
      }
      this.answer([ok]);
    } else if (cmd === CMD.EEPROM_WRITE) {
      const data = p.subarray(1, 1 + Math.max(0, this.eeprom.length - this.addr));
      this.eeprom.set(data, this.addr);
      this.addr += data.length;
      this.answer([ok]);
    } else if (cmd === CMD.FLASH_READ || cmd === CMD.EEPROM_READ) {
      const mem = cmd === CMD.FLASH_READ ? this.flash : this.eeprom;
      const data = mem.subarray(this.addr, Math.min(mem.length, this.addr + p[1]));
      this.addr += data.length;
      this.answer([ok, ...data]);
    } else if (cmd === CMD.START_APPLICATION) { this.answer([ok]); this.started = true; this.command = false; }
    else this.answer([cmd]);  // refused
  }
}
