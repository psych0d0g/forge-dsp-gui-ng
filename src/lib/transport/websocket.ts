import { LineSplitter, type Transport } from "./types";

/**
 * ESP32 bridge: each WebSocket text frame is passed to the RS485 port as is, every line the
 * Forge sends comes back as a text frame. Default URL: the host that served the page.
 */
export function defaultBridgeUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export function openWebSocket(url = defaultBridgeUrl()): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const listeners: ((l: string) => void)[] = [];
    const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
    ws.onmessage = (e) => split.push(typeof e.data === "string" ? e.data : "");
    ws.onerror = () => reject(new Error(`WebSocket ${url} failed`));
    ws.onopen = () =>
      resolve({
        name: "ESP32",
        write: async (line) => ws.send(line),
        onLine: (fn) => listeners.push(fn),
        close: async () => ws.close(),
      });
  });
}

/** True when the page was served by the ESP32 (it answers /api/info). */
export async function servedByBridge(): Promise<boolean> {
  try {
    const r = await fetch("/api/info", { cache: "no-store" });
    return r.ok && (await r.json()).bridge === "forge-dsp";
  } catch {
    return false;
  }
}
