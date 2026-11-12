// Diagnostics on the I2C buses of the Forge (port firmware: i2c.B.scan, i2c.B.A.R, …).
// Addresses are the 8-bit write addresses as the firmware prints them (&H68).
import type { Value } from "../protocol/request";

export interface Chip { bus: number; addr: number; name: string; role: string }

/** chips of the Forge boards by bus and address (forge-dsp-firmware sources) */
export const CHIPS: Chip[] = [
  { bus: 1, addr: 0x20, name: "CT7302", role: "S/PDIF-Empfänger und Abtastratenwandler" },
  { bus: 1, addr: 0x22, name: "CT7302", role: "zweiter Abtastratenwandler" },
  { bus: 1, addr: 0x40, name: "PCA9554", role: "Port-Expander (Schaltausgänge)" },
  { bus: 1, addr: 0x4e, name: "PCA9554", role: "Port-Expander (Peripherie)" },
  { bus: 1, addr: 0x70, name: "PCA9554A", role: "Port-Expander (Schaltausgänge)" },
  { bus: 1, addr: 0x7e, name: "PCA9554A", role: "Port-Expander (Peripherie)" },
  { bus: 1, addr: 0x68, name: "TAS3108", role: "DSP 1: Eingänge, Mixer, Signalsummen" },
  { bus: 1, addr: 0xa0, name: "24LC512", role: "Programmspeicher DSP 1" },
  { bus: 1, addr: 0xa8, name: "24LC512", role: "Presets" },
  { bus: 1, addr: 0xe0, name: "Si5338", role: "Taktgenerator" },
  { bus: 1, addr: 0xe2, name: "Si5338", role: "Taktgenerator" },
  { bus: 2, addr: 0x68, name: "TAS3108", role: "DSP 2: Ausgänge 5–8" },
  { bus: 2, addr: 0x6a, name: "TAS3108", role: "DSP 3: Ausgänge 1–4" },
  { bus: 2, addr: 0x90, name: "ES9018", role: "D/A-Wandler" },
  { bus: 2, addr: 0xa0, name: "24LC512", role: "Programmspeicher DSP 2" },
  { bus: 2, addr: 0xa2, name: "24LC512", role: "Programmspeicher DSP 3" },
];
export const chipAt = (bus: number, addr: number) => CHIPS.find((c) => c.bus === bus && c.addr === addr);
/** the firmware refuses direct access to the EEPROMs */
export const isEeprom = (addr: number) => addr >= 0xa0 && addr <= 0xaf;

export const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** "&H20" -> 0x20; i2c.B.scan = [&H20,&H22,…] */
export function parseScan(v: Value | undefined): number[] {
  return (Array.isArray(v) ? v : []).map((x) => parseInt(String(x).replace(/^&H/i, ""), 16)).filter((n) => !Number.isNaN(n));
}

/** i2c.B.A.R = "&HE4,&B11100100" -> 0xE4 */
export function parseRegister(v: Value | undefined): number | null {
  const m = /&H([0-9A-F]{1,2})/i.exec(String(v ?? ""));
  return m ? parseInt(m[1], 16) : null;
}

/** CT7302 register 0x7A: the receiver is locked when the three top bits are clear */
export const ct7302Locked = (reg7a: number) => (reg7a & 0xe0) === 0;
/** ES9018 register 27, bit 0: DPLL locked to the input */
export const es9018Locked = (reg27: number) => (reg27 & 1) === 1;

/** error counters of system.errors = [[code, count], …] */
export function errorName(code: number): string {
  const FW: Record<number, string> = {
    33: "EEPROM (Presets)", 34: "DSP meldet Fehlerzustand", 64: "AES-Daten", 65: "Prüfsumme Daten (hart)",
    66: "Preset laden", 128: "Prüfsumme Daten (weich)", 129: "Schnittstelle: Befehl nicht bestätigt",
    130: "MCU über 85 °C", 131: "MCU über 90 °C", 132: "MCU über 95 °C", 133: "MCU über 100 °C",
  };
  if (FW[code]) return FW[code];
  if (code >= 1 && code <= 16) {
    const bit = code - 1;  // bit in the DSP ready mask: core (even) and its program EEPROM (odd) alternate
    return bit % 2 ? `DSP ${(bit + 1) / 2}: Programmspeicher antwortet nicht` : `DSP ${bit / 2 + 1}: Kern antwortet nicht`;
  }
  if (code >= 17 && code <= 32) return `Baustein ${code - 17} antwortet nicht`;
  return `Code ${code}`;
}

/** system.hardware.dsp = per bus [ms until load starts, edges, ms until quiet, limit, retries], then restarted */
export interface DspBoot { bus: number; startMs: number; edges: number; quietMs: number; timeout: boolean; retries: number }
export function parseDspBoot(v: Value | undefined): { buses: DspBoot[]; restarted: boolean } | null {
  if (!Array.isArray(v) || v.length < 8) return null;
  const n = v.map(Number);
  const per = v.length >= 11 ? 5 : 4;  // 2.0.0 and later report the retries
  const buses = [0, 1].map((b) => ({ bus: b + 1, startMs: n[b * per], edges: n[b * per + 1], quietMs: n[b * per + 2],
    timeout: !!n[b * per + 3], retries: per === 5 ? n[b * per + 4] : 0 }));
  return { buses, restarted: per === 5 && !!n[10] };
}

/** hardware check of the firmware: system.feature.attributes.hw = [?, ?, dsp expected, dsp found, other expected, other found] */
export function hardwareCheck(hw: Value | undefined): { ok: boolean; dsp: [number, number]; other: [number, number] } | null {
  if (!Array.isArray(hw) || hw.length < 6) return null;
  const n = hw.map(Number);
  return { ok: n[2] === n[3] && n[4] === n[5], dsp: [n[2], n[3]], other: [n[4], n[5]] };
}
