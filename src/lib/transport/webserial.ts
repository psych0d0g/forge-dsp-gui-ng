import { ByteQueue, LineSplitter, type Transport } from "./types";

// Minimal typing of the Web Serial API (Chromium browsers).
interface SerialPortLike {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike { requestPort(): Promise<SerialPortLike>; getPorts?(): Promise<SerialPortLike[]> }
const serialApi = () => (navigator as unknown as { serial: SerialLike }).serial;

/** USB ids of the port used last: after a power cycle the Forge comes back as a new port object */
let lastIds: { usbVendorId?: number; usbProductId?: number } | null = null;

export const webSerialAvailable = () => typeof navigator !== "undefined" && "serial" in navigator;

/**
 * A port the browser already allowed, as it reappears after the Forge was switched off and on
 * (the USB chip is powered by the Forge): same USB ids as last time. null while it is away.
 */
export async function grantedPort(): Promise<SerialPortLike | null> {
  const ports = (await serialApi().getPorts?.().catch(() => [])) ?? [];
  const same = ports.filter((p) => {
    const i = p.getInfo?.() ?? {};
    return !lastIds || (i.usbVendorId === lastIds.usbVendorId && i.usbProductId === lastIds.usbProductId);
  });
  return same.length === 1 ? same[0] : null;
}

/** USB-COM of the Forge (CP2102): 38400 8N1 by default. Without a port the browser asks for one. */
export async function openWebSerial(baudRate = 38400, chosen?: SerialPortLike): Promise<Transport> {
  const port = chosen ?? (await serialApi().requestPort());
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
  lastIds = port.getInfo?.() ?? null;
  const listeners: ((l: string) => void)[] = [];
  const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  let open = true;
  const queue = new ByteQueue();
  (async () => {
    const dec = new TextDecoder();
    while (open) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) break;
      if (value) {
        queue.push(value);
        split.push(dec.decode(value, { stream: true }));
      }
    }
  })();
  return {
    name: "USB",
    write: (line) => writer.write(new TextEncoder().encode(line)),
    onLine: (fn) => listeners.push(fn),
    bytes: { write: (data) => writer.write(data), read: (ms) => queue.read(ms), flush: () => queue.flush() },
    close: async () => {
      open = false;
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => undefined);   // gone already when the Forge was switched off
    },
  };
}
