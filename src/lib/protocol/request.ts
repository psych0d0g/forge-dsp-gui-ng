import { checksumHex } from "./checksum";

/** Receiver: device 1..6 in the chain, "a" all, "m" master, "s" slave, "t" this device. */
export type Target = 1 | 2 | 3 | 4 | 5 | 6 | "a" | "m" | "s" | "t";

export type Value = number | string | Value[];

/** Encode a value as the firmware expects it: strings quoted, arrays in [a,b,c]. */
export function encodeValue(v: Value): string {
  if (Array.isArray(v)) return `[${v.map(encodeValue).join(",")}]`;
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

export interface LineOptions {
  target?: Target;
  /** append ;XX (the firmware checks it when present) */
  checksum?: boolean;
}

function line(cmd: "get" | "set", reg: string, value: Value | undefined, o: LineOptions): string {
  if (!/^[a-z0-9.*]+$/i.test(reg)) throw new Error(`invalid register: ${reg}`);
  const body = value === undefined ? reg : `${reg}=${encodeValue(value)}`;
  if (/[\r\n;]/.test(body)) throw new Error("value must not contain CR, LF or ';'");
  const cs = o.checksum ? `;${checksumHex(body)}` : "";
  return `${cmd}.${o.target ?? 1} ${body}${cs}\r\n`;
}

export const getLine = (reg: string, o: LineOptions = {}) => line("get", reg, undefined, o);
export const setLine = (reg: string, value: Value, o: LineOptions = {}) => line("set", reg, value, o);
