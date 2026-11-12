// Intel HEX reader (record types 00-05), port of c45b3/ihex.py.
export class HexError extends Error {}

/** contiguous image from address 0 to the highest used address, gaps filled with 0xFF */
export function parseHex(text: string): Uint8Array {
  const mem = new Map<number, number>();
  let base = 0, eof = false, hi = -1;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim(), at = `Zeile ${idx + 1}`;
    if (!line) return;
    if (eof) throw new HexError(`${at}: Daten nach dem Ende-Satz`);
    if (line[0] !== ":" || !/^:([0-9a-fA-F]{2})+$/.test(line)) throw new HexError(`${at}: kein Intel-HEX-Satz`);
    const rec = line.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    if (rec.length < 5 || rec.length !== rec[0] + 5) throw new HexError(`${at}: falsche Länge`);
    if (rec.reduce((a, b) => a + b, 0) & 0xff) throw new HexError(`${at}: Prüfsumme falsch`);
    const addr = (rec[1] << 8) | rec[2], type = rec[3], data = rec.slice(4, -1);
    if (type === 0x00) data.forEach((b, i) => {
      const a = base + addr + i;
      if (mem.has(a) && mem.get(a) !== b) throw new HexError(`${at}: Daten überlappen bei 0x${a.toString(16)}`);
      mem.set(a, b);
      if (a > hi) hi = a;
    });
    else if (type === 0x01) eof = true;
    else if (type === 0x02) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 0x04) base = (((data[0] << 8) | data[1]) << 16) >>> 0;
    else if (type !== 0x03 && type !== 0x05) throw new HexError(`${at}: unbekannter Satztyp ${type}`);
  });
  if (!eof) throw new HexError("Ende-Satz fehlt (Datei unvollständig?)");
  const out = new Uint8Array(hi + 1).fill(0xff);
  for (const [a, b] of mem) out[a] = b;
  return out;
}
