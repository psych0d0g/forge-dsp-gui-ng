// A firmware update from start to end. The text protocol and the raw bytes share one port; the
// caller hands in both, so the sequence can be tested against the simulated target.
import type { ByteLink } from "../transport/types";
import { APP_SIZE, Bootloader, EEPROM_SIZE, NoAnswer, paddedImage } from "./client";

export type Step = "enter" | "connect" | "backup" | "write" | "verify" | "start" | "identity";
export const STEP_LABEL: Record<Step, string> = {
  enter: "Bootloader anfordern", connect: "Bootloader verbinden", backup: "Alte Firmware und Einstellungen sichern",
  write: "Neue Firmware schreiben", verify: "Geschriebenes prüfen", start: "Neue Firmware starten", identity: "Gerätekennung prüfen",
};

export interface UpdateIo {
  link: ByteLink;
  /** send one line of the text protocol (no answer expected) */
  sendLine(line: string): Promise<void>;
  /** text of the answer to `get.1 <reg>`, "" when nothing comes */
  ask(reg: string): Promise<string>;
  onStep(step: Step, done?: number, total?: number): void;
  /** flash and EEPROM as read before writing */
  onBackup?(flash: Uint8Array, eeprom: Uint8Array): void;
  sleep?(ms: number): Promise<void>;
}

export interface UpdateOptions {
  image: Uint8Array;
  backup: boolean;
  /** "MODEL-PCB" the device reported before (kept in its EEPROM; set again if the new firmware lost it) */
  identity: string;
  connectMs?: number;
  startMs?: number;
}

export class UpdateError extends Error {
  /** true once the flash was touched: the old firmware is gone, the bootloader remains */
  constructor(message: string, public step: Step, public flashTouched: boolean) { super(message); }
}

export async function runUpdate(io: UpdateIo, o: UpdateOptions): Promise<{ bootloader: string; written: number }> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bl = new Bootloader(io.link);
  let step: Step = "enter", touched = false;
  const at = (s: Step, done?: number, total?: number) => { step = s; io.onStep(s, done, total); };
  try {
    at("enter");
    // still in the bootloader from an attempt that failed? Then it no longer answers autobaud.
    let inBoot = false;
    try { await new Bootloader(io.link, 400).bootloaderVersion(); inBoot = true; } catch { /* the application is running */ }
    if (!inBoot) {
      await io.sendLine("");                       // end whatever the probe left in the line buffer
      await io.sendLine("set.1 system.boot=1");    // port firmware: resets into the bootloader about 1 s later
      await sleep(2000);                           // bursts during the reset would spoil the baud rate measurement
      at("connect");
      if (!(await bl.connect(o.connectMs ?? 40000)))
        throw new Error("Der Bootloader meldet sich nicht. Das Gerät läuft mit der bisherigen Firmware weiter.");
    }
    const v = await bl.bootloaderVersion();

    if (o.backup) {
      const total = APP_SIZE + EEPROM_SIZE;
      at("backup", 0, total);
      const flash = await bl.readFlash(0, APP_SIZE, (d) => at("backup", d, total));
      const eeprom = await bl.readEeprom(0, EEPROM_SIZE, (d) => at("backup", APP_SIZE + d, total));
      io.onBackup?.(flash, eeprom);
    }

    const want = paddedImage(o.image);
    at("write", 0, want.length);
    touched = true;
    const n = await bl.writeFlash(o.image, (d) => at("write", d, want.length));

    at("verify", 0, n);
    const back = await bl.readFlash(0, n, (d) => at("verify", d, n));
    if (back.length !== n || back.some((b, i) => b !== want[i]))
      throw new Error("Das Zurückgelesene stimmt nicht mit dem Image überein. Die Firmware wird nicht gestartet.");

    at("start");
    await bl.startApplication();
    const end = Date.now() + (o.startMs ?? 90000);
    let up = false;
    while (!up && Date.now() < end) {
      up = (await io.ask("system.ping")).includes("pong");
      if (!up) await sleep(500);
    }
    if (!up) throw new Error("Die neue Firmware antwortet nicht.");

    at("identity");
    if (o.identity) {
      let key = "";
      for (let i = 0; i < 20 && !key; i++) {       // ping answers before the start has finished
        key = await io.ask("system.key.info");
        if (!key) await sleep(1000);
      }
      if (!key.includes(`-${o.identity}-`)) {
        await io.sendLine(`set.1 system.key.info="${o.identity}"`);
        await sleep(500);
        if (!(await io.ask("system.key.info")).includes(`-${o.identity}-`))
          throw new Error(`Die Kennung ${o.identity} ließ sich nicht setzen (diese Firmware kennt den Befehl nicht).`);
      }
    }
    return { bootloader: `${v[0]}.${v[1]}`, written: n };
  } catch (e) {
    if (e instanceof UpdateError) throw e;
    const msg = e instanceof NoAnswer ? "Der Bootloader antwortet nicht mehr." : e instanceof Error ? e.message : String(e);
    throw new UpdateError(msg, step, touched);
  }
}
