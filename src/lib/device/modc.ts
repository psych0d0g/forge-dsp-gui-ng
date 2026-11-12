// MODC control blocks: modc.N = [enable, type, flags(4 bytes), event 1..4, sets(4 bytes)].
// Names and help follow the dialogs of the original GUI; field meanings are given only where the
// firmware sources document them (forge-dsp-firmware src/modc.c, docs/port-changes.md).
import type { DeviceState, Modc } from "./model";

export interface BitField { flag: number; labels: string[] }  // labels[i] = bit i of flags byte `flag` (1-based)
export interface ModcType {
  type: number;
  name: string;
  help: string;
  /** labels of events 1..4 / sets 1..4 / flag bytes 1..4; "" = not used by this type */
  events?: string[];
  sets?: string[];
  flags?: string[];
  bits?: BitField[];
}

const PAIRS = ["Ausgang 1/2", "Ausgang 3/4", "Ausgang 5/6", "Ausgang 7/8"];
const PRIO = ["Ereignis 1 (Rückfall)", "Ereignis 2", "Ereignis 3", "Ereignis 4 (höchste Priorität)"];

export const MODC_TYPES: ModcType[] = [
  { type: 16, name: "Lautstärke", help: "Regelt die Pegel der Ausgänge: Lautstärke, Balance und eine kleine Korrektur, z. B. für Tiefbass oder Hochtöner." },
  { type: 17, name: "Potentiometer", help: "Ein Potentiometer am Steueranschluss samt Umrechnung und Filter." },
  { type: 82, name: "Inkrementalgeber", help: "Ein Drehgeber am Steueranschluss samt Umrechnung und Filter." },
  { type: 86, name: "IR-Fernbedienung", help: "Infrarot-Empfänger am RJ45-Anschluss „Master“. Nach dem ersten Aktivieren muss der Forge einmal neu starten." },
  { type: 84, name: "Stummschaltung", help: "Schaltet einzelne Ausgänge über ein Ereignis stumm." },
  { type: 108, name: "Loudness", help: "Hebt Bass und Höhen an, je leiser gehört wird. Belegt die letzten zwei Filter der gewählten Ausgangspaare.",
    events: ["Lautstärke-Quelle (0 = Digitalpegel)", "Schrittweite in 0,01 dB (0 = 0,2 dB)", "Pegel messen an Eingängen (Bitmaske, 0 = aus)", "Zeitkonstante in 0,1 s (0 = 3 s)"],
    flags: ["", "Referenz (223 = 0 dB, 0 = Vorgabe)", "Bass: Anhebung ×0,01 dB je dB (0 = 0,40)", "Höhen: Anhebung ×0,01 dB je dB (0 = 0,15)"],
    bits: [{ flag: 1, labels: [...PAIRS, "Signalsummen A/B"] }] },
  { type: 106, name: "Mono", help: "Schaltet Ausgangspaare auf Mono, ohne die Abstimmung zu ändern.",
    events: ["Ein/Aus über Ereignis (0 = immer ein)", "", "", ""], sets: ["Modus: 1 Stereo, 2 Mono rechts, 3 Mono links, 4 L+R", "", "", ""],
    bits: [{ flag: 1, labels: PAIRS }] },
  { type: 109, name: "Analoger Mischer", help: "Anteil der drei analogen Eingänge in Prozent, zusätzlich zur gespeicherten Mischung.",
    sets: ["Eingang 1 (%)", "Eingang 2 (%)", "Eingang 3 (%)", ""] },
  { type: 96, name: "Eingangs-Umschalter", help: "Wählt die digitale Quelle automatisch nach bis zu vier Ereignissen; Ereignis 4 hat die höchste Priorität, Set 1 ist der Rückfall.",
    events: ["", "Ereignis 2", "Ereignis 3", "Ereignis 4 (höchste Priorität)"], sets: ["Quelle ohne aktives Ereignis", "Quelle bei Ereignis 2", "Quelle bei Ereignis 3", "Quelle bei Ereignis 4"],
    bits: [{ flag: 1, labels: ["Profil 1", "", "Profil 2", "", "Profil 3", "", "Profil 4"] }] },
  { type: 97, name: "Mixer-Profil-Umschalter", help: "Schaltet die Mixer-Profile automatisch nach bis zu vier Ereignissen um; Ereignis 4 hat die höchste Priorität.", events: PRIO },
  { type: 66, name: "Preset-Umschalter", help: "Wählt das Preset über bis zu drei Ereignisse als Binärzahl.", events: ["Bit 0", "Bit 1", "Bit 2", ""] },
  { type: 193, name: "Ein-/Abschaltung", help: "Verzögerungen beim Einschalten und Abschalten (Remote-Out für die Endstufen), je Schritt 250 ms." },
  { type: 68, name: "Haupttakt", help: "Korrektur des Quarzes und Taktrate des D/A-Wandlers. Wirkt erst nach einem Neustart." },
  { type: 69, name: "S/PDIF", help: "Einstellungen des Digitalempfängers." },
  { type: 79, name: "ES9038PRO", help: "Einstellungen des D/A-Wandlers ES9038PRO." },
  { type: 3, name: "Geräte-Sync", help: "Gleicht mehrere Forge in einer Kette ab." },
  { type: 48, name: "Logik", help: "Verknüpft Ereignisse logisch." },
  { type: 49, name: "Umschalter", help: "Gibt je nach Schalter-Ereignis einen von zwei Werten aus.",
    events: ["Wert bei „falsch“", "Wert bei „wahr“", "Schalter", ""], sets: ["Konstante bei „falsch“", "Konstante bei „wahr“", "", ""] },
  { type: 50, name: "Toggle", help: "Macht aus einem Tastendruck einen Ein/Aus-Schalter.", events: ["Taster-Ereignis", "", "", ""] },
  { type: 51, name: "Begrenzer", help: "Begrenzt einen Wert und rechnet den Eingangsbereich auf den Ausgangsbereich um." },
  { type: 52, name: "Vergleicher", help: "Vergleicht Ereignis 3 mit Ereignis 1, Ereignis 2 oder einer Konstante und gibt Ereignis 1 („falsch“) oder 2 („wahr“) aus.",
    events: ["Ausgabe bei „falsch“", "Ausgabe bei „wahr“", "Eingang", ""], sets: ["", "", "Konstante", ""] },
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
