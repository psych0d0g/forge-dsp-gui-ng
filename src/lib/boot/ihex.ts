// Intel HEX reader (record types 00-05), port of c45b3/ihex.py.
import { t } from "../i18n/index.svelte";
export class HexError extends Error {}

/** contiguous image from address 0 to the highest used address, gaps filled with 0xFF */
export function parseHex(text: string): Uint8Array {
  const mem = new Map<number, number>();
  let base = 0, eof = false, hi = -1;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim(), at = t("firmware.lineN", { n: idx + 1 });
    if (!line) return;
    if (eof) throw new HexError(`${at}: ${t("firmware.dataAfterEndRecord")}`);
    if (line[0] !== ":" || !/^:([0-9a-fA-F]{2})+$/.test(line)) throw new HexError(`${at}: ${t("firmware.notIntelHEXRecord")}`);
    const rec = line.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    if (rec.length < 5 || rec.length !== rec[0] + 5) throw new HexError(`${at}: ${t("firmware.wrongLength")}`);
    if (rec.reduce((a, b) => a + b, 0) & 0xff) throw new HexError(`${at}: ${t("common.wrongChecksum")}`);
    const addr = (rec[1] << 8) | rec[2], type = rec[3], data = rec.slice(4, -1);
    if (type === 0x00) data.forEach((b, i) => {
      const a = base + addr + i;
      if (mem.has(a) && mem.get(a) !== b) throw new HexError(`${at}: ${t("firmware.dataOverlapsAt0x", { a: a.toString(16) })}`);
      mem.set(a, b);
      if (a > hi) hi = a;
    });
    else if (type === 0x01) eof = true;
    else if (type === 0x02) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 0x04) base = (((data[0] << 8) | data[1]) << 16) >>> 0;
    else if (type !== 0x03 && type !== 0x05) throw new HexError(`${at}: unbekannter Satztyp ${type}`);
  });
  if (!eof) throw new HexError(t("firmware.endRecordMissingFile"));
  const out = new Uint8Array(hi + 1).fill(0xff);
  for (const [a, b] of mem) out[a] = b;
  return out;
}
