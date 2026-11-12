// chip45boot3 framing: STX/ETX, ESC stuffing, CRC16. Port of forge-dsp-firmware
// tools/c45b3-host/c45b3/protocol.py (from chip45boot3, MIT, Erik Lins).
export const STX = 0x02, ETX = 0x03, ESC = 0x1b;
export const IDENTIFIER = [STX, 0x63, 0x34, 0x35, 0x62, 0x33, ETX];  // STX "c45b3" ETX, sent without CRC
export const AUTOBAUD_CHAR = 0x55;  // "U"

export const CMD = {
  VERSION_BOOTLOADER: 0x11, VERSION_FIRMWARE: 0x12, START_APPLICATION: 0x18, SET_ADDRESS: 0x21,
  FLASH_WRITE: 0x22, FLASH_READ: 0x23, EEPROM_WRITE: 0x24, EEPROM_READ: 0x25,
} as const;
export const OK_BIT = 0x80;
export const MAX_DATA = 64;  // bytes per read/write frame (target limit)

/** CRC of crc.c: poly 0x1021, start 0x84CF, 16 zero bits appended (= CRC-16/CCITT-FALSE) */
export function crc16(data: ArrayLike<number>): number {
  let crc = 0x84cf;
  const bit = (b: number) => {
    const top = crc & 0x8000;
    crc = ((crc << 1) & 0xffff) | b;
    if (top) crc ^= 0x1021;
  };
  for (let k = 0; k < data.length; k++) for (let i = 7; i >= 0; i--) bit((data[k] >> i) & 1);
  for (let i = 0; i < 16; i++) bit(0);
  return crc;
}

/** payload + CRC (MSB first), stuffed, in STX … ETX */
export function encodeFrame(payload: ArrayLike<number>): Uint8Array {
  const crc = crc16(payload);
  const out = [STX];
  for (const c of [...Array.from(payload), crc >> 8, crc & 0xff]) {
    if (c === STX || c === ETX || c === ESC) out.push(ESC, (c + 0x80) & 0xff);
    else out.push(c);
  }
  out.push(ETX);
  return Uint8Array.from(out);
}

export class CrcError extends Error {}

/** Stream decoder: STX resets, ESC offsets the next byte by 0x80, ETX ends the frame. */
export class FrameDecoder {
  private buf: number[] = [];
  private esc = 0;
  /** one byte in; the payload (CRC stripped) when a frame completes, else null */
  feed(c: number): Uint8Array | null {
    if (c === STX) { this.buf = []; this.esc = 0; return null; }
    if (c === ESC) { this.esc = 0x80; return null; }
    if (c === ETX) {
      const raw = this.buf;
      this.buf = [];
      this.esc = 0;
      if (raw.length < 2) throw new CrcError("frame too short");
      const payload = raw.slice(0, -2);
      if (crc16(payload) !== ((raw[raw.length - 2] << 8) | raw[raw.length - 1])) throw new CrcError("crc mismatch");
      return Uint8Array.from(payload);
    }
    this.buf.push((c - this.esc) & 0xff);
    this.esc = 0;
    return null;
  }
}
