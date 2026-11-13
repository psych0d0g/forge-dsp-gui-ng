import { sdList, type SdFile, type SdLink } from "./sdfiles";

/**
 * Backup on the microSD before a firmware update (forge-dsp-firmware#61): the firmware copies
 * flash, MCU EEPROM, preset EEPROM and the EEPROMs of the DSP cores to the card itself, one part
 * per command, and reads each file back before it answers. Much faster than the serial line and
 * more complete than the read-out in the bootloader (flash and MCU EEPROM only).
 */
export interface BackupInfo { flash: number; eeprom: number; preset: number; cores: number }
export interface BackupPart { part: string; label: string; file: string; size: number }

/** what the firmware can back up; null: no card support for it (original or older port firmware) */
export async function backupInfo(l: SdLink): Promise<BackupInfo | null> {
  const a = (await l.get("system.sd.backup").catch(() => [])).find((x) => x.kind === "get");
  const v = a?.value;
  if (!Array.isArray(v) || v.length < 4 || !v.every((x) => typeof x === "number")) return null;
  const [flash, eeprom, preset, cores] = v as number[];
  return { flash, eeprom, preset, cores };
}

export function backupParts(info: BackupInfo, slot: number): BackupPart[] {
  const p: BackupPart[] = [
    { part: "flash", label: "Firmware (Flash)", file: `FLASH_${slot}.BIN`, size: info.flash },
    { part: "eeprom", label: "Einstellungen (MCU-EEPROM)", file: `EEPROM_${slot}.BIN`, size: info.eeprom },
  ];
  if (info.preset) p.push({ part: "preset", label: "Presets (Preset-EEPROM)", file: `PRESET_${slot}.BIN`, size: info.preset });
  for (let c = 1; c <= info.cores; c++)
    p.push({ part: String(c), label: `DSP-Kern ${c} (Programm und Biquads)`, file: `DSP${c}_${slot}.BIN`, size: 0x10000 });
  return p;
}

/** slots 1..9 in use: a FLASH_S.BIN or another part of slot S on the card */
export function usedSlots(files: SdFile[]): number[] {
  const s = new Set<number>();
  for (const f of files) {
    const m = /^(?:FLASH|EEPROM|PRESET|DSP\d)_([1-9])\.BIN$/i.exec(f.name);
    if (m) s.add(Number(m[1]));
  }
  return [...s].sort((a, b) => a - b);
}
export const freeSlot = (files: SdFile[]) => [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !usedSlots(files).includes(n)) ?? null;

/** a 64 KB EEPROM over I2C takes about 8 s, the flash about 5 s */
const PART_TIMEOUT_MS = 30000;

/**
 * The whole backup into a free slot. progress(index of the part, parts); throws with a German
 * message when the card is full of backups or a part fails. Returns the slot and the files.
 */
export async function sdBackup(l: SdLink, info: BackupInfo, progress: (i: number, parts: BackupPart[]) => void = () => {}): Promise<{ slot: number; parts: BackupPart[] }> {
  const slot = freeSlot(await sdList(l));
  if (slot === null) throw new Error("Auf der Karte liegen schon 9 Sicherungen. Bitte alte auf der Seite Speicherkarte löschen.");
  const parts = backupParts(info, slot);
  for (let i = 0; i < parts.length; i++) {
    progress(i, parts);
    const err = await l.set(`system.sd.backup.${parts[i].part}`, slot, PART_TIMEOUT_MS);
    if (err) throw new Error(`${parts[i].label}: ${err}`);
  }
  progress(parts.length, parts);
  const files = await sdList(l);
  for (const p of parts) {
    const f = files.find((x) => x.name.toUpperCase() === p.file);
    if (!f || f.size !== p.size) throw new Error(`${p.file}: auf der Karte ${f?.size ?? 0} statt ${p.size} Byte`);
  }
  return { slot, parts };
}
