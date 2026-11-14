// Start of the Forge in words (forge-dsp-firmware#67): system.startup.time gives ms from the clock
// start of the firmware to each phase (-1 = not reached) and, last, the ms spent in the bootloader.
import { tk, type Key } from "../i18n/index.svelte";

export interface StartupStage { key: Key; ms: number | null; hint?: Key }
export interface Startup { stages: StartupStage[]; total: number | null; bootloader: number; stuck: boolean }

// indices into the list (phase n of the firmware is index n - 1)
const DAC = 4, EEPROM3 = 7, CORE3 = 13, INIT = 16, PRESET = 17, REMOTE = 18, UNMUTED = 19, BOOTLOADER = 20;

/** the bootloader waits up to 58.6 s for a host when its start condition holds */
export const BOOTLOADER_STUCK_MS = 1000;

export function decodeStartup(t: number[] | null): Startup | null {
  if (!t || t.length < 20) return null;
  const at = (i: number) => (t[i] >= 0 ? t[i] : null);
  const span = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? b - a : null);
  const bootloader = t.length > BOOTLOADER ? Math.max(0, t[BOOTLOADER]) : 0;
  const stages: StartupStage[] = [
    { key: tk("startup.bootloader"), ms: bootloader, hint: tk("startup.bootloaderHint") },
    { key: tk("startup.basics"), ms: at(DAC), hint: tk("startup.basicsHint") },
    { key: tk("startup.dspCheck"), ms: span(at(DAC), at(EEPROM3)), hint: tk("startup.dspCheckHint") },
    { key: tk("startup.dspBoot"), ms: span(at(EEPROM3), at(CORE3)), hint: tk("startup.dspBootHint") },
    { key: tk("startup.rest"), ms: span(at(CORE3), at(INIT)), hint: tk("startup.restHint") },
    { key: tk("startup.preset"), ms: span(at(INIT), at(PRESET)), hint: tk("startup.presetHint") },
    { key: tk("startup.beforeRemote"), ms: span(at(PRESET), at(REMOTE)), hint: tk("startup.beforeRemoteHint") },
    { key: tk("startup.amps"), ms: span(at(REMOTE), at(UNMUTED)), hint: tk("startup.ampsHint") },
  ];
  const u = at(UNMUTED);
  return { stages, total: u === null ? null : u + bootloader, bootloader, stuck: bootloader > BOOTLOADER_STUCK_MS };
}

/** "1:02:03" or "2 d 01:02:03" */
export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  const two = (x: number) => String(x).padStart(2, "0");
  const hms = `${d ? two(h) : h}:${two(m)}:${two(s % 60)}`;
  return d ? `${d} d ${hms}` : hms;
}
