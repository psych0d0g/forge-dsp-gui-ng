import type { Answer } from "../protocol/answer";
import type { Value } from "../protocol/request";

/**
 * Files on the microSD in the Forge over the command line (port firmware, forge-dsp-firmware#59):
 * reading in 128-byte blocks with CRC-16/XMODEM, writing in blocks with the CRC in the value.
 * The firmware keeps one file open; these functions open, transfer and close it again.
 */
export interface SdLink {
  get(reg: string): Promise<Answer[]>;
  /** "" = ok, otherwise the error text */
  set(reg: string, value: Value): Promise<string>;
}

export interface SdFile { name: string; size: number }
export interface SdState { present: boolean; mounted: boolean; fat: number; mb: number }

/** bytes per write: the line stays below the 127 characters of the command buffer */
export const SD_WRITE_BLOCK = 40;
const RETRIES = 3;

export function crc16(b: Uint8Array): number {
  let c = 0;
  for (const x of b) {
    c ^= x << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
function fromHex(s: string): Uint8Array {
  const b = new Uint8Array(s.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return b;
}

/** 8.3 name in the root directory, as the firmware accepts it */
export function validSdName(n: string): boolean {
  return /^[^\s"*+,/:;<=>?[\\\]|.]{1,8}(\.[^\s"*+,/:;<=>?[\\\]|.]{1,3})?$/.test(n);
}

/** a browser file name -> an 8.3 suggestion in upper case */
export function sdNameFor(n: string): string {
  const m = /^(.*?)(?:\.([^.]*))?$/.exec(n.trim()) ?? [n, n, ""];
  const clean = (s: string, len: number) => s.toUpperCase().replace(/[^A-Z0-9_\-~!#$%&'()@^`{}]/g, "_").slice(0, len);
  const base = clean(m[1] || "DATEI", 8) || "DATEI";
  const ext = clean(m[2] ?? "", 3);
  return ext ? `${base}.${ext}` : base;
}

const valueOf = (r: Answer[]) => r.find((a) => a.kind === "get")?.value;

export async function sdState(l: SdLink): Promise<SdState | null> {
  const v = valueOf(await l.get("system.sd"));
  if (!Array.isArray(v)) return null;
  const [p, m, t, mb] = v.map(Number);
  return { present: !!p, mounted: !!m, fat: t, mb };
}

export async function sdList(l: SdLink): Promise<SdFile[]> {
  const v = valueOf(await l.get("system.sd.files"));
  if (!Array.isArray(v)) return [];
  return v.map(String).map((e) => {
    const i = e.lastIndexOf(":");
    return { name: e.slice(0, i), size: Number(e.slice(i + 1)) };
  });
}

/** one block [block,"hex",crc] -> bytes, null if the answer is missing or damaged */
function parseBlock(v: Value | undefined, want: number): Uint8Array | null {
  if (!Array.isArray(v) || v.length !== 3 || Number(v[0]) !== want) return null;
  const hex = String(v[1]);
  if (!/^([0-9A-Fa-f]{2})*$/.test(hex)) return null;
  const b = fromHex(hex);
  return (b.length ? crc16(b) : 0) === Number(v[2]) ? b : null;
}

export async function sdDownload(l: SdLink, name: string, size: number, progress?: (done: number) => void): Promise<Uint8Array> {
  let err = await l.set("system.sd.open", name);
  if (err) throw new Error(`${name}: ${err}`);
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (let block = 0; ; block++) {
      let b: Uint8Array | null = null;
      for (let t = 0; t < RETRIES && !b; t++) {
        if (t) await l.set("system.sd.seek", block);  // the answer got lost or damaged: once more
        b = parseBlock(valueOf(await l.get("system.sd.read")), block);
      }
      if (!b) throw new Error(`${name}: Block ${block} nicht lesbar`);
      if (!b.length) break;
      parts.push(b);
      total += b.length;
      progress?.(Math.min(total, size || total));
    }
  } finally {
    err = await l.set("system.sd.close", 1);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function sdUpload(l: SdLink, name: string, data: Uint8Array, progress?: (done: number) => void): Promise<void> {
  if (!validSdName(name)) throw new Error(`${name}: kein 8.3-Dateiname`);
  let err = await l.set("system.sd.create", name);
  if (err) throw new Error(`${name}: ${err}`);
  try {
    for (let i = 0; i < data.length; i += SD_WRITE_BLOCK) {
      const b = data.subarray(i, i + SD_WRITE_BLOCK);
      const v = `${toHex(b)}:${crc16(b).toString(16).padStart(4, "0").toUpperCase()}`;
      // a refused block was not written: sending it again is safe
      for (let t = 0; t < RETRIES && (err = await l.set("system.sd.write", v)); t++);
      if (err) throw new Error(`${name}: Schreiben bei Byte ${i}: ${err}`);
      progress?.(Math.min(data.length, i + b.length));
    }
  } finally {
    await l.set("system.sd.close", 1);
  }
  const f = (await sdList(l)).find((x) => x.name.toUpperCase() === name.toUpperCase());
  if (!f || f.size !== data.length) throw new Error(`${name}: auf der Karte ${f?.size ?? 0} statt ${data.length} Byte`);
}

export async function sdDelete(l: SdLink, name: string): Promise<void> {
  const err = await l.set("system.sd.delete", name);
  if (err) throw new Error(`${name}: ${err}`);
}
