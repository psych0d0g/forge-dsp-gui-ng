import { errorName } from "./diagnose";

/**
 * Binary log of the port firmware on the microSD (forge-dsp-firmware#60, docs/log-format.md):
 * FORGE.LOG / FORGE.OLD, 12-byte records little endian. Switched by system.debug.out bit 2 and
 * system.debug.mode (level), both stored in the Forge.
 */
export const LOG_FILE = "FORGE.LOG";
export const LOG_OLD = "FORGE.OLD";
export const LOG_FILE_BIT = 4;  // system.debug.out bit 2 (debugout_file)
export const LOG_LEVELS = ["aus", "fatal", "error", "warn", "info", "debug", "trace", "all"];

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

const MODULES: Record<number, string> = { 1: "System", 2: "Fehler", 3: "DSP", 4: "Preset", 5: "Versorgung", 6: "Log" };
export const logModule = (m: number) => MODULES[m] ?? `Modul ${m}`;

function resetCause(f: number): string {
  const n = [[0, "Einschalten"], [1, "Reset-Pin"], [2, "Unterspannung"], [3, "Watchdog"], [5, "Software"], [4, "Debugger"], [6, "Sicherung"]]
    .filter(([bit]) => f & (1 << (bit as number))).map(([, t]) => t);
  return n.length ? n.join(", ") : "unbekannt";
}

const bits = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");

/** one record as text */
export function logText(r: LogRecord): string {
  switch (r.module) {
    case 1:
      if (r.event === 1) return `Start (${resetCause(r.p1)})`;
      if (r.event === 2) return `DSP-Neustart: Bausteine ${bits(r.p1)}${r.p2 ? ", ein Kern meldete einen Fehlerzustand" : ""}`;
      if (r.event === 3) return `Hardware weicht ab, Ausgänge stumm (DSP ${bits(r.p1)}, andere ${bits(r.p2)})`;
      break;
    case 2:
      return `${errorName(r.event)} (Typ ${r.event}), jetzt ${r.p1}×`;
    case 3:
      if (r.event === 1) {
        const ok = (r.p2 & 255) === 1;
        return `DSP-EEPROM von Kern ${r.p1} neu geschrieben${r.p2 >> 8 > 1 ? ` (${r.p2 >> 8} Versuche)` : ""}, ${ok ? "geprüft" : "Prüfsumme falsch"}`;
      }
      if (r.event === 2) {
        const st = r.p2 & 255;
        return `Kern ${r.p1}: ${st ? `Fehlerzustand ${st}` : "läuft"}`;
      }
      break;
    case 4:
      if (r.event === 1) return `Preset ${r.p1 + 1} geladen`;
      if (r.event === 2) return `PRESET_${r.p1}.CFG von der Karte geladen`;
      break;
    case 5:
      if (r.event === 1) return `Versorgung zu niedrig: ${(r.p1 / 1000).toFixed(2)} V`;
      if (r.event === 2) return `Versorgung wieder gut: ${(r.p1 / 1000).toFixed(2)} V`;
      break;
    case 6:
      if (r.event === 1) return `Log-Datei begonnen (Format ${r.p1}, ${r.p2} Byte je Satz)`;
      if (r.event === 2) return `${r.p1} Einträge verloren (Warteschlange voll oder keine Karte)`;
      break;
  }
  return `Ereignis ${r.event} (${r.p1}, ${r.p2})`;
}
