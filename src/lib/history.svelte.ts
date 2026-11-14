// Undo and redo for changes in this session (#24). A step is the whole tuning as register entries
// (stateToEntries, as in a .cfg file), taken when the writes have been quiet for a moment. Going
// back writes only the registers that differ from the step and reads them back from the device.
import { canonical, stateToEntries, type DeviceState } from "./device";

type Snap = Map<string, string>;
const MAX = 50;
const QUIET_MS = 800;
let steps: Snap[] = [];
let at = -1;
let timer: ReturnType<typeof setTimeout> | undefined;
let moving = false;

export const history = $state({ canUndo: false, canRedo: false, busy: false });

const snap = (d: DeviceState): Snap => new Map(stateToEntries(d).map(([r, v]) => [r, canonical(r, v)]));
const same = (a: Snap, b: Snap) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
function update() {
  history.canUndo = at > 0;
  history.canRedo = at >= 0 && at < steps.length - 1;
}

/** a new starting point: after reading the device, loading a preset, switching the device */
export function historyReset(d: DeviceState) {
  clearTimeout(timer);
  steps = [snap(d)];
  at = 0;
  update();
}

let current: () => DeviceState = () => { throw new Error("history not attached"); };
/** where the state lives (app.device); set once by the app */
export function historyAttach(get: () => DeviceState) { current = get; }

/** a write happened: the step is taken once the writes are quiet */
export function historyTouch() {
  if (moving || at < 0) return;
  clearTimeout(timer);
  timer = setTimeout(commit, QUIET_MS);
}
function commit() {
  clearTimeout(timer);
  timer = undefined;
  if (moving || at < 0) return;
  const s = snap(current());
  if (same(s, steps[at])) return;
  steps = steps.slice(0, at + 1);
  steps.push(s);
  if (steps.length > MAX) steps.shift();
  at = steps.length - 1;
  update();
}

/**
 * The registers to write to get from the state now to step `to`: values that differ, and names
 * that were empty there (an empty name is not an entry).
 */
export function stepDiff(now: Snap, to: Snap): [string, string][] {
  const out: [string, string][] = [];
  for (const [r, v] of to) if (now.get(r) !== v) out.push([r, v]);
  for (const r of now.keys()) if (!to.has(r) && r.startsWith("system.channel.name.")) out.push([r, '""']);
  // the profile last: its values are in place before it becomes active
  return out.sort(([a], [b]) => Number(a === "mixer.position") - Number(b === "mixer.position"));
}

export interface HistoryIo {
  /** write one register (value text as in a .cfg); "" = ok */
  writeRaw(reg: string, text: string): Promise<string>;
  /** the register is written: put the value into the state (or read it back) */
  applied(reg: string, text: string): Promise<unknown>;
  /** no write on its way */
  idle(): Promise<void>;
}

async function go(to: number, io: HistoryIo): Promise<string> {
  if (to < 0 || to >= steps.length || history.busy) return "";
  if (timer) commit();             // the last change becomes a step first
  history.busy = true;
  moving = true;
  try {
    await io.idle();
    const diff = stepDiff(snap(current()), steps[to]);
    let err = "";
    for (const [r, v] of diff) {
      const e = await io.writeRaw(r, v);
      if (e) err = e; else await io.applied(r, v);
    }
    at = to;
    return err;
  } finally {
    moving = false;
    history.busy = false;
    update();
  }
}
export const undo = (io: HistoryIo) => go((timer ? (commit(), at) : at) - 1, io);
export const redo = (io: HistoryIo) => go(at + 1, io);
