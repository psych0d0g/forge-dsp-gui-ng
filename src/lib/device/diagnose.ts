// Diagnostics on the I2C buses of the Forge (port firmware: i2c.B.scan, i2c.B.A.R, …).
// Addresses are the 8-bit write addresses as the firmware prints them (&H68).
import type { Value } from "../protocol/request";
import { t, tk, tx } from "../i18n/index.svelte";

export interface Chip { bus: number; addr: number; name: string; role: string }

/** chips of the Forge boards by bus and address (forge-dsp-firmware sources) */
export const CHIPS: Chip[] = [
  { bus: 1, addr: 0x20, name: "CT7302", role: tk("diagnose.sPDIFReceiverSample") },
  { bus: 1, addr: 0x22, name: "CT7302", role: tk("diagnose.secondSampleRateConverter") },
  { bus: 1, addr: 0x40, name: "PCA9554", role: tk("diagnose.portExpanderSwitchedOutputs") },
  { bus: 1, addr: 0x4e, name: "PCA9554", role: tk("diagnose.portExpanderPeripherals") },
  { bus: 1, addr: 0x70, name: "PCA9554A", role: tk("diagnose.portExpanderSwitchedOutputs") },
  { bus: 1, addr: 0x7e, name: "PCA9554A", role: tk("diagnose.portExpanderPeripherals") },
  { bus: 1, addr: 0x68, name: "TAS3108", role: tk("diagnose.dsp1InputsMixer") },
  { bus: 1, addr: 0xa0, name: "24LC512", role: tk("diagnose.programMemoryDSP1") },
  { bus: 1, addr: 0xa8, name: "24LC512", role: tk("common.presets") },
  { bus: 1, addr: 0xe0, name: "Si5338", role: tk("common.clockGenerator") },
  { bus: 1, addr: 0xe2, name: "Si5338", role: tk("common.clockGenerator") },
  { bus: 2, addr: 0x68, name: "TAS3108", role: tk("diagnose.dsp2Outputs5") },
  { bus: 2, addr: 0x6a, name: "TAS3108", role: tk("diagnose.dsp3Outputs1") },
  { bus: 2, addr: 0x90, name: "ES9018", role: tk("diagnose.daConverter") },
  { bus: 2, addr: 0xa0, name: "24LC512", role: tk("diagnose.programMemoryDSP2") },
  { bus: 2, addr: 0xa2, name: "24LC512", role: tk("diagnose.programMemoryDSP3") },
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
    33: tk("diagnose.eepromPresets"), 34: tk("diagnose.dspReportsErrorState"), 64: tk("diagnose.aesData"), 65: tk("diagnose.dataChecksumHard"),
    66: tk("diagnose.loadingPreset"), 128: tk("diagnose.dataChecksumSoft"), 129: tk("diagnose.interfaceCommandNotAcknowledged"),
    130: tk("diagnose.mcuAbove85C"), 131: tk("diagnose.mcuAbove90C"), 132: tk("diagnose.mcuAbove95C"), 133: tk("diagnose.mcuAbove100C"),
  };
  if (FW[code]) return tx(FW[code]);
  if (code >= 1 && code <= 16) {
    const bit = code - 1;  // bit in the DSP ready mask: core (even) and its program EEPROM (odd) alternate
    return bit % 2 ? t("diagnose.dspNProgramMemory", { n: (bit + 1) / 2 }) : t("diagnose.dspNCoreDoes", { n: bit / 2 + 1 });
  }
  if (code >= 17 && code <= 32) return t("diagnose.chipNDoesNot", { n: code - 17 });
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
