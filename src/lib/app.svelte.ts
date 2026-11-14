// Application state (Svelte 5 runes): connection, device model, log, navigation.
import { ForgeClient, parseValue, type Answer, type Value } from "./protocol";
import type { ByteLink, Transport } from "./transport/types";
import { grantedPort, openWebSerial } from "./transport/webserial";
import { APP_SIZE, Bootloader, EEPROM_SIZE } from "./boot/client";
import { identifyFlash, type FlashId } from "./boot/identify";
import { deviceError, explain } from "./errors";
import { autoPort, openNativeSerial, portsNative, type PortInfo } from "./transport/native";
import { isNative } from "./native";
import { openSim, simFlavours } from "./transport/sim";
import { openWebSocket } from "./transport/websocket";
import { t } from "./i18n/index.svelte";
import { history, historyAttach, historyReset, historyTouch, redo, undo, type HistoryIo } from "./history.svelte";
import { applyAnswer, emptyState, inputDefaultName, inputShortName, isPort, parseKeyInfo, masterOf, readDevice, STATUS_REGS, type DeviceState, type ReadProgress,
  type SdLink } from "./device";
import { DemoTransport, demoState } from "./device/demo";
import { stateToEntries, toCfg } from "./device/tuning";
import { saveFile } from "./saveFile";

/** in the bootloader (#17): the flash and EEPROM are read once on connecting (backup and identification) */
export interface BootState {
  version: string;
  /** reading: bytes done of total; null when finished */
  read: { done: number; total: number } | null;
  flash: Uint8Array | null;
  eeprom: Uint8Array | null;
  id: FlashId | null;
  error: string;
  /** "MODEL-PCB" to check after the update: from the firmware before, or from an original image;
   *  "" for a port image (its EEPROM keeps the identity it took) */
  identity: string;
}

export type PageId = "overview" | "mixer" | "filters" | "delay" | "modc" | "presets" | "biquads"
  | "diagnose" | "firmware" | "console" | "sdcard" | "settings";

export const app = $state({
  page: "overview" as PageId,
  status: "offline" as "offline" | "connecting" | "reading" | "online",
  transportName: "",
  demo: false,
  error: "",
  progress: null as ReadProgress | null,
  device: emptyState() as DeviceState,
  log: [] as { dir: "rx" | "tx"; text: string }[],
  /** registers with a write on its way */
  writing: 0,
  /** the port is in use for something else (firmware update): no status reads */
  exclusive: false,
  /** connected to the bootloader instead of a firmware (#17): only the firmware page works */
  bootloader: null as null | BootState,
  /** waiting for the Forge to come back in its bootloader (first update from the original firmware) */
  bootWait: false,
  /** the devices of the RS485 chain (#15): 1 = the one at this port; and the one shown */
  chain: [] as { n: number; model: string }[],
  target: 1,
});

let transport: Transport | null = null;
let client: ForgeClient | null = null;

function attach(t: Transport) {
  transport = t;
  client = new ForgeClient(t);
  usbBaud = 38400;
  client.onRaw((text, dir) => {
    if (dir === "tx") lastTx = Date.now();
    if (sdBusy || isPollLine(text)) return;  // status reads and file blocks would flood the console
    app.log.push({ dir, text: text.trimEnd() });
    if (app.log.length > 400) app.log.splice(0, app.log.length - 400);
  });
  // events, lines without a request; those of other devices in the chain belong to them
  client.onAnswer((a) => {
    if (a.device !== (client?.target ?? 1)) return;
    applyAnswer(app.device, a);
    if (a.kind === "event" && a.register === "preset.loaded") presetLoaded();
  });
  app.transportName = t.name;
}

// --- USB: Web Serial in the browser, the app's own serial port in the desktop app ----------------------
/** port choice of the desktop app, shown by App.svelte (PortPicker) */
export const portChoice = $state<{ ports: PortInfo[] | null; resolve: ((p: PortInfo | null) => void) | null }>({ ports: null, resolve: null });
export async function refreshPorts() { if (portChoice.resolve) portChoice.ports = await portsNative(); }
async function openUsb() {
  if (!isNative()) return openWebSerial();
  const ports = await portsNative();
  let p = autoPort(ports);
  if (!p) {
    p = await new Promise<PortInfo | null>((resolve) => { portChoice.ports = ports; portChoice.resolve = resolve; });
    portChoice.ports = null; portChoice.resolve = null;
  }
  if (!p) throw new Error(t("common.noPortChosen"));
  return openNativeSerial(p.name);
}
/** USB is possible: Web Serial in the browser, always in the desktop app */
export const usbAvailable = () => isNative() || (typeof navigator !== "undefined" && "serial" in navigator);

/** flavours of the simulator next to the page (tools/sim of the firmware), see App.svelte */
export const sim = $state<{ flavours: string[]; flavour: string }>({ flavours: [], flavour: "" });
export async function findSim() {
  sim.flavours = await simFlavours();
  sim.flavour = sim.flavours.includes(sim.flavour) ? sim.flavour : (sim.flavours.find((f) => f === "V40-96ELN") ?? sim.flavours[0] ?? "");
}

export async function connect(kind: "usb" | "esp" | "demo" | "sim") {
  app.error = "";
  app.status = "connecting";
  try {
    if (kind === "demo") {
      attach(new DemoTransport());
      app.device = demoState();
      app.demo = true;
    } else {
      const tr = kind === "usb" ? await openUsb() : kind === "sim" ? await openSim(sim.flavour) : await openWebSocket();
      attach(tr);
      app.demo = false;
      if (kind === "usb") {
        // the bootloader instead of a firmware: still talking to it from before, or waiting at its start
        let bl = await findBootloader(tr, 0);
        if (!bl) {
          await tr.write("\r\n");                       // end what the probe left in the line buffer
          if (!(await firmwareAnswers())) bl = await findBootloader(tr, 3000);
          if (!bl && !(await firmwareAnswers())) throw new Error(t("app.noForgeAnswers"));
        }
        if (bl) {
          await bootloaderMode(bl);
          return;
        }
        await usbFast();
      }
      app.status = "reading";
      app.device = await readDevice(client!, (p) => (app.progress = p));
      await readMaster();
      app.progress = null;
      if (!app.device.identity.keyInfo && !app.device.identity.firmware) throw new Error(t("app.noForgeAnswers"));
    }
    loadInNames();
    app.status = "online";
    historyReset(app.device);
    await findChain();
  } catch (e) {
    app.error = explain(e);
    await disconnect();
  }
}

export async function disconnect() {
  await usbSlow().catch(() => undefined);   // the original GUI finds it at 38400 at once
  await transport?.close().catch(() => undefined);
  transport = null;
  client = null;
  app.bootloader = null;
  app.chain = [];
  app.target = 1;
  app.status = "offline";
  app.progress = null;
  app.demo = false;
  app.transportName = "";
  app.device = emptyState();
}

export async function reload() {
  if (!client || app.demo) return;
  app.bootloader = null;   // a firmware runs again (after an update)
  app.status = "reading";
  app.device = await readDevice(client, (p) => (app.progress = p));
  await readMaster();
  app.progress = null;
  app.status = "online";
  historyReset(app.device);
}

// --- preset changes (forge-dsp-firmware#66) --------------------------------------------------------
// The Forge sends "#.1 preset.loaded=N" when a preset is completely loaded (sound back on). The GUI
// waits for it after its own change, and reads everything again after a change on the device
// (rotary encoder, remote, control block) as well.
let presetWait: (() => void) | null = null;
function presetLoaded() {
  if (presetWait) { presetWait(); return; }
  if (app.status === "online" && !app.exclusive && !app.demo) void reload().catch((e) => (app.error = explain(e)));
}
/** load preset n (0-based): no status reads meanwhile (the Forge does not answer while loading) */
export async function loadPreset(n: number): Promise<string> {
  if (!client) return t("common.notConnected");
  app.exclusive = true;
  try {
    const done = new Promise<void>((r) => { presetWait = r; setTimeout(r, 30000); });   // older firmware: no event
    const err = await writeOnce("preset.loaded", n);
    if (err) return err;
    if (!app.demo) await done;
  } finally {
    presetWait = null;
    app.exclusive = false;
  }
  if (!app.demo) await reload();
  return "";
}

// --- outputs from the keyboard (#24) ---------------------------------------------------------------
/** mute or polarity of output ch on/off */
export function toggleOut(kind: "mute" | "phase", ch: number) {
  const d = app.device;
  if (app.status !== "online" || app.bootloader || ch < 1 || ch > d.mute.length) return;
  const v = d[kind][ch - 1] ? 0 : 1;
  d[kind][ch - 1] = v;
  write(`${kind}.out.${ch}`, v);
}
let mutedBefore: number[] | null = null;
/** all outputs muted; once more: the mutes as they were before */
export function muteAll() {
  const d = app.device;
  if (app.status !== "online" || app.bootloader || !d.mute.length) return;
  const all = d.mute.every((m) => m);
  const want = all && mutedBefore ? mutedBefore : all ? d.mute.map(() => 0) : d.mute.map(() => 1);
  if (!all) mutedBefore = [...d.mute];
  want.forEach((v, i) => { if (d.mute[i] !== v) { d.mute[i] = v; write(`mute.out.${i + 1}`, v); } });
}
/** the loaded preset as a tuning file (.cfg of the original GUI) */
export function saveTuningFile() {
  const d = app.device, loaded = d.preset.loaded;
  const cfg = toCfg(d.identity.model, stateToEntries(d), [
    `Forge DSP ${d.identity.model}, Preset ${loaded !== null ? loaded + 1 : "?"}, ${new Date().toISOString().slice(0, 16)}`,
    `forge-dsp-gui-ng ${__APP_VERSION__} (${__APP_COMMIT__})`]);
  saveFile(cfg, `forge-${d.identity.model}-preset${loaded !== null ? loaded + 1 : ""}-${new Date().toISOString().slice(0, 10)}.cfg`, "text/plain");
}

// --- undo / redo (#24) ----------------------------------------------------------------------------
historyAttach(() => app.device);
export { history };
const historyIo: HistoryIo = {
  writeRaw,
  async applied(reg, text) {
    // the control blocks read back (hex fields in the text); everything else as written
    if (reg.startsWith("modc.") && !app.demo) return query(reg);
    try { applyAnswer(app.device, { kind: "get", device: 1, register: reg.replace(/\.calc$/, ""), value: parseValue(text), raw: "" }); }
    catch { await query(reg.replace(/\.calc$/, "")); }
  },
  async idle() { while (app.writing > 0) await new Promise((r) => setTimeout(r, 50)); },
};
export async function undoChange() { const e = await undo(historyIo); if (e) app.error = e; }
export async function redoChange() { const e = await redo(historyIo); if (e) app.error = e; }

// --- faster USB-COM (forge-dsp-firmware#62) -------------------------------------------------------
/** the port firmware switches its USB-COM up to 460800 Bd on request (not stored: 38400 again after
 *  a restart or 30 s without a line); the original firmware answers "unknown command" */
export const USB_FAST = 460800;
let usbBaud = 38400;
let lastTx = 0;
export async function usbFast() {
  const tr = transport, c = client;
  if (!tr?.setBaud || !c || usbBaud === USB_FAST) return;
  const ok = (await c.set("system.baud.usb", USB_FAST / 1200, { timeoutMs: 1000 }).catch(() => [])).some((a) => a.kind === "info");
  if (!ok) return;
  await new Promise((r) => setTimeout(r, 30));   // the answer has left, the Forge switches
  await tr.setBaud(USB_FAST);
  usbBaud = USB_FAST;
  if ((await c.get("system.ping", { timeoutMs: 800 }).catch(() => [])).some((a) => a.kind === "get")) {
    c.quietMs = 100;   // lines of a wildcard answer come some ms apart at this rate (#21)
    return;
  }
  // no answer at the fast rate: back (the Forge falls back by itself after 30 s at the latest)
  await tr.setBaud(38400);
  usbBaud = 38400;
}
/** back to 38400 (before a firmware update: the bootloader measures the rate itself) */
export async function usbSlow() {
  const tr = transport, c = client;
  if (!tr?.setBaud || !c || usbBaud === 38400) return;
  c.quietMs = 200;
  await c.set("system.baud.usb", 32, { timeoutMs: 600 }).catch(() => []);
  await new Promise((r) => setTimeout(r, 30));
  await tr.setBaud(38400);
  usbBaud = 38400;
}
/** after the Forge restarted by itself (backup restored, …): it comes back at 38400; read it again */
export async function afterRestart() {
  const tr = transport, c = client;
  if (!tr || !c || app.demo) return;
  app.status = "reading";
  if (usbBaud !== 38400 && tr.setBaud) { await tr.setBaud(38400); usbBaud = 38400; c.quietMs = 200; }
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 40 && !(await firmwareAnswers()); i++) await new Promise((r) => setTimeout(r, 1000));
  try {
    await usbFast();
    await reload();
    loadInNames();
  } catch (e) {
    app.error = explain(e);
    app.status = "online";
  }
}

// keep the fast rate: a line at least every 10 s, also while the tab is hidden (no status reads then)
if (typeof window !== "undefined") setInterval(() => {
  if (usbBaud !== 38400 && client && !app.exclusive && Date.now() - lastTx > 10000) client.get("system.ping").catch(() => []);
}, 2000);

// --- devices in the RS485 chain (#15) ------------------------------------------------------------
/** further Forge behind the slave port answer as .2, .3, … (firmware cmd_route.c); 1 is this one */
const CHAIN_MAX = 6;
export async function findChain() {
  const c = client;
  if (!c) return;
  const found = [{ n: 1, model: app.device.identity.model }];
  app.exclusive = true;
  try {
    for (let n = 2; n <= CHAIN_MAX; n++) {
      const target = n as 2 | 3 | 4 | 5 | 6;
      const ping = await c.get("system.ping", { target, timeoutMs: 600 }).catch(() => []);
      if (!ping.some((a) => a.kind === "get")) break;
      const key = (await c.get("system.key.info", { target, timeoutMs: 800 }).catch(() => [])).find((a) => a.kind === "get");
      found.push({ n, model: parseKeyInfo(String(key?.value ?? "")).model });
    }
  } finally {
    app.exclusive = false;
  }
  app.chain = found.length > 1 ? found : [];
}
/** show another device of the chain: everything is read from it */
export async function selectDevice(n: number) {
  if (!client || n === app.target) return;
  client.target = n as 1 | 2 | 3 | 4 | 5 | 6;
  app.target = n;
  if (app.page === "firmware" && n !== 1) app.page = "overview";
  if (app.demo) { app.device = demoState(n); historyReset(app.device); return; }
  try {
    await reload();
    loadInNames();
  } catch (e) {
    app.error = explain(e);
  }
}

// --- bootloader (#17) -----------------------------------------------------------------------------
/** the identity the device reported before it went into the bootloader (not readable there) */
let lastIdentity = { keyInfo: "", model: "", pcb: "" };
async function firmwareAnswers(): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const r = await client?.get("system.firmware").catch(() => []) ?? [];
    if (r.length) return true;
  }
  return false;
}
/** the bootloader on this port: already in contact (400 ms), or waiting at its start (autobaud for burstMs) */
async function findBootloader(t: Transport, burstMs: number): Promise<Bootloader | null> {
  if (!t.bytes) return null;
  try {
    await new Bootloader(t.bytes, 400).bootloaderVersion();
    return new Bootloader(t.bytes);
  } catch { /* no frame back */ }
  if (!burstMs) return null;
  const bl = new Bootloader(t.bytes);
  return (await bl.connect(burstMs)) ? bl : null;
}
async function bootloaderMode(bl: Bootloader) {
  const v = await bl.bootloaderVersion();
  const st = emptyState();
  Object.assign(st.identity, lastIdentity);
  app.device = st;
  const total = APP_SIZE + EEPROM_SIZE;
  app.bootloader = { version: `${v[0]}.${v[1]}`, read: { done: 0, total }, flash: null, eeprom: null, id: null, error: "",
    identity: lastIdentity.model && lastIdentity.pcb ? `${lastIdentity.model}-${lastIdentity.pcb}` : "" };
  app.page = "firmware";
  app.progress = null;
  app.status = "online";
  lastIdentity = { keyInfo: "", model: "", pcb: "" };
  void readBoot(bl, app.bootloader, total);   // in the background, the page shows the progress
}
async function readBoot(bl: Bootloader, b: BootState, total: number) {
  app.exclusive = true;
  try {
    const flash = await bl.readFlash(0, APP_SIZE, (d) => (b.read = { done: d, total }));
    const eeprom = await bl.readEeprom(0, EEPROM_SIZE, (d) => (b.read = { done: APP_SIZE + d, total }));
    const id = identifyFlash(flash);
    Object.assign(b, { flash, eeprom, id, read: null });
    if (!app.device.identity.model && id.model) {
      Object.assign(app.device.identity, { model: id.model, pcb: id.pcb });
      if (id.kind === "original") b.identity = `${id.model}-${id.pcb}`;
    }
  } catch (e) {
    b.error = explain(e);
    b.read = null;
  } finally {
    app.exclusive = false;
  }
}
/** resolves when the read-out of the bootloader mode is finished (at once outside it) */
export async function bootReadDone(): Promise<void> {
  while (app.bootloader?.read) await new Promise((r) => setTimeout(r, 200));
}
/** leave the bootloader: the firmware in the flash starts, then everything is read in */
export async function leaveBootloader() {
  const t = transport;
  if (!t?.bytes || !app.bootloader) return;
  await new Bootloader(t.bytes).startApplication();
  app.bootloader = null;
  app.status = "reading";
  await new Promise((r) => setTimeout(r, 3000));
  try {
    for (let i = 0; i < 20 && !(await firmwareAnswers()); i++) await new Promise((r) => setTimeout(r, 500));
    await reload();
  } catch (e) {
    app.error = explain(e);
    await disconnect();
  }
}

/** the USB port of the Forge, if it is there; without asking (allowed before / the only CP2102) */
async function reopenUsb(): Promise<Transport | null> {
  try {
    if (isNative()) {
      const p = autoPort(await portsNative());
      return p ? await openNativeSerial(p.name) : null;
    }
    const p = await grantedPort();
    return p ? await openWebSerial(38400, p) : null;
  } catch {
    return null;   // still enumerating, or taken by another program
  }
}
async function usbPresent(): Promise<boolean> {
  return isNative() ? !!autoPort(await portsNative().catch(() => [])) : !!(await grantedPort());
}

export type BootWaitState = "off" | "on" | "found" | "noBoot";
/**
 * First update from the original firmware (#17): it cannot start the bootloader itself. The port
 * is closed, the user switches the Forge off (its USB chip goes with it), holds the button and
 * switches it on again; the port is opened as soon as it is back and the bootloader is called
 * (autobaud) until it answers. ctl.skipOff: the port did not go away (go on anyway);
 * ctl.port: a port the user picked by hand (browsers without getPorts).
 */
export async function waitForBootloader(ctl: { signal: AbortSignal; onState(s: BootWaitState): void; skipOff?: boolean;
  port?: () => Promise<Transport | null> }): Promise<boolean> {
  lastIdentity = { keyInfo: app.device.identity.keyInfo, model: app.device.identity.model, pcb: app.device.identity.pcb };
  app.bootWait = true;
  app.exclusive = true;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    await transport?.close().catch(() => undefined);
    transport = null; client = null;
    app.status = "connecting";
    ctl.onState("off");
    while (!ctl.signal.aborted && !ctl.skipOff && (await usbPresent())) await sleep(300);
    ctl.onState("on");
    let since = Date.now();
    while (!ctl.signal.aborted) {
      const t = (await ctl.port?.()) ?? (await reopenUsb());
      if (!t) { await sleep(300); continue; }
      attach(t);
      const bl = new Bootloader(t.bytes!);
      if (await bl.connect(1500)) {
        ctl.onState("found");
        await bootloaderMode(bl);
        return true;
      }
      // the port is there but no bootloader: the firmware started (button not held); keep trying
      if (Date.now() - since > 6000) ctl.onState("noBoot");
      await t.close().catch(() => undefined);
      transport = null; client = null;
      if (!(await usbPresent())) { since = Date.now(); ctl.onState("on"); }
      await sleep(300);
    }
    return false;
  } finally {
    app.bootWait = false;
    app.exclusive = false;
    if (!app.bootloader) await disconnect();
  }
}

// --- master volume (GUI-#3): the event values of the MODC volume block -------------------------------
/** events of the master to read: both volume events of the volume block */
const masterRegs = () => {
  const m = masterOf(app.device);
  return m ? [...new Set([m.odd, m.even])].map((e) => `event.${e}.value`) : [];
};
async function readMaster() {
  if (!client) return;
  for (const r of masterRegs())
    try { for (const a of await client.get(r)) applyAnswer(app.device, a); } catch { /* no answer: shown as unknown */ }
}
/** master as event value 0..255 (255 = 0 dB); both events of the volume block, throttled like a fader */
export function setMaster(v: number) {
  const m = masterOf(app.device);
  if (!m) return;
  for (const e of new Set([m.odd, m.even])) {
    app.device.events[e] = v;
    write(`event.${e}.value`, v);
  }
}

/** one read for a page (diagnostics); answers also go into the model */
export async function query(reg: string): Promise<Answer[]> {
  if (!client) return [];
  try {
    const r = await client.get(reg);
    for (const a of r) applyAnswer(app.device, a);
    return r;
  } catch {
    return [];
  }
}

/** one write that is not a model value (diagnostics); returns the error text or "" */
export async function writeOnce(reg: string, value: Value): Promise<string> {
  if (!client) return t("common.notConnected");
  try {
    const r = await client.set(reg, value, { checksum: true });
    const bad = r.find((a) => a.kind === "error");
    return bad ? deviceError(bad) : "";
  } catch (e) {
    return explain(e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * New biquad lengths for the channels of one DSP core (port firmware, forge-dsp-firmware#47).
 * The device moves the stored bands, restarts and loads the new DSP program; it may restart a
 * second time right after (forge-dsp-firmware#57). Waits until it has answered for 15 s in a row,
 * then reads everything again. step() reports progress. Returns the error text or "".
 */
export async function setPoolLengths(core: number, lengths: number[], step: (text: string) => void): Promise<string> {
  if (app.demo) {
    const d = app.device;
    const chans = (d.pools ?? []).filter((c) => c.core === core);
    chans.forEach((c, i) => {
      const bq = (d.biquads[c.ch] ??= {});
      for (let n = c.len + 1; n <= lengths[i]; n++) bq[n] = { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 };
      for (let n = lengths[i] + 1; n <= c.len; n++) delete bq[n];
      c.len = lengths[i];
    });
    return "";
  }
  if (!client) return t("common.notConnected");
  app.exclusive = true;
  try {
    step(t("app.deviceReallocatesBiquads"));
    const err = await writeOnce(`system.biquads.${core}`, lengths);
    if (err) return err;
    step(t("app.deviceRestartsLoadsNew"));
    await sleep(4000);
    const t0 = Date.now();
    for (let quiet = 0; quiet < 15000;) {
      if (Date.now() - t0 > 150000) return t("app.deviceDoesNotCome");
      let ok = false;
      try {
        ok = (await client.get("system.firmware")).some((a) => a.kind === "get");
      } catch { /* still restarting */ }
      if (ok) quiet += 2500;
      else if (quiet) { quiet = 0; step(t("app.deviceStartsSecondTime")); }
      await sleep(2500);
    }
    step("Lese den neuen Stand …");
    await reload();
    return "";
  } finally {
    app.exclusive = false;
  }
}

// --- level meter range ------------------------------------------------------------------------------
/** where the level bars start, dBFS; per browser. Lower values show quiet signals and noise, e.g.
 * to set the analog input gain pots of the Forge by the meter. */
export const VU_FLOORS = [-60, -80, -100, -120] as const;
function loadFloor(): number {
  try {
    const v = Number(localStorage.getItem("vuFloor"));
    return (VU_FLOORS as readonly number[]).includes(v) ? v : -60;
  } catch { return -60; }
}
/** header meter: "outputs" = sum of the outputs given per output (side 0 = left, 1 = right, -1 = not
 * counted), "inputs" = the loudest input pair */
export type MeterSource = "outputs" | "inputs";
const DEFAULT_SIDES = [0, 1, 0, 1, 0, 1, 0, 1];
function loadMeter(): { source: MeterSource; sides: number[] } {
  try {
    const m = JSON.parse(localStorage.getItem("meter") ?? "{}");
    const sides = Array.isArray(m.sides) && m.sides.length === 8 && m.sides.every((x: unknown) => x === 0 || x === 1 || x === -1)
      ? m.sides : DEFAULT_SIDES;
    return { source: m.source === "inputs" ? "inputs" : "outputs", sides };
  } catch { return { source: "outputs", sides: DEFAULT_SIDES }; }
}
const loaded = typeof window === "undefined" ? { source: "outputs" as MeterSource, sides: DEFAULT_SIDES } : loadMeter();
export const meter = $state({ floor: typeof window === "undefined" ? -60 : loadFloor(), source: loaded.source, sides: [...loaded.sides] });
export function setVuFloor(v: number) {
  meter.floor = v;
  try { localStorage.setItem("vuFloor", String(v)); } catch { /* private mode: only this session */ }
}
export function setMeter(source: MeterSource, sides: number[]) {
  meter.source = source;
  meter.sides = [...sides];
  try { localStorage.setItem("meter", JSON.stringify({ source, sides })); } catch { /* see above */ }
}
export const resetMeter = () => setMeter("outputs", DEFAULT_SIDES);

// --- files on the microSD (forge-dsp-firmware#59) --------------------------------------------------
let sdBusy = false;
/**
 * Runs a transfer with the card exclusively: no status reads in between, blocks not in the
 * console. fn gets the link to the device.
 */
export async function withSd<T>(fn: (l: SdLink) => Promise<T>): Promise<T> {
  const c = client;
  if (!c) throw new Error(t("common.notConnected"));
  const link: SdLink = {
    get: (reg) => c.get(reg),
    async set(reg, value, timeoutMs) {
      const r = await c.set(reg, value, { checksum: true, timeoutMs });
      const bad = r.find((a) => a.kind === "error");
      return bad ? deviceError(bad) : r.some((a) => a.kind === "info") ? "" : t("common.noAnswer");
    },
  };
  app.exclusive = true;
  sdBusy = true;
  try {
    return await fn(link);
  } finally {
    sdBusy = false;
    app.exclusive = false;
  }
}

/** raw console line */
export async function sendRaw(line: string) {
  if (!client) return;
  try {
    for (const a of await client.send(line)) applyAnswer(app.device, a);
  } catch (e) {
    app.error = explain(e);
  }
}

/** one set with the value text of a tuning file; returns the error text or "" */
export async function writeRaw(reg: string, valueText: string): Promise<string> {
  if (!client) return t("common.notConnected");
  try {
    const r = await client.setRaw(reg, valueText, { checksum: true });
    const bad = r.find((a) => a.kind === "error");
    return bad ? deviceError(bad) : "";
  } catch (e) {
    return explain(e);
  }
}

// One write per register at a time; while it is on its way only the newest value is kept
// (a slider must not fill the 38400 Bd line).
const pending = new Map<string, { busy: boolean; next?: Value }>();

/** Writes a register with checksum. The caller has already put the value into app.device. */
export function write(reg: string, value: Value) {
  if (!client) return;
  historyTouch();
  const p = pending.get(reg) ?? { busy: false };
  pending.set(reg, p);
  if (p.busy) {
    p.next = value;
    return;
  }
  p.busy = true;
  app.writing++;
  const c = client;
  (async () => {
    let v: Value | undefined = value;
    while (v !== undefined) {
      try {
        const r = await c.set(reg, v, { checksum: true });
        const bad = r.find((a) => a.kind === "error");
        if (bad) app.error = deviceError(bad);
      } catch (e) {
        app.error = explain(e);
      }
      v = p.next;
      p.next = undefined;
    }
    p.busy = false;
    app.writing--;
  })();
}

// --- values that change on their own (#13) ------------------------------------------------------
// Only while online, visible and idle (never between the writes of a slider). The level meter is
// read a few times per second, temperature, error counters and supply every few seconds.
const VU_MS = 200;
const STATUS_EVERY = 25;  // x VU_MS = 5 s
let polling = false;
let tick = 0;
/** registers of the running status read: their requests and answers stay out of the console, the
 *  lines of a command typed meanwhile do not */
let pollRegs: string[] = [];
const regOf = (text: string) => /^\s*\S+?\.\d+\s+([\w.]+)/.exec(text)?.[1] ?? null;   // "get.1 reg", " <.1 reg=…"
function isPollLine(text: string) {
  const r = pollRegs.length ? regOf(text) : null;
  return r !== null && pollRegs.includes(r);
}

async function poll() {
  const c = client;
  if (!c || polling || app.status !== "online" || app.writing > 0 || app.exclusive || app.bootloader) return;
  if (typeof document !== "undefined" && document.hidden) return;
  tick++;
  const regs: string[] = [];
  if (app.device.vu !== null) regs.push("system.vu");
  // output levels: the meter in the header shows their sum
  if (app.device.vuOut !== null) regs.push("system.vu.out");
  if (tick % STATUS_EVERY === 0) {
    for (const r of STATUS_REGS) if (!r.port || isPort(app.device)) regs.push(r.reg);
    regs.push(...masterRegs());  // a rotary encoder or the IR remote may have moved it
  }
  if (!regs.length) return;
  polling = true;
  pollRegs = regs;
  try {
    for (const reg of regs) {
      if (client !== c || app.writing > 0) break;
      for (const a of await c.get(reg)) applyAnswer(app.device, a);
    }
  } catch {
    /* a missed status read is harmless, the next one follows */
  } finally {
    polling = false;
    pollRegs = [];
  }
}
if (typeof window !== "undefined") setInterval(poll, VU_MS);

// --- channel names --------------------------------------------------------------------------------
// Outputs: in the device (system.channel.name.N). Inputs: in the device as well when the firmware
// stores them (port: system.channel.in.N, forge-dsp-firmware#55); with the original firmware in
// this browser, per device serial. Default: the number of the stereo input with its side.
const inNames = $state<Record<number, string>>({});
const serialOf = () => app.device.identity.keyInfo.split("-")[3] || "unknown";
const namesKey = () => `forge-in-names:${serialOf()}`;
const deviceHasInNames = () => app.device.inputNames !== null;

export function loadInNames() {
  for (const k of Object.keys(inNames)) delete inNames[Number(k)];
  try {
    Object.assign(inNames, JSON.parse(localStorage.getItem(namesKey()) ?? "{}"));
  } catch { /* no storage: names last for this session */ }
}

/** quotes, ';' and line breaks cannot be sent; the device keeps 16 bytes */
export function cleanName(t: string): string {
  let v = t.replace(/["; \r\n]+/g, " ").trim();
  while (new TextEncoder().encode(v).length > 16) v = v.slice(0, -1);  // 16 bytes, umlauts count twice
  return v.trim();
}

export const outName = (ch: number) => app.device.channelNames[ch] || t("common.outputN", { n: ch });
export const inDefault = (n: number) => inputDefaultName(n, app.device.gain.in.length || 6);
export const inNameRaw = (n: number) => (deviceHasInNames() ? app.device.inputNames![n] ?? "" : inNames[n] ?? "");
export const inName = (n: number) => inNameRaw(n) || inDefault(n);
/** short caption where the group already says "Analog"/"Digital": "2 L", "R"; a given name as it is */
export const inShort = (n: number) => inNameRaw(n) || inPos(n);
/** "2 L" / "R": the number of an input without a name */
export const inPos = (n: number) => inputShortName(n, app.device.gain.in.length || 6);
export const outNameRaw = (ch: number) => app.device.channelNames[ch] ?? "";

export function setOutName(ch: number, name: string) {
  const v = cleanName(name);
  app.device.channelNames[ch] = v;
  write(`system.channel.name.${ch}`, v);
}

export function setInName(n: number, name: string) {
  const v = cleanName(name);
  if (deviceHasInNames()) {
    app.device.inputNames![n] = v;
    write(`system.channel.in.${n}`, v);
    return;
  }
  if (v) inNames[n] = v;
  else delete inNames[n];
  try { localStorage.setItem(namesKey(), JSON.stringify(inNames)); } catch { /* see above */ }
}

// --- firmware update ------------------------------------------------------------------------------
/** access for lib/boot/update.ts: raw bytes and text lines of the same port; null without USB */
export function updateAccess(): { link: ByteLink; sendLine(l: string): Promise<void>; ask(reg: string): Promise<string> } | null {
  const t = transport, c = client;
  if (!t?.bytes || !c) return null;
  return {
    link: t.bytes,
    sendLine: (l) => t.write(l + "\r\n"),
    ask: async (reg) => (await c.get(reg).catch(() => []))[0]?.raw ?? "",
  };
}
