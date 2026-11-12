import type { Value } from "./request";

/**
 * Answer lines of the firmware (cmd_answer_header):
 *   ` <.1 system.ping="pong"`          get
 *   ` >.1 ...=...`                     set (echo)
 *   ` *.1 gain.out.1 ok`               info
 *   ` !.1 system.startup.9 command out of range`  error
 *   ` #.1 preset.loaded=2`             event (sent without request)
 */
export type AnswerKind = "get" | "set" | "info" | "error" | "event";

export interface Answer {
  kind: AnswerKind;
  device: number;
  register: string;
  value?: Value;
  /** text after the register for info/error lines ("ok", "unknown command", ...) */
  message?: string;
  raw: string;
}

const KIND: Record<string, AnswerKind> = { "<": "get", ">": "set", "*": "info", "!": "error", "#": "event" };

export function parseAnswer(line: string): Answer | null {
  const raw = line.replace(/[\r\n]+$/, "");
  const m = /^\s*([<>*!#])\.(\d+) (\S*?)(?:=(.*)|\s+(.*))?$/.exec(raw);
  if (!m) return null;
  const kind = KIND[m[1]];
  const a: Answer = { kind, device: Number(m[2]), register: m[3], raw };
  if (m[4] !== undefined) a.value = parseValue(m[4]);
  if (m[5] !== undefined) a.message = m[5];
  return a;
}

/** Values: numbers, "strings", [lists] (nested, mixed). */
export function parseValue(text: string): Value {
  let i = 0;
  const s = text.trim();
  function one(): Value {
    if (s[i] === "[") {
      i++;
      const out: Value[] = [];
      if (s[i] === "]") { i++; return out; }
      for (;;) {
        out.push(one());
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return out; }
        throw new Error(`bad list at ${i}: ${s}`);
      }
    }
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) throw new Error(`unterminated string: ${s}`);
      const v = s.slice(i + 1, end);
      i = end + 1;
      return v;
    }
    let j = i;
    while (j < s.length && s[j] !== "," && s[j] !== "]") j++;
    const tok = s.slice(i, j).trim();
    i = j;
    // plain decimals only: hex fields such as "1E100000" (modc flags/sets) must stay text
    return /^-?\d+(\.\d+)?$/.test(tok) ? Number(tok) : tok;
  }
  const v = one();
  if (i !== s.length) throw new Error(`trailing data at ${i}: ${s}`);
  return v;
}
