import type { ForgeClient } from "../protocol/client";
import type { Answer } from "../protocol/answer";
import { applyAnswer, emptyState, type DeviceState } from "./model";

export interface ReadProgress {
  done: number;
  total: number;
  /** register being read */
  current: string;
}

/** read once after connecting; `port` = only the C port answers these */
const STEPS: { reg: string; port?: boolean; slow?: boolean }[] = [
  { reg: "system.key.info" },
  { reg: "system.firmware" },
  { reg: "system.firmware.port", port: true },
  { reg: "system.info" },
  { reg: "system.key.info.list", port: true },
  { reg: "system.feature.attributes" },
  { reg: "system.limits", port: true },
  { reg: "system.gui.panes" },
  { reg: "gain.out.scale" },
  { reg: "gain.in.scale" },
  { reg: "gain.spdif.scale" },
  { reg: "mixer.scale" },
  { reg: "gain.out" },
  { reg: "gain.in" },
  { reg: "gain.spdif" },
  { reg: "mute.out" },
  { reg: "phase.out" },
  { reg: "delay" },
  { reg: "delay.in" },
  { reg: "mixer.position" },
  { reg: "mixer.in", port: true },
  { reg: "mixer.in.max", port: true },
  { reg: "preset.loaded" },
  { reg: "preset.select" },
  { reg: "system.channel.name.*" },
  { reg: "system.channel.in.*", port: true },
  { reg: "system.errors" },
  { reg: "system.temperature.celsius" },
  { reg: "biquad.clickless", port: true },
  { reg: "system.supply", port: true },
  { reg: "system.vu", port: true },
  { reg: "system.vu.out", port: true },
  { reg: "modc.version.attributes" },
  { reg: "modc.*" },
  { reg: "mixer.*", slow: true },
  { reg: "system.biquads", port: true },
  { reg: "biquad.*", slow: true },
];

/** lists whose entries are read one by one: system.feature.attributes=["fr","hw"] -> ….fr, ….hw */
const SUBLISTS = ["system.feature.attributes", "system.gui.panes", "modc.version.attributes", "system.limits"];

/**
 * Reads the complete state of one device. The protocol is slow (38400 Bd, the mixer and biquad
 * lists take seconds), so this runs once; afterwards `applyAnswer` keeps the state current.
 * Registers the firmware does not know are skipped.
 */
export async function readDevice(
  client: ForgeClient,
  onProgress: (p: ReadProgress) => void = () => {},
): Promise<DeviceState> {
  const state = emptyState();
  const steps = [...STEPS];
  for (let i = 0; i < steps.length; i++) {
    const { reg, port } = steps[i];
    onProgress({ done: i, total: steps.length, current: reg });
    // original firmware (answered system.firmware, but not system.firmware.port): not asked
    if (port && reg !== "system.firmware.port" && state.identity.port === null) continue;
    let answers: Answer[];
    try {
      answers = await client.get(reg);
    } catch {
      continue;  // no answer: optional register
    }
    for (const a of answers) {
      applyAnswer(state, a);
      if (a.kind === "get" && SUBLISTS.includes(a.register) && Array.isArray(a.value))
        for (const name of a.value) steps.splice(i + 1, 0, { reg: `${a.register}.${name}` });
    }
  }
  onProgress({ done: steps.length, total: steps.length, current: "" });
  return state;
}

/** state as a file: readable JSON with a format version */
export function exportState(state: DeviceState): string {
  return JSON.stringify({ format: "forge-dsp-gui-ng/state", version: 1, state }, null, 1);
}

/** values that change on their own: read again from time to time (`port` as above) */
export const STATUS_REGS: { reg: string; port?: boolean }[] = [
  { reg: "system.temperature.celsius" }, { reg: "system.errors" }, { reg: "system.supply", port: true },
];
