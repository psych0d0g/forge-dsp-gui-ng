// What runs on a Forge, from its flash as read in the bootloader (#17): the bootloader cannot tell
// the model, the firmware image can. From it the GUI picks the file for the update.
//
// Original (BASCOM 1.11.6000 and older): the model stands in the feature list (`["\0\0` MODEL `\0`),
// vendor and PCB before the licence (`BNS\0` `4.0\0` `-CCBYNCSA-`). 96ELN on PCB 3.0 and 4.0 both
// say "4.0"; only the 4.x build checks the clock generator (" * check si5338"), the 3.0 build its
// ES9018 DAC (" * check es9018").
// Port: the identities a build can take as NUL-terminated strings ("96ELN\0", "4.0\0", for the
// V4x build also "CORED8\0"), the version after "system.firmware.port=\0", the licence with the
// build date in one string ("-CCBYNCSA-20261113-MDD").
// Which of several identities a port build took is kept in the EEPROM, so an update keeps it.

export interface FlashId {
  kind: "original" | "port" | "unknown" | "empty";
  /** 1.11.6000 for the original, 2.1.0 (or a build description) for the port */
  version: string;
  model: string;
  pcb: string;
  /** Si5338 clock generator: PCB 4.x (null: cannot tell) */
  hasClock: boolean | null;
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

export function identifyFlash(flash: Uint8Array): FlashId {
  const none: FlashId = { kind: "unknown", version: "", model: "", pcb: "", hasClock: null };
  if (flash.every((b) => b === 0xff)) return { ...none, kind: "empty" };
  const s = latin1(flash);

  // the bootloader writes only the pages of a new image: behind a (smaller) port image the tail of an
  // older firmware stays, with its strings. The image that starts the flash comes first.
  const portSig = /-CCBYNCSA-\d{8}-MDD\0/.exec(s);        // port: "-CCBYNCSA-" FW_BUILD_DATE "-MDD"
  const origSig = /[A-Z]{3}\0(\d\.\d)\0-CCBYNCSA-\0/.exec(s);  // original: vendor, PCB, licence apart

  if (portSig && (!origSig || portSig.index < origSig.index)) {
    const w = s.slice(0, portSig.index + 0x400);
    const version = /system\.firmware\.port=\0([^\0]{1,40})\0/.exec(w)?.[1] ?? "";
    const has = (t: string) => w.includes(`\0${t}\0`);
    const id = has("96LN") ? { model: "96LN", pcb: "3.0", hasClock: false }
      : has("96ELN3") ? { model: "96ELN3", pcb: "4.0", hasClock: true }
      : has("CORED8") ? { model: "96ELN", pcb: "4.0", hasClock: true }     // V4x build: 96ELN 4.0 and CORE D8
      : has("96ELN") ? { model: "96ELN", pcb: "4.0", hasClock: false }     // V30 build: 96ELN only
      : null;
    if (id) return { kind: "port", version, ...id };
  }

  const orig = origSig && /\["\0\0([0-9A-Z]{3,8})\0/.exec(s);
  if (origSig && orig) {
    const model = orig[1];
    const version = /(?<![\d.])(1\.\d{1,2}\.\d{4})\0/.exec(s)?.[1] ?? "";
    const hasClock = model === "96LN" ? false
      : model === "96ELN" ? (s.includes(" * check si5338") ? true : s.includes(" * check es9018") ? false : null)
      : true;
    return { kind: "original", version, model, pcb: origSig[1], hasClock };
  }
  return none;
}

/** for the page: "Original 1.11.6000, 96ELN PCB 4.x" */
export function describeFlash(f: FlashId): string {
  if (f.kind === "empty") return "keine Firmware im Flash";
  if (f.kind === "unknown") return "nicht erkannt";
  const board = f.hasClock === null ? "" : f.hasClock ? ", PCB 4.x" : ", PCB 3.0";
  return `${f.kind === "original" ? "Original" : "Port"} ${f.version || "?"}, ${f.model}${board}`;
}
