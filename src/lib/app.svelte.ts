// Application state (Svelte 5 runes): connection, device model, log, navigation.
import { ForgeClient, type Answer, type Value } from "./protocol";
import type { ByteLink, Transport } from "./transport/types";
import { openWebSerial } from "./transport/webserial";
import { openWebSocket } from "./transport/websocket";
import { applyAnswer, emptyState, inputDefaultName, isPort, readDevice, STATUS_REGS, type DeviceState, type ReadProgress,
  type SdLink } from "./device";
import { DemoTransport, demoState } from "./device/demo";

export type PageId = "overview" | "mixer" | "filters" | "delay" | "modc" | "presets" | "biquads"
  | "diagnose" | "firmware" | "console" | "sdcard";

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
});

let transport: Transport | null = null;
let client: ForgeClient | null = null;

function attach(t: Transport) {
  transport = t;
  client = new ForgeClient(t);
  client.onRaw((text, dir) => {
    if (polling || sdBusy) return;  // status reads and file blocks would flood the console
    app.log.push({ dir, text: text.trimEnd() });
    if (app.log.length > 400) app.log.splice(0, app.log.length - 400);
  });
  client.onAnswer((a) => applyAnswer(app.device, a));  // events, lines without a request
  app.transportName = t.name;
}

export async function connect(kind: "usb" | "esp" | "demo") {
  app.error = "";
  app.status = "connecting";
  try {
    if (kind === "demo") {
      attach(new DemoTransport());
      app.device = demoState();
      app.demo = true;
    } else {
      attach(kind === "usb" ? await openWebSerial() : await openWebSocket());
      app.demo = false;
      app.status = "reading";
      app.device = await readDevice(client!, (p) => (app.progress = p));
      app.progress = null;
      if (!app.device.identity.keyInfo && !app.device.identity.firmware) throw new Error("Kein Forge antwortet an diesem Anschluss.");
    }
    loadInNames();
    app.status = "online";
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
    await disconnect();
  }
}

export async function disconnect() {
  await transport?.close().catch(() => undefined);
  transport = null;
  client = null;
  app.status = "offline";
  app.progress = null;
  app.demo = false;
  app.transportName = "";
  app.device = emptyState();
}

export async function reload() {
  if (!client || app.demo) return;
  app.status = "reading";
  app.device = await readDevice(client, (p) => (app.progress = p));
  app.progress = null;
  app.status = "online";
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
  if (!client) return "nicht verbunden";
  try {
    const r = await client.set(reg, value, { checksum: true });
    const bad = r.find((a) => a.kind === "error");
    return bad ? bad.message ?? "Fehler" : "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
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
  if (!client) return "nicht verbunden";
  app.exclusive = true;
  try {
    step("Gerät verteilt die Biquads um …");
    const err = await writeOnce(`system.biquads.${core}`, lengths);
    if (err) return err;
    step("Gerät startet neu und lädt das neue DSP-Programm …");
    await sleep(4000);
    const t0 = Date.now();
    for (let quiet = 0; quiet < 15000;) {
      if (Date.now() - t0 > 150000) return "Das Gerät meldet sich nicht zurück.";
      let ok = false;
      try {
        ok = (await client.get("system.firmware")).some((a) => a.kind === "get");
      } catch { /* still restarting */ }
      if (ok) quiet += 2500;
      else if (quiet) { quiet = 0; step("Gerät startet ein zweites Mal …"); }
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
export const meter = $state({ floor: typeof window === "undefined" ? -60 : loadFloor() });
export function setVuFloor(v: number) {
  meter.floor = v;
  try { localStorage.setItem("vuFloor", String(v)); } catch { /* private mode: only this session */ }
}

// --- files on the microSD (forge-dsp-firmware#59) --------------------------------------------------
let sdBusy = false;
/**
 * Runs a transfer with the card exclusively: no status reads in between, blocks not in the
 * console. fn gets the link to the device.
 */
export async function withSd<T>(fn: (l: SdLink) => Promise<T>): Promise<T> {
  const c = client;
  if (!c) throw new Error("nicht verbunden");
  const link: SdLink = {
    get: (reg) => c.get(reg),
    async set(reg, value) {
      const r = await c.set(reg, value, { checksum: true });
      const bad = r.find((a) => a.kind === "error");
      return bad ? bad.message ?? "Fehler" : r.some((a) => a.kind === "info") ? "" : "keine Antwort";
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
    app.error = e instanceof Error ? e.message : String(e);
  }
}

/** one set with the value text of a tuning file; returns the error text or "" */
export async function writeRaw(reg: string, valueText: string): Promise<string> {
  if (!client) return "nicht verbunden";
  try {
    const r = await client.setRaw(reg, valueText, { checksum: true });
    const bad = r.find((a) => a.kind === "error");
    return bad ? bad.message ?? "Fehler" : "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// One write per register at a time; while it is on its way only the newest value is kept
// (a slider must not fill the 38400 Bd line).
const pending = new Map<string, { busy: boolean; next?: Value }>();

/** Writes a register with checksum. The caller has already put the value into app.device. */
export function write(reg: string, value: Value) {
  if (!client) return;
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
        if (bad) app.error = `${bad.register}: ${bad.message}`;
      } catch (e) {
        app.error = e instanceof Error ? e.message : String(e);
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

async function poll() {
  const c = client;
  if (!c || polling || app.status !== "online" || app.writing > 0 || app.exclusive) return;
  if (typeof document !== "undefined" && document.hidden) return;
  tick++;
  const regs: string[] = [];
  if (app.device.vu !== null) regs.push("system.vu");
  // output levels only while the overview shows them (each read is two more DSP accesses)
  if (app.device.vuOut !== null && app.page === "overview") regs.push("system.vu.out");
  if (tick % STATUS_EVERY === 0)
    for (const r of STATUS_REGS) if (!r.port || isPort(app.device)) regs.push(r.reg);
  if (!regs.length) return;
  polling = true;
  try {
    for (const reg of regs) {
      if (client !== c || app.writing > 0) break;
      for (const a of await c.get(reg)) applyAnswer(app.device, a);
    }
  } catch {
    /* a missed status read is harmless, the next one follows */
  } finally {
    polling = false;
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

export const outName = (ch: number) => app.device.channelNames[ch] || `Ausgang ${ch}`;
export const inDefault = (n: number) => inputDefaultName(n, app.device.gain.in.length || 6);
export const inNameRaw = (n: number) => (deviceHasInNames() ? app.device.inputNames![n] ?? "" : inNames[n] ?? "");
export const inName = (n: number) => inNameRaw(n) || inDefault(n);
/** short caption where the group already says "Analog"/"Digital": "2 L", "R"; a given name as it is */
export const inShort = (n: number) => inNameRaw(n) || inDefault(n).replace(/^Eingang |^Digital /, "");
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
