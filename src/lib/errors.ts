// Error texts for people: the firmware answers with four short English errors (cmd_core.c error_line),
// the browser, the app and the ESP32 bridge with their own. explain() makes one German sentence of each;
// unknown texts pass unchanged.
import type { Answer } from "./protocol";
import { t, tk, tx } from "./i18n/index.svelte";

/** the firmware's error answers (`!.1 <register> <text>`) */
const DEVICE: Record<string, (reg: string) => string> = {
  "unknown command": (r) => t("errors.deviceDoesNotKnow", { r }),
  "unknown para": (r) => t("errors.valueRHasFormat", { r }),
  "command out of range": (r) => t("errors.valueOrNumberR", { r }),
  chksum: (r) => t("errors.transferRWasDisturbed", { r }),
};

/** an error answer of the device as a sentence */
export function deviceError(a: Pick<Answer, "register" | "message">): string {
  const m = (a.message ?? "").trim();
  const f = DEVICE[m.toLowerCase()];
  return f ? f(a.register) : `${a.register}: ${m || t("common.error")}`;
}

/** patterns of other errors: [test, text]; {1} … from the match */
const OTHER: [RegExp, string][] = [
  [/^timeout: (.*)$/i, tk("errors.deviceDidNotAnswer")],
  [/no port selected|not ?found.*port|user cancel/i, tk("common.noPortChosen")],
  [/failed to open serial port|device or resource busy|resource busy|access is denied|zugriff verweigert/i,
    tk("errors.portBusyInterfaceStill")],
  [/permission denied/i, tk("errors.noPermissionPortLinux")],
  [/no such file or directory|the device has been lost|device not configured|broken pipe|i\/o error/i,
    tk("errors.connectionForgeWasLost")],
  [/^WebSocket (\S+) failed$/, tk("errors.esp32BridgeAt1")],
  [/^not connected$|^nicht verbunden$/i, tk("errors.notConnected")],
  [/failed to fetch|networkerror|load failed/i, tk("errors.noConnectionInternetOr")],
];

/** any thrown error or text as a sentence for the user */
export function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of OTHER) {
    const m = re.exec(msg);
    if (m) return tx(text, Object.fromEntries(m.slice(1).map((v, i) => [String(i + 1), v ?? ""])));
  }
  return msg;
}
