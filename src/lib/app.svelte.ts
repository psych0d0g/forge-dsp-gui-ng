// Application state (Svelte 5 runes): connection, device model, log, navigation.
import { ForgeClient, type Value } from "./protocol";
import type { Transport } from "./transport/types";
import { openWebSerial } from "./transport/webserial";
import { openWebSocket } from "./transport/websocket";
import { applyAnswer, emptyState, readDevice, type DeviceState, type ReadProgress } from "./device";
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
