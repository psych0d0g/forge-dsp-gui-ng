import { LineSplitter, type Transport } from "./types";

// The Forge firmware as WebAssembly (forge-dsp-firmware tools/sim): the real command interpreter,
// EEPROM and control blocks, without a device. The Pages build puts sim/forge-sim-<flavour>.mjs and
// sim/index.json next to the page.

/** what an emscripten module of tools/sim offers (host_iface.c, #ifdef SIM) */
export interface SimModule {
  _sim_eeprom(): number;
  _sim_at24(): number;
  _sim_boot(): number;
  _sim_loop(ms: number): void;
  _sim_output(): number;
  _sim_reset_pending(): number;
  ccall(name: string, ret: null, types: string[], args: unknown[]): void;
  UTF8ToString(ptr: number): string;
  HEAPU8: Uint8Array;
}

export const SIM_BASE = "./sim/";
export const EEPROM_SIZE = 4096;
export const AT24_SIZE = 65536;   // preset EEPROM
const LOOP_MS = 50;
const BOOT_MS = 3000;             // the firmware loads the preset in its main loop

/** where the EEPROM of a simulated flavour is kept between visits */
export interface SimStore { load(key: string): Uint8Array | null; save(key: string, data: Uint8Array): void }
export const browserStore: SimStore = {
  load(key) {
    try {
      const s = localStorage.getItem(key);
      return s ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : null;
    } catch { return null; }
  },
  save(key, data) {
    let bin = "";
    for (let i = 0; i < data.length; i += 8192) bin += String.fromCharCode(...data.subarray(i, i + 8192));
    try { localStorage.setItem(key, btoa(bin)); } catch { /* private mode or full: not kept */ }
  },
};

/** flavours with a simulator next to the page (sim/index.json: {"flavours": ["V40-96ELN", …]}) */
export async function simFlavours(base = SIM_BASE, get: typeof fetch = fetch): Promise<string[]> {
  try {
    const r = await get(`${base}index.json`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.flavours) ? j.flavours.filter((f: unknown) => typeof f === "string") : [];
  } catch { return []; }
}

/** a transport to a simulated Forge on an already loaded module */
export function simTransport(m: SimModule, flavour: string, store: SimStore = browserStore, loopMs = LOOP_MS): Transport {
  // the MCU EEPROM and the preset EEPROM (AT24) of this flavour, kept between visits
  const mems = [
    { key: `forge-sim-eeprom-${flavour}`, at: () => m._sim_eeprom(), size: EEPROM_SIZE },
    { key: `forge-sim-at24-${flavour}`, at: () => m._sim_at24(), size: AT24_SIZE },
  ];
  const view = (x: (typeof mems)[number]) => m.HEAPU8.subarray(x.at(), x.at() + x.size);
  for (const x of mems) {
    const saved = store.load(x.key);
    view(x).set(saved && saved.length === x.size ? saved : new Uint8Array(x.size).fill(0xff));
  }
  const save = () => mems.forEach((x) => store.save(x.key, view(x).slice()));
  const boot = () => {
    m._sim_boot();
    if (m._sim_reset_pending()) m._sim_boot();   // blank EEPROM: factory defaults, then the restart
    m._sim_loop(BOOT_MS);
    m._sim_output();                             // the start is not for the GUI
  };
  boot();
  const listeners: ((l: string) => void)[] = [];
  const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
  let dirty = false;
  const drain = () => {
    const out = m.UTF8ToString(m._sim_output());
    if (out) split.push(out);
    if (m._sim_reset_pending()) {      // system.boot, factory reset: the device restarts
      save();
      boot();
    }
  };
  const timer = setInterval(() => {
    m._sim_loop(loopMs);
    drain();
    if (dirty) { save(); dirty = false; }
  }, loopMs);
  return {
    name: `Simulator (${flavour})`,
    write: async (text) => {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        m.ccall("sim_command", null, ["string"], [line]);
        if (/^set\./.test(line)) dirty = true;
      }
      await Promise.resolve();        // answers arrive after write() returns, as on a real port
      drain();
    },
    onLine: (fn) => listeners.push(fn),
    close: async () => {
      clearInterval(timer);
      save();
    },
  };
}

/** load the module of a flavour from next to the page and connect */
export async function openSim(flavour: string, base = SIM_BASE): Promise<Transport> {
  const url = new URL(`${base}forge-sim-${flavour}.mjs`, location.href).href;
  const factory = (await import(/* @vite-ignore */ url)).default as (o: object) => Promise<SimModule>;
  const m = await factory({ print: () => undefined, printErr: () => undefined });   // harness debug lines
  return simTransport(m, flavour);
}

/** forget the simulated EEPROM (factory state on the next connect) */
export function simForget(flavour: string) {
  try {
    localStorage.removeItem(`forge-sim-eeprom-${flavour}`);
    localStorage.removeItem(`forge-sim-at24-${flavour}`);
  } catch { /* nothing kept */ }
}
