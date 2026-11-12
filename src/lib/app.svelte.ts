// Application state (Svelte 5 runes): connection, device model, log, navigation.
import { ForgeClient, type Value } from "./protocol";
import type { Transport } from "./transport/types";
import { openWebSerial } from "./transport/webserial";
import { openWebSocket } from "./transport/websocket";
import { applyAnswer, emptyState, isPort, readDevice, STATUS_REGS, type DeviceState, type ReadProgress } from "./device";
import { DemoTransport, demoState } from "./device/demo";

export type PageId = "overview" | "inputs" | "mixer" | "filters" | "delay" | "outputs" | "modc" | "presets"
  | "diagnose" | "firmware" | "console";

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
});

let transport: Transport | null = null;
let client: ForgeClient | null = null;

function attach(t: Transport) {
  transport = t;
  client = new ForgeClient(t);
  client.onRaw((text, dir) => {
    if (polling) return;  // the periodic status reads would flood the console
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

/** raw console line */
export async function sendRaw(line: string) {
  if (!client) return;
  try {
    for (const a of await client.send(line)) applyAnswer(app.device, a);
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
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
  if (!c || polling || app.status !== "online" || app.writing > 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  tick++;
  const regs: string[] = [];
  if (app.device.vu !== null) regs.push("system.vu");
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
// Outputs: in the device (system.channel.name.N). Inputs: the firmware has no place for them yet
// (forge-dsp-firmware#55), so they live in this browser, per device serial. Default: the number.
const inNames = $state<Record<number, string>>({});
const serialOf = () => app.device.identity.keyInfo.split("-")[3] || "unknown";
const namesKey = () => `forge-in-names:${serialOf()}`;

export function loadInNames() {
  for (const k of Object.keys(inNames)) delete inNames[Number(k)];
  try {
    Object.assign(inNames, JSON.parse(localStorage.getItem(namesKey()) ?? "{}"));
  } catch { /* no storage: names last for this session */ }
}

/** quotes, ';' and line breaks cannot be sent; the device keeps 16 characters */
export function cleanName(t: string): string {
  let v = t.replace(/["; \r\n]+/g, " ").trim();
  while (new TextEncoder().encode(v).length > 16) v = v.slice(0, -1);  // 16 bytes, umlauts count twice
  return v.trim();
}

export const outName = (ch: number) => app.device.channelNames[ch] || `Ausgang ${ch}`;
export const inName = (n: number) => inNames[n] || `Eingang ${n}`;
export const outNameRaw = (ch: number) => app.device.channelNames[ch] ?? "";
export const inNameRaw = (n: number) => inNames[n] ?? "";

export function setOutName(ch: number, name: string) {
  const v = cleanName(name);
  app.device.channelNames[ch] = v;
  write(`system.channel.name.${ch}`, v);
}

export function setInName(n: number, name: string) {
  const v = cleanName(name);
  if (v) inNames[n] = v;
  else delete inNames[n];
  try { localStorage.setItem(namesKey(), JSON.stringify(inNames)); } catch { /* see above */ }
}
