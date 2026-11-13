import type { Transport } from "../transport/types";
import { parseAnswer, type Answer } from "./answer";
import { getLine, setLine, setLineRaw, type LineOptions, type Value } from "./request";

/**
 * One request at a time, as the firmware handles one line after another. A request is done on
 * the first answer for its register (or an error); wildcard requests (`.*`) collect lines until
 * the device is quiet for `quietMs`. Events and unrelated lines go to the listeners.
 */
export class ForgeClient {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: ((a: Answer) => void) | null = null;
  private listeners = new Set<(a: Answer) => void>();
  private rawListeners = new Set<(line: string, dir: "rx" | "tx") => void>();

  constructor(private t: Transport, private timeoutMs = 1500, private quietMs = 200) {
    t.onLine((l) => this.onLine(l));
  }

  onAnswer(fn: (a: Answer) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onRaw(fn: (line: string, dir: "rx" | "tx") => void) { this.rawListeners.add(fn); return () => this.rawListeners.delete(fn); }

  get(reg: string, o?: LineOptions) { return this.request(getLine(reg, o), reg, o?.timeoutMs); }
  set(reg: string, v: Value, o?: LineOptions) { return this.request(setLine(reg, v, o), reg, o?.timeoutMs); }
  setRaw(reg: string, valueText: string, o?: LineOptions) { return this.request(setLineRaw(reg, valueText, o), reg, o?.timeoutMs); }
  /** raw line from a console; resolves with the answers seen until quiet */
  send(line: string) { return this.request(line.endsWith("\n") ? line : line + "\r\n", "*"); }

  private onLine(line: string) {
    for (const f of this.rawListeners) f(line, "rx");
    const a = parseAnswer(line);
    if (!a) return;
    if (this.pending && a.kind !== "event") this.pending(a);
    else for (const f of this.listeners) f(a);
  }

  private request(line: string, reg: string, timeoutMs = this.timeoutMs): Promise<Answer[]> {
    const run = () =>
      new Promise<Answer[]>((resolve, reject) => {
        const got: Answer[] = [];
        const wild = reg.includes("*");
        let timer = setTimeout(() => finish(new Error(`timeout: ${line.trim()}`)), timeoutMs);
        const finish = (err?: Error) => {
          clearTimeout(timer);
          this.pending = null;
          if (err && got.length === 0) reject(err);
          else resolve(got);
        };
        this.pending = (a) => {
          got.push(a);
          if (a.kind === "error") return finish();
          if (!wild && a.register === reg) return finish();
          clearTimeout(timer);
          timer = setTimeout(() => finish(), this.quietMs);
        };
        for (const f of this.rawListeners) f(line, "tx");
        this.t.write(line).catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
