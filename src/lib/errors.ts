// Error texts for people: the firmware answers with four short English errors (cmd_core.c error_line),
// the browser, the app and the ESP32 bridge with their own. explain() makes one German sentence of each;
// unknown texts pass unchanged.
import type { Answer } from "./protocol";

/** the firmware's error answers (`!.1 <register> <text>`) */
const DEVICE: Record<string, (reg: string) => string> = {
  "unknown command": (r) => `Das Gerät kennt „${r}“ nicht. Die Firmware ist älter oder das Modell hat diese Funktion nicht.`,
  "unknown para": (r) => `Der Wert für „${r}“ hat ein Format, das das Gerät nicht versteht.`,
  "command out of range": (r) => `Der Wert oder die Nummer für „${r}“ liegt außerhalb dessen, was das Gerät erlaubt.`,
  chksum: (r) => `Die Übertragung von „${r}“ war gestört (Prüfsumme falsch). Bitte noch einmal versuchen.`,
};

/** an error answer of the device as a sentence */
export function deviceError(a: Pick<Answer, "register" | "message">): string {
  const m = (a.message ?? "").trim();
  const f = DEVICE[m.toLowerCase()];
  return f ? f(a.register) : `${a.register}: ${m || "Fehler"}`;
}

/** patterns of other errors: [test, text]; $1 … from the match */
const OTHER: [RegExp, string][] = [
  [/^timeout: (.*)$/i, "Das Gerät hat auf „$1“ nicht geantwortet. Ist es noch eingeschaltet und verbunden?"],
  [/no port selected|not ?found.*port|user cancel/i, "Kein Anschluss gewählt."],
  [/failed to open serial port|device or resource busy|resource busy|access is denied|zugriff verweigert/i,
    "Der Anschluss ist belegt. Läuft die Oberfläche noch in einem anderen Fenster oder Browser-Tab, oder ein anderes Programm am Forge?"],
  [/permission denied/i, "Keine Berechtigung für den Anschluss. Unter Linux: Benutzer in die Gruppe „uucp“ bzw. „dialout“ aufnehmen und neu anmelden."],
  [/no such file or directory|the device has been lost|device not configured|broken pipe|i\/o error/i,
    "Die Verbindung zum Forge ist abgerissen (USB-Kabel gezogen oder Gerät ausgeschaltet?)."],
  [/^WebSocket (\S+) failed$/, "Die ESP32-Brücke unter $1 ist nicht erreichbar. Ist das Handy oder der PC im WLAN des Forge?"],
  [/^not connected$|^nicht verbunden$/i, "Nicht verbunden."],
  [/failed to fetch|networkerror|load failed/i, "Keine Verbindung zum Internet oder zu GitHub."],
];

/** any thrown error or text as a sentence for the user */
export function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of OTHER) {
    const m = re.exec(msg);
    if (m) return text.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
  }
  return msg;
}
