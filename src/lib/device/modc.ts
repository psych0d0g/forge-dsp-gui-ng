// MODC control blocks: modc.N = [enable, type, flags(4 bytes), event 1..4, sets(4 bytes)].
// Names and help follow the dialogs of the original GUI; field meanings are given only where the
// firmware sources document them (forge-dsp-firmware src/modc.c, docs/port-changes.md).
import type { DeviceState, Modc } from "./model";

/** One input of a block's dialog; indices are 1-based as in the firmware (event 1..4, set 1..4, flags 1..4). */
export type Field =
  | { kind: "event"; i: number; label: string }
  /** one byte, optionally shown scaled (value * mul, e.g. steps of 250 ms as seconds) */
  | { kind: "byte"; of: "sets" | "flags"; i: number; label: string; mul?: number; unit?: string; hint?: string }
  /** 16 bits over two bytes, low byte at i; div: shown as value / div */
  | { kind: "word"; of: "sets"; i: number; label: string; signed?: boolean; div?: number; unit?: string; min?: number; max?: number; hint?: string }
  | { kind: "choice"; of: "sets" | "flags"; i: number; label: string; options: string[]; first?: number }
  /** ticks for the bits of one byte; bits[n] = label of bit n, "" = not used */
  | { kind: "bits"; of: "sets" | "flags"; i: number; label: string; bits: string[] };

export interface ModcType {
  type: number;
  name: string;
  help: string;
  /** the dialog; without it the page shows the raw fields */
  fields?: Field[];
}

const ev = (i: number, label: string): Field => ({ kind: "event", i, label });
const set = (i: number, label: string, x: Partial<{ mul: number; unit: string; hint: string }> = {}): Field => ({ kind: "byte", of: "sets", i, label, ...x });
const OUTS = ["Ausgang 1", "Ausgang 2", "Ausgang 3", "Ausgang 4", "Ausgang 5", "Ausgang 6", "Ausgang 7", "Ausgang 8"];
const PAIRS = ["Ausgang 1/2", "Ausgang 3/4", "Ausgang 5/6", "Ausgang 7/8"];
/** conversion curves of the value sources (flags 1, bits 3..7) */
const CURVE_BITS = ["log10", "inv. log10", "alog10", "inv. alog10", "Invertieren"];
const CURVE: Field = { kind: "bits", of: "flags", i: 1, label: "Kennlinie", bits: ["", "", "", ...CURVE_BITS] };
const RANGE_OUT: Field[] = [set(3, "Ausgang Max."), set(4, "Ausgang Min.")];

export const MODC_TYPES: ModcType[] = [
  { type: 16, name: "Lautstärke", help: "Regelt die Pegel der Ausgänge nach Ereigniswerten: Lautstärke, Balance und eine kleine Korrektur, z. B. für Tiefbass oder Hochtöner.",
    fields: [
      { kind: "bits", of: "flags", i: 1, label: "Aktiv für", bits: OUTS },
      ev(1, "Lautstärke der ungeraden Ausgänge (1, 3, 5, 7)"), ev(2, "Lautstärke der geraden Ausgänge (2, 4, 6, 8)"),
      ev(3, "Korrektur (Mitte = 16)"), { kind: "bits", of: "sets", i: 3, label: "Korrektur wirkt auf", bits: OUTS },
      ev(4, "Balance (Mitte = 64)"), { kind: "bits", of: "sets", i: 4, label: "Balance wirkt auf", bits: OUTS },
    ] },
  { type: 17, name: "Potentiometer", help: "Ein Potentiometer am Steueranschluss (Pin 4 grün oder Pin 5 blau) samt Umrechnung und Kennlinie. Gibt seinen Wert als Ereignis aus.",
    fields: [
      set(1, "Poti Max."), set(2, "Poti Min."), set(3, "Ausgang Max."),
      // flags 1 holds the input (bit 0) and the curve (bits 3..7)
      { kind: "bits", of: "flags", i: 1, label: "Anschluss und Kennlinie", bits: ["Poti 2 (Pin 5) statt Poti 1 (Pin 4)", "", "", ...CURVE_BITS] },
    ] },
  { type: 82, name: "Inkrementalgeber", help: "Ein Drehgeber am Steueranschluss (A an Pin 8 weiß, B an Pin 7 grau, Taster an Pin 9 schwarz). Gibt seinen Wert als Ereignis aus.",
    fields: [set(1, "Startwert"), set(2, "Faktor"), ...RANGE_OUT, CURVE] },
  { type: 86, name: "IR-Fernbedienung", help: "Infrarot-Empfänger am RJ45-Anschluss „Master“, aktiviert die IR-Ereignisse. Nach dem ersten Aktivieren muss der Forge einmal neu starten.",
    fields: [set(1, "Startwert"), set(2, "Faktor"), ...RANGE_OUT, CURVE,
      { kind: "bits", of: "flags", i: 2, label: "Modus", bits: ["Eigene Codes (Custom)"] }] },
  { type: 84, name: "Stummschaltung", help: "Schaltet die gewählten Ausgänge stumm, solange das Ereignis aktiv ist.",
    fields: [ev(1, "Auslöser"), { kind: "bits", of: "flags", i: 1, label: "Stumm schalten", bits: OUTS }] },
  { type: 108, name: "Loudness", help: "Hebt Bass und Höhen an, je leiser gehört wird. Belegt die letzten zwei Filter der gewählten Ausgangspaare.",
    fields: [
      { kind: "bits", of: "flags", i: 1, label: "Aktiv für", bits: [...PAIRS, "Summe A/B"] },
      ev(1, "Lautstärke-Quelle (keine = Digitalpegel)"),
      { kind: "word", of: "sets", i: 1, label: "Bass: Frequenz", unit: "Hz", hint: "0 = 100 Hz" },
      { kind: "byte", of: "flags", i: 3, label: "Bass: Anhebung je dB Absenkung", mul: 0.01, unit: "dB", hint: "0 = 0,40" },
      { kind: "word", of: "sets", i: 3, label: "Höhen: Frequenz", unit: "Hz", hint: "0 = 10 000 Hz" },
      { kind: "byte", of: "flags", i: 4, label: "Höhen: Anhebung je dB Absenkung", mul: 0.01, unit: "dB", hint: "0 = 0,15" },
      { kind: "byte", of: "flags", i: 2, label: "Referenz (223 = 0 dB)", hint: "0 = 223" },
    ] },
  { type: 106, name: "Mono", help: "Schaltet Ausgangspaare auf Mono, ohne die Abstimmung zu ändern.",
    fields: [
      { kind: "bits", of: "flags", i: 1, label: "Aktiv für", bits: PAIRS },
      { kind: "choice", of: "sets", i: 1, label: "Modus", first: 1, options: ["Stereo", "Mono rechts", "Mono links", "Stereo zu Mono (L+R)"] },
      ev(1, "Ein/Aus über Ereignis (keines = immer ein)"),
    ] },
  { type: 109, name: "Analoger Mischer", help: "Anteil der drei analogen Eingänge, zusätzlich zur gespeicherten Mischung.",
    fields: [set(1, "Eingang 1", { unit: "%" }), set(2, "Eingang 2", { unit: "%" }), set(3, "Eingang 3", { unit: "%" })] },
  { type: 96, name: "Eingangs-Umschalter", help: "Wählt die digitale Quelle automatisch nach bis zu vier Ereignissen. Ereignis 4 hat die höchste Priorität; ohne aktives Ereignis gilt der Rückfall.",
    fields: [
      { kind: "bits", of: "flags", i: 1, label: "Aktiv für", bits: ["Profil 1", "", "Profil 2", "", "Profil 3", "", "Profil 4"] },
      set(1, "Quelle ohne aktives Ereignis (Rückfall)"),
      ev(2, "Ereignis 2"), set(2, "… schaltet auf Quelle"), ev(3, "Ereignis 3"), set(3, "… schaltet auf Quelle"),
      ev(4, "Ereignis 4 (höchste Priorität)"), set(4, "… schaltet auf Quelle"),
    ] },
  { type: 97, name: "Mixer-Profil-Umschalter", help: "Schaltet die Mixer-Profile automatisch nach bis zu vier Ereignissen um; Ereignis 4 hat die höchste Priorität.",
    fields: [ev(1, "Ereignis 1 (Rückfall)"), ev(2, "Ereignis 2"), ev(3, "Ereignis 3"), ev(4, "Ereignis 4 (höchste Priorität)")] },
  { type: 66, name: "Preset-Umschalter", help: "Wählt das Preset über bis zu drei Ereignisse als Binärzahl (Bit 0, 1, 2).",
    fields: [ev(1, "Bit 0"), ev(2, "Bit 1"), ev(3, "Bit 2")] },
  { type: 193, name: "Ein-/Abschaltung", help: "Verzögerungen beim Ein- und Ausschalten. Ablauf: Remote-In an, Stumm, Preset laden, Pause „StartUp“, Remote-Out an, Pause „RemoteOut“, Stumm aus … Remote-In aus, Stumm, Pause „RemoteOut“, Remote-Out aus, Pause „ShutDown“, Forge aus.",
    fields: [
      set(1, "StartUp: Pause vor Remote-Out", { mul: 0.25, unit: "s" }),
      set(3, "RemoteOut: Pause nach dem Ein- und vor dem Ausschalten von Remote-Out", { mul: 0.25, unit: "s" }),
      set(4, "ShutDown: Pause vor dem Ausschalten des Forge", { mul: 0.25, unit: "s" }),
      set(2, "Abschalten erst, wenn das Signal so lange weg ist", { mul: 0.05, unit: "s", hint: "ungefähr" }),
      ev(1, "Auslöser (Abschalt-Ereignis)"),
    ] },
  { type: 68, name: "Haupttakt", help: "Gleicht die Fertigungsabweichung des Quarzes (TCXO) aus und stellt die Taktrate des D/A-Wandlers ein. Änderungen wirken erst nach einem Neustart des Forge.",
    fields: [
      { kind: "word", of: "sets", i: 1, label: "TCXO-Korrekturwert", signed: true, div: 10, unit: "Hz", min: -1000, max: 1000 },
      { kind: "choice", of: "sets", i: 3, label: "Taktrate D/A-Wandler",
        options: ["49,152 MHz", "50,000 MHz", "60,000 MHz", "70,000 MHz", "73,728 MHz", "80,000 MHz", "90,000 MHz", "98,394 MHz", "100,000 MHz"] },
    ] },
  { type: 69, name: "S/PDIF", help: "Einstellungen des Digitalempfängers." },
  { type: 79, name: "ES9038PRO", help: "Einstellungen des D/A-Wandlers ES9038PRO." },
  { type: 3, name: "Geräte-Sync", help: "Gleicht mehrere Forge in einer Kette ab." },
  { type: 48, name: "Logik", help: "Verknüpft bis zu vier Ereignisse: Eingänge wahlweise invertiert, dann je Maske UND- oder XOR-verknüpft; die erste Maske mit Treffer setzt den Ausgang.",
    fields: [
      ev(1, "Eingang 1"), ev(2, "Eingang 2"), ev(3, "Eingang 3"), ev(4, "Eingang 4"),
      { kind: "bits", of: "flags", i: 1, label: "Verknüpfung", bits: ["Eingang 1 invertieren", "Eingang 2 invertieren", "Eingang 3 invertieren",
        "Eingang 4 invertieren", "Maske 1: XOR statt UND", "Maske 2: XOR statt UND", "Maske 3: XOR statt UND", "Maske 4: XOR statt UND"] },
      set(1, "Maske 1 (Bits der Eingänge)"), set(2, "Maske 2"), set(3, "Maske 3"), set(4, "Maske 4"),
    ] },
  { type: 49, name: "Umschalter", help: "Gibt je nach Schalter-Ereignis einen von zwei Werten aus, jeweils ein Ereignis oder eine Konstante.",
    fields: [ev(3, "Schalter"), ev(1, "Wert bei „falsch“"), set(1, "Konstante bei „falsch“"), ev(2, "Wert bei „wahr“"), set(2, "Konstante bei „wahr“"),
      { kind: "bits", of: "flags", i: 1, label: "Konstante statt Ereignis", bits: ["bei „falsch“", "bei „wahr“"] }] },
  { type: 50, name: "Toggle", help: "Macht aus einem Tastendruck einen Ein/Aus-Schalter.", fields: [ev(1, "Taster-Ereignis")] },
  { type: 51, name: "Begrenzer", help: "Begrenzt einen Wert auf Eingang Min./Max. und rechnet ihn auf den Bereich Ausgang Min./Max. um.",
    fields: [ev(1, "Eingang"), set(1, "Eingang Max."), set(2, "Eingang Min."), ...RANGE_OUT,
      { kind: "bits", of: "flags", i: 1, label: "Kennlinie", bits: ["", "", "", "", "", "", "", "Invertieren"] }] },
  { type: 52, name: "Vergleicher", help: "Vergleicht den Eingang (Ereignis 3) mit Ereignis 1, Ereignis 2 oder der Konstante und gibt Ereignis 1 („falsch“) oder Ereignis 2 („wahr“) aus.",
    fields: [ev(3, "Eingang"), ev(1, "Ausgabe bei „falsch“ / Vergleichswert 1"), ev(2, "Ausgabe bei „wahr“ / Vergleichswert 2"), set(3, "Konstante"),
      { kind: "bits", of: "flags", i: 1, label: "Bedingung", bits: ["Eingang ≥ Ereignis 1", "Eingang ≤ Ereignis 1", "Eingang ≥ Ereignis 2",
        "Eingang ≤ Ereignis 2", "Eingang ≥ Konstante", "Eingang ≤ Konstante"] }] },
  { type: 53, name: "Rechner", help: "Rechnet mit Ereigniswerten." },
];
export const modcType = (t: number) => MODC_TYPES.find((x) => x.type === t);
export const modcName = (t: number) => (t === 0 ? "leer" : modcType(t)?.name ?? `Typ ${t}`);
export const emptyModc = (): Modc => ({ enable: 0, type: 0, flags: [0, 0, 0, 0], events: [0, 0, 0, 0], sets: [0, 0, 0, 0] });

/** value text of modc.N as the firmware expects it */
export const modcText = (m: Modc) =>
  `[${m.enable},${m.type},${m.flags.map(hx).join("")},${m.events.join(",")},${m.sets.map(hx).join("")}]`;
const hx = (b: number) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

/** types this device can run (the firmware reports a version per type, 0 = not available) */
export function availableTypes(s: DeviceState): ModcType[] {
  const known = s.modcVersions.length > 0;
  return MODC_TYPES.filter((t) => !known || (s.modcVersions[t.type & 0x3f] ?? 0) > 0);
}

/** events a block can listen to: fixed ones of the firmware, and the output of each block (96 + N) */
const EVENTS: [number, string][] = [
  [1, "immer aus"], [2, "immer ein"], [3, "Remote-Out"], [4, "Abschaltung"], [5, "Preset"], [6, "USB angeschlossen"],
  [9, "Übersteuerung A/D"], [10, "Übersteuerung D/A"], [11, "Masse-Schalter 1"], [12, "Masse-Schalter 2"], [13, "Masse-Schalter 3"],
  [42, "Ausgänge stumm"], [44, "Quellenwahl"], [58, "IR Lautstärke"], [59, "IR Balance"], [60, "IR Bass"], [61, "IR Stumm"],
  [62, "IR Schalter 1"], [63, "IR Schalter 2"], [64, "IR Schalter 3"],
];
export function eventOptions(blocks: number): { value: number; label: string }[] {
  return [{ value: 0, label: "–" }, ...EVENTS.map(([value, label]) => ({ value, label: `${value}: ${label}` })),
    ...Array.from({ length: blocks }, (_, i) => ({ value: 97 + i, label: `${97 + i}: Ausgang Block ${i + 1}` }))];
}

/** 16-bit value over two bytes (low byte first), as the dialogs of the original GUI store it */
export function wordGet(bytes: number[], i: number, signed = false): number {
  const v = (bytes[i - 1] ?? 0) | ((bytes[i] ?? 0) << 8);
  return signed && v & 0x8000 ? v - 0x10000 : v;
}
export function wordSet(bytes: number[], i: number, v: number) {
  const w = Math.round(v) & 0xffff;
  bytes[i - 1] = w & 0xff;
  bytes[i] = w >> 8;
}
