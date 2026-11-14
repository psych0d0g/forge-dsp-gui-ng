// MODC control blocks: modc.N = [enable, type, flags(4 bytes), event 1..4, sets(4 bytes)].
// Names and help follow the dialogs of the original GUI; field meanings are given only where the
// firmware sources document them (forge-dsp-firmware src/modc.c, docs/port-changes.md).
import type { DeviceState, Modc } from "./model";
import { t, tk, tx } from "../i18n/index.svelte";

/** One input of a block's dialog; indices are 1-based as in the firmware (event 1..4, set 1..4, flags 1..4). */
export type Field =
  | { kind: "event"; i: number; label: string }
  /** one byte, optionally shown scaled (value * mul, e.g. steps of 250 ms as seconds) */
  | { kind: "byte"; of: "sets" | "flags"; i: number; label: string; mul?: number; unit?: string; hint?: string }
  /** 16 bits over two bytes, low byte at i; div: shown as value / div */
  | { kind: "word"; of: "sets"; i: number; label: string; signed?: boolean; div?: number; unit?: string; min?: number; max?: number; hint?: string }
  /** a value from a list; shift/width: only these bits of the byte (the others stay), first: value of options[0] */
  | { kind: "choice"; of: "sets" | "flags"; i: number; label: string; options: string[]; first?: number; shift?: number; width?: number; hint?: string }
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
const OUTS = [tk("modc.output1"), tk("modc.output2"), tk("modc.output3"), tk("modc.output4"), tk("modc.output5"), tk("modc.output6"), tk("modc.output7"), tk("modc.output8")];
const PAIRS = [tk("modc.output12"), tk("modc.output34"), tk("modc.output56"), tk("modc.output78")];
/** conversion curves of the value sources (flags 1, bits 3..7) */
const CURVE_BITS = [tk("modc.log10"), tk("modc.invLog10"), tk("modc.alog10"), tk("modc.invAlog10"), tk("modc.invert")];
const CURVE: Field = { kind: "bits", of: "flags", i: 1, label: tk("modc.curve"), bits: ["", "", "", ...CURVE_BITS] };
const RANGE_OUT: Field[] = [set(3, tk("modc.outputMax")), set(4, tk("modc.outputMin"))];

export const MODC_TYPES: ModcType[] = [
  { type: 16, name: tk("modc.volume"), help: tk("modc.setsOutputLevelsFrom"),
    fields: [
      { kind: "bits", of: "flags", i: 1, label: tk("modc.active"), bits: OUTS },
      ev(1, tk("modc.volumeOddOutputs1")), ev(2, tk("modc.volumeEvenOutputs2")),
      ev(3, tk("modc.correctionCentre16")), { kind: "bits", of: "sets", i: 3, label: tk("modc.correctionActs"), bits: OUTS },
      ev(4, tk("modc.balanceCentre64")), { kind: "bits", of: "sets", i: 4, label: tk("modc.balanceActs"), bits: OUTS },
    ] },
  { type: 17, name: tk("modc.potentiometer"), help: tk("modc.potentiometerControlPortPin"),
    fields: [
      set(1, tk("modc.potMax")), set(2, tk("modc.potMin")), set(3, tk("modc.outputMax")),
      // flags 1 holds the input (bit 0) and the curve (bits 3..7)
      { kind: "bits", of: "flags", i: 1, label: tk("modc.inputCurve"), bits: [tk("modc.pot2Pin5"), "", "", ...CURVE_BITS] },
    ] },
  { type: 82, name: tk("modc.rotaryEncoder"), help: tk("modc.rotaryEncoderControlPort"),
    fields: [set(1, tk("modc.startValue")), set(2, tk("modc.factor")), ...RANGE_OUT, CURVE] },
  { type: 86, name: tk("modc.irRemoteControl"), help: tk("modc.infraredReceiverRJ45Port"),
    fields: [set(1, tk("modc.startValue")), set(2, tk("modc.factor")), ...RANGE_OUT, CURVE,
      { kind: "bits", of: "flags", i: 2, label: tk("modc.mode"), bits: [tk("modc.ownCodesCustom")] }] },
  { type: 84, name: tk("modc.mute"), help: tk("modc.mutesChosenOutputsWhile"),
    fields: [ev(1, tk("modc.trigger")), { kind: "bits", of: "flags", i: 1, label: tk("modc.mute2"), bits: OUTS }] },
  { type: 108, name: tk("modc.loudness"), help: tk("modc.raisesBassTrebleQuieter"),
    fields: [
      { kind: "bits", of: "flags", i: 1, label: tk("modc.active"), bits: [...PAIRS, tk("modc.sumAB")] },
      ev(1, tk("modc.volumeSourceNoneDigital")),
      { kind: "word", of: "sets", i: 1, label: tk("modc.bassFrequency"), unit: "Hz", hint: tk("modc.n0100Hz") },
      { kind: "byte", of: "flags", i: 3, label: tk("modc.bassBoostPerDB"), mul: 0.01, unit: "dB", hint: "0 = 0,40" },
      { kind: "word", of: "sets", i: 3, label: tk("modc.trebleFrequency"), unit: "Hz", hint: tk("modc.n010000Hz") },
      { kind: "byte", of: "flags", i: 4, label: tk("modc.trebleBoostPerDB"), mul: 0.01, unit: "dB", hint: "0 = 0,15" },
      { kind: "byte", of: "flags", i: 2, label: tk("modc.reference2230DB"), hint: "0 = 223" },
    ] },
  { type: 106, name: tk("modc.mono"), help: tk("modc.switchesOutputPairsMono"),
    fields: [
      { kind: "bits", of: "flags", i: 1, label: tk("modc.active"), bits: PAIRS },
      { kind: "choice", of: "sets", i: 1, label: tk("modc.mode"), first: 1, options: [tk("modc.stereo"), tk("modc.monoRight"), tk("modc.monoLeft"), tk("modc.stereoMonoLR")] },
      ev(1, tk("modc.offByEventNone")),
    ] },
  { type: 109, name: tk("modc.analogMixer"), help: tk("modc.shareThreeAnalogInputs"),
    fields: [set(1, tk("modc.input1"), { unit: "%" }), set(2, tk("modc.input2"), { unit: "%" }), set(3, tk("modc.input3"), { unit: "%" })] },
  { type: 96, name: tk("modc.inputSwitcher"), help: tk("modc.selectsDigitalSourceAutomatically"),
    fields: [
      { kind: "bits", of: "flags", i: 1, label: tk("modc.active"), bits: [tk("modc.profile1"), "", tk("modc.profile2"), "", tk("modc.profile3"), "", tk("modc.profile4")] },
      set(1, tk("modc.sourceWithoutActiveEvent")),
      ev(2, tk("modc.event2")), set(2, tk("modc.switchesSource")), ev(3, tk("modc.event3")), set(3, tk("modc.switchesSource")),
      ev(4, tk("modc.event4HighestPriority")), set(4, tk("modc.switchesSource")),
    ] },
  { type: 97, name: tk("modc.mixerProfileSwitcher"), help: tk("modc.switchesMixerProfilesAutomatically"),
    fields: [ev(1, tk("modc.event1Fallback")), ev(2, tk("modc.event2")), ev(3, tk("modc.event3")), ev(4, tk("modc.event4HighestPriority"))] },
  { type: 66, name: tk("modc.presetSwitcher"), help: tk("modc.selectsPresetFromUp"),
    fields: [ev(1, tk("modc.bit0")), ev(2, tk("modc.bit1")), ev(3, tk("modc.bit2"))] },
  { type: 193, name: tk("modc.powerOff"), help: tk("modc.delaysWhenSwitchingOff"),
    fields: [
      set(1, tk("modc.startupPauseBeforeRemote"), { mul: 0.25, unit: "s" }),
      set(3, tk("modc.remoteoutPauseAfterSwitching"), { mul: 0.25, unit: "s" }),
      set(4, tk("modc.shutdownPauseBeforeForge"), { mul: 0.25, unit: "s" }),
      set(2, tk("modc.switchOffOnlyWhen"), { mul: 0.05, unit: "s", hint: tk("modc.approximately") }),
      ev(1, tk("modc.triggerShutdownEvent")),
    ] },
  { type: 68, name: tk("modc.mainClock"), help: tk("modc.correctsManufacturingToleranceCrystal"),
    fields: [
      { kind: "word", of: "sets", i: 1, label: tk("modc.tcxoCorrection"), signed: true, div: 10, unit: "Hz", min: -1000, max: 1000 },
      { kind: "choice", of: "sets", i: 3, label: tk("modc.daConverterClockRate"),
        options: [tk("modc.n49152MHz"), tk("modc.n50000MHz"), tk("modc.n60000MHz"), tk("modc.n70000MHz"), tk("modc.n73728MHz"), tk("modc.n80000MHz"), tk("modc.n90000MHz"), tk("modc.n98394MHz"), tk("modc.n100000MHz")] },
    ] },
  // firmware: modc_spdif -> ERAM CT7302_REGISTER_OPTIONS, read by ct7302.c at the start (only CT7302 boards)
  { type: 69, name: tk("modc.sPDIF"), help: tk("modc.optionsCT7302DigitalReceiver"),
    fields: [{ kind: "bits", of: "flags", i: 1, label: tk("modc.options"), bits: [tk("modc.n192KHzCoaxOptical"), "", "", "", "", "", "", tk("modc.sPDIFReception32")] }] },
  // firmware: modc_ess9038pro -> set 1 = register 7 of the DAC; es90x8pro.c writes it masked with 0xE6
  // (bits 7..5 filter shape, bits 2..1 IIR bandwidth; ES9038PRO data sheet, register 7)
  { type: 79, name: tk("modc.es9038pro"), help: tk("modc.digitalFilterES9038PRO"),
    fields: [
      { kind: "choice", of: "sets", i: 1, shift: 5, width: 3, label: tk("modc.filterShape"), options: [tk("modc.fastLinearPhase"), tk("modc.slowLinearPhase"),
        tk("modc.fastMinimumPhase"), tk("modc.slowMinimumPhase"), tk("modc.apodizingFastLinearPhase"), tk("modc.variant5"), tk("modc.hybridFastMinimumPhase"), tk("modc.brickWall")] },
      { kind: "choice", of: "sets", i: 1, shift: 1, width: 2, label: tk("modc.iirBandwidth"), options: [tk("modc.n10757Fs47"), tk("modc.n11338Fs50"), tk("modc.n13605Fs60"), tk("modc.n15873Fs70")] },
    ] },
  // firmware: modc_device_sync sends "event.block.<flags 1 & 3 + 1>=[ev1,ev2,ev3,ev4]" to the slave port
  { type: 3, name: tk("modc.deviceSync"), help: tk("modc.passesUpFourEvent"),
    fields: [
      { kind: "choice", of: "flags", i: 1, shift: 0, width: 2, label: tk("modc.targetNextForge"), options: [tk("modc.eventBlock1"), tk("modc.eventBlock2"), tk("modc.eventBlock3"), tk("modc.eventBlock4")] },
      ev(1, tk("modc.value1")), ev(2, tk("modc.value2")), ev(3, tk("modc.value3")), ev(4, tk("modc.value4")),
    ] },
  { type: 48, name: tk("modc.logic"), help: tk("modc.combinesUpFourEvents"),
    fields: [
      ev(1, tk("modc.input1")), ev(2, tk("modc.input2")), ev(3, tk("modc.input3")), ev(4, tk("modc.input4")),
      { kind: "bits", of: "flags", i: 1, label: tk("modc.combination"), bits: [tk("modc.invertInput1"), tk("modc.invertInput2"), tk("modc.invertInput3"),
        tk("modc.invertInput4"), tk("modc.mask1XORInstead"), tk("modc.mask2XORInstead"), tk("modc.mask3XORInstead"), tk("modc.mask4XORInstead")] },
      set(1, tk("modc.mask1BitsInputs")), set(2, tk("modc.mask2")), set(3, tk("modc.mask3")), set(4, tk("modc.mask4")),
    ] },
  { type: 49, name: tk("modc.switch"), help: tk("modc.outputsOneTwoValues"),
    fields: [ev(3, tk("modc.switch2")), ev(1, tk("modc.valueWhenFalse")), set(1, tk("modc.constantWhenFalse")), ev(2, tk("modc.valueWhenTrue")), set(2, tk("modc.constantWhenTrue")),
      { kind: "bits", of: "flags", i: 1, label: tk("modc.constantInsteadEvent"), bits: [tk("modc.whenFalse"), tk("modc.whenTrue")] }] },
  { type: 50, name: tk("modc.toggle"), help: tk("modc.turnsButtonPressInto"), fields: [ev(1, tk("modc.buttonEvent"))] },
  { type: 51, name: tk("modc.limiter"), help: tk("modc.limitsValueInputMin"),
    fields: [ev(1, tk("modc.input")), set(1, tk("modc.inputMax")), set(2, tk("modc.inputMin")), ...RANGE_OUT,
      { kind: "bits", of: "flags", i: 1, label: tk("modc.curve"), bits: ["", "", "", "", "", "", "", tk("modc.invert")] }] },
  { type: 52, name: tk("modc.comparator"), help: tk("modc.comparesInputEvent3"),
    fields: [ev(3, tk("modc.input")), ev(1, tk("modc.outputWhenFalseComparison")), ev(2, tk("modc.outputWhenTrueComparison")), set(3, tk("modc.constant")),
      { kind: "bits", of: "flags", i: 1, label: tk("modc.condition"), bits: [tk("modc.inputEvent1"), tk("modc.inputEvent12"), tk("modc.inputEvent2"),
        tk("modc.inputEvent22"), tk("modc.inputConstant"), tk("modc.inputConstant2")] }] },
  // firmware: modc_calculator. Start: event 1 or set 1 (flags 2 bit 5); steps 2..4: flags k bit 7 = on
  // (step 2 always), bit 6 = set k instead of event k, bits 0..3 = × ÷ + − (several: in this order).
  // 16-bit arithmetic, the output is the low byte; ÷ 0 gives 255.
  { type: 53, name: tk("modc.calculator"), help: tk("modc.computesValueFromUp"),
    fields: [
      ev(1, tk("modc.startEvent")), set(1, tk("modc.startConstant")),
      { kind: "bits", of: "flags", i: 2, label: tk("modc.step2AlwaysActive"), bits: [tk("modc.times"), tk("modc.dividedBy"), tk("modc.plus"), tk("modc.minus"), "", tk("modc.startConstant2"), tk("modc.constantInsteadEvent")] },
      ev(2, tk("modc.step2Event")), set(2, tk("modc.step2Constant")),
      { kind: "bits", of: "flags", i: 3, label: tk("modc.step3"), bits: [tk("modc.times"), tk("modc.dividedBy"), tk("modc.plus"), tk("modc.minus"), "", "", tk("modc.constantInsteadEvent"), tk("common.active")] },
      ev(3, tk("modc.step3Event")), set(3, tk("modc.step3Constant")),
      { kind: "bits", of: "flags", i: 4, label: tk("modc.step4"), bits: [tk("modc.times"), tk("modc.dividedBy"), tk("modc.plus"), tk("modc.minus"), "", "", tk("modc.constantInsteadEvent"), tk("common.active")] },
      ev(4, tk("modc.step4Event")), set(4, tk("modc.step4Constant")),
    ] },
];
export const modcType = (t: number) => MODC_TYPES.find((x) => x.type === t);
export const modcName = (ty: number) => (ty === 0 ? t("modc.empty") : modcType(ty) ? tx(modcType(ty)!.name) : t("common.typeN", { n: ty }));
export const emptyModc = (): Modc => ({ enable: 0, type: 0, flags: [0, 0, 0, 0], events: [0, 0, 0, 0], sets: [0, 0, 0, 0] });

/** value text of modc.N as the firmware expects it */
export const modcText = (m: Modc) =>
  `[${m.enable},${m.type},${m.flags.map(hx).join("")},${m.events.join(",")},${m.sets.map(hx).join("")}]`;
const hx = (b: number) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

/**
 * The writes that take block n from `before` to `after`. The last block (the start-up and shutdown
 * delays) is fixed in the firmware: modc.N=[…] is refused there, only its events, flags and sets can
 * be written one by one (modc.N.sets.K). The other blocks are written whole.
 */
export function modcWrites(n: number, total: number, before: Modc, after: Modc): [string, string][] {
  if (n !== total) return modcText(before) === modcText(after) ? [] : [[`modc.${n}`, modcText(after)]];
  const out: [string, string][] = [];
  for (const of of ["events", "flags", "sets"] as const)
    after[of].forEach((v, i) => { if (v !== before[of][i]) out.push([`modc.${n}.${of}.${i + 1}`, String(v & 0xff)]); });
  return out;
}
export const copyModc = (m: Modc): Modc => ({ ...m, flags: [...m.flags], events: [...m.events], sets: [...m.sets] });

/**
 * Blocks about a chip only make sense when the device has it (#26). The firmware reports the chips it
 * found in system.feature.attributes.hw = [.., found other]; the bits depend on the build:
 * CT7302 (S/PDIF receiver) on bits 3/4 in every build but the 96LN, ES90x8PRO on bit 2 only in the
 * 96ELN-3 build (forge-dsp-firmware flavour.h). Without the report the model decides alone.
 */
export function deviceHasChip(s: DeviceState, type: number): boolean {
  const hw = s.features.hw, other = Array.isArray(hw) && typeof hw[5] === "number" ? hw[5] : null;
  const found = (mask: number) => other === null || (other & mask) !== 0;
  if (type === 69) return s.identity.model !== "96LN" && found(0x18);
  if (type === 79) return s.identity.model === "96ELN3" && found(0x04);
  return true;
}

/** types the page of the device settings shows in words (#26): main clock, S/PDIF, ES9038PRO */
export const DEVICE_TYPES = [68, 69, 79];

/** block n is on the page of the device settings: the last one (on/off) and the hardware blocks
 * of chips the device has; the page of the control blocks leaves them out */
export function onDevicePage(s: DeviceState, n: number): boolean {
  const total = s.identity.modcBlocks || 32, m = s.modc[n];
  return n === total || (!!m && DEVICE_TYPES.includes(m.type) && deviceHasChip(s, m.type));
}

/** types this device can run (the firmware reports a version per type, 0 = not available) */
export function availableTypes(s: DeviceState): ModcType[] {
  const known = s.modcVersions.length > 0;
  return MODC_TYPES.filter((t) => !known || (s.modcVersions[t.type & 0x3f] ?? 0) > 0);
}

/** events a block can listen to: fixed ones of the firmware, and the output of each block (96 + N) */
const EVENTS: [number, string][] = [
  [1, tk("modc.alwaysOff")], [2, tk("modc.always")], [3, tk("modc.remoteOut")], [4, tk("modc.shutdown")], [5, tk("modc.preset")], [6, tk("modc.usbConnected")],
  [9, tk("modc.overloadAD")], [10, tk("modc.overloadDA")], [11, tk("modc.groundSwitch1")], [12, tk("modc.groundSwitch2")], [13, tk("modc.groundSwitch3")],
  [42, tk("modc.outputsMuted")], [44, tk("modc.sourceSelection")], [58, tk("modc.irVolume")], [59, tk("modc.irBalance")], [60, tk("modc.irBass")], [61, tk("modc.irMute")],
  [62, tk("modc.irSwitch1")], [63, tk("modc.irSwitch2")], [64, tk("modc.irSwitch3")],
];
export function eventOptions(blocks: number): { value: number; label: string }[] {
  return [{ value: 0, label: "–" }, ...EVENTS.map(([value, label]) => ({ value, label: `${value}: ${tx(label)}` })),
    ...Array.from({ length: blocks }, (_, i) => ({ value: 97 + i, label: `${97 + i}: ${t("modc.outputBlockN", { n: i + 1 })}` }))];
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

/** the value of a choice field (only its bits), and the byte with a new value in them */
export function choiceGet(byte: number, f: { shift?: number; width?: number }): number {
  return (byte >> (f.shift ?? 0)) & ((1 << (f.width ?? 8)) - 1);
}
export function choiceSet(byte: number, f: { shift?: number; width?: number }, v: number): number {
  const sh = f.shift ?? 0, mask = ((1 << (f.width ?? 8)) - 1) << sh;
  return ((byte & ~mask) | ((v << sh) & mask)) & 0xff;
}
