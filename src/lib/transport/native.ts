import { invoke } from "../native";
import { ByteQueue, LineSplitter, type Transport } from "./types";

// Serial port through the desktop app (src-tauri/src/lib.rs): WebKit (macOS, Linux) has no Web Serial.

export interface PortInfo { name: string; vid: number | null; pid: number | null; product: string | null }

export const CP210X = 0x10c4;  // USB-UART of the Forge

/** the port to open without asking: the only CP2102 (the Forge's USB chip) */
export function autoPort(ports: PortInfo[]): PortInfo | null {
  const forge = ports.filter((p) => p.vid === CP210X);
  return forge.length === 1 ? forge[0] : null;
}

/** ports worth showing: USB ones first; "all" adds the rest (Linux lists every ttyS the kernel has) */
export function listPorts(ports: PortInfo[], all: boolean): PortInfo[] {
  const usb = ports.filter((p) => p.vid !== null).sort((a, b) => Number(b.vid === CP210X) - Number(a.vid === CP210X) || a.name.localeCompare(b.name));
  return all ? [...usb, ...ports.filter((p) => p.vid === null).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))] : usb;
}

export const portsNative = () => invoke<PortInfo[]>("serial_ports");

/** opens a port (8N1); the GUI's line protocol and the bootloader's raw bytes on the same port */
export async function openNativeSerial(path: string, baud = 38400): Promise<Transport> {
  const { Channel } = await import("@tauri-apps/api/core");
  const listeners: ((l: string) => void)[] = [];
  const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
  const queue = new ByteQueue();
  const dec = new TextDecoder();
  const onData = new Channel<number[]>();
  onData.onmessage = (bytes) => {
    const b = new Uint8Array(bytes);
    queue.push(b);
    split.push(dec.decode(b, { stream: true }));
  };
  await invoke("serial_open", { path, baud, onData });
  const send = (data: Uint8Array) => invoke<void>("serial_write", { data: Array.from(data) });
  return {
    name: `USB (${path.replace(/^\/dev\//, "")})`,
    write: (line) => send(new TextEncoder().encode(line)),
    onLine: (fn) => listeners.push(fn),
    bytes: { write: send, read: (ms) => queue.read(ms), flush: () => queue.flush() },
    close: () => invoke<void>("serial_close"),
  };
}
