import { t, tk, tx } from "../i18n/index.svelte";
import { errorName } from "./diagnose";

/**
 * Binary log of the port firmware on the microSD (forge-dsp-firmware#60, docs/log-format.md):
 * FORGE.LOG / FORGE.OLD, 12-byte records little endian. Switched by system.debug.out bit 2 and
 * system.debug.mode (level), both stored in the Forge.
 */
export const LOG_FILE = "FORGE.LOG";
export const LOG_OLD = "FORGE.OLD";
export const LOG_FILE_BIT = 4;  // system.debug.out bit 2 (debugout_file)
export const LOG_LEVELS = [tk("common.off"), "fatal", "error", "warn", "info", "debug", "trace", "all"];

export interface LogRecord {
  boot: number;
  ms: number;
  level: number;
  module: number;
  event: number;
  p1: number;
  p2: number;
}

export function decodeLog(b: Uint8Array): LogRecord[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: LogRecord[] = [];
  for (let i = 0; i + 12 <= b.length; i += 12) {
    const lm = v.getUint8(i + 6);
    out.push({ boot: v.getUint16(i, true), ms: v.getUint32(i + 2, true), level: lm >> 5, module: lm & 31,
      event: v.getUint8(i + 7), p1: v.getUint16(i + 8, true), p2: v.getUint16(i + 10, true) });
  }
  return out;
}

const MODULES: Record<number, string> = { 1: tk("log.system"), 2: tk("common.error"), 3: "DSP", 4: "Preset", 5: tk("log.supply"), 6: "Log" };
export const logModule = (m: number) => (MODULES[m] ? tx(MODULES[m]) : t("log.moduleN", { n: m }));

function resetCause(f: number): string {
  const n = [[0, tk("log.power")], [1, "Reset-Pin"], [2, tk("log.brownOut")], [3, "Watchdog"], [5, "Software"], [4, "Debugger"], [6, tk("log.fuse")]]
    .filter(([bit]) => f & (1 << (bit as number))).map(([, name]) => tx(name as string));
  return n.length ? n.join(", ") : t("common.unknown");
}

const bits = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");

/** one record as text */
export function logText(r: LogRecord): string {
  switch (r.module) {
    case 1:
      if (r.event === 1) return `${t("common.start")} (${resetCause(r.p1)})`;
      if (r.event === 2) return t("log.dspRestartChipsChips", { chips: bits(r.p1) }) + (r.p2 ? `, ${t("log.coreReportedErrorState")}` : "");
      if (r.event === 3) return t("log.hardwareDiffersOutputsMuted", { a: bits(r.p1), b: bits(r.p2) });
      break;
    case 2:
      return t("log.nameTypeNNow", { name: errorName(r.event), n: r.event, count: r.p1 });
    case 3:
      if (r.event === 1) {
        const ok = (r.p2 & 255) === 1;
        return t("log.dspEEPROMCoreN", { n: r.p1 }) + (r.p2 >> 8 > 1 ? ` ${t("log.nAttempts", { n: r.p2 >> 8 })}` : "")
          + `, ${ok ? t("log.verified") : t("common.wrongChecksum")}`;
      }
      if (r.event === 2) {
        const st = r.p2 & 255;
        return `${t("log.coreN", { n: r.p1 })}: ${st ? t("log.errorStateN", { n: st }) : t("log.running")}`;
      }
      break;
    case 4:
      if (r.event === 1) return t("log.presetNLoaded", { n: r.p1 + 1 });
      if (r.event === 2) return t("log.presetNCFGLoaded", { n: r.p1 });
      break;
    case 5:
      if (r.event === 1) return t("log.supplyTooLowV", { v: (r.p1 / 1000).toFixed(2) });
      if (r.event === 2) return t("log.supplyGoodAgainV", { v: (r.p1 / 1000).toFixed(2) });
      break;
    case 6:
      if (r.event === 1) return t("log.logFileStartedFormat", { f: r.p1, n: r.p2 });
      if (r.event === 2) return t("log.nEntriesLostQueue", { n: r.p1 });
      break;
  }
  return `${t("log.eventN", { n: r.event })} (${r.p1}, ${r.p2})`;
}
