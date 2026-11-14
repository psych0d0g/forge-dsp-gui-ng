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
  const listeners: ((l: string) => void)[] = [];
  const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
  const queue = new ByteQueue();
  let reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>;
  let loop: Promise<void> = Promise.resolve();
  let open = false;
  async function start(baud: number) {
    await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: "none" });
    lastIds = port.getInfo?.() ?? null;
    reader = port.readable!.getReader();
    writer = port.writable!.getWriter();
    open = true;
    const r = reader;
    loop = (async () => {
      const dec = new TextDecoder();
      while (open) {
        const { value, done } = await r.read().catch(() => ({ value: undefined, done: true }));
        if (done) break;
        if (value) {
          queue.push(value);
          split.push(dec.decode(value, { stream: true }));
        }
      }
    })();
  }
  async function stop() {
    open = false;
    await reader.cancel().catch(() => undefined);
    await loop;
    reader.releaseLock();
    writer.releaseLock();
    await port.close().catch(() => undefined);   // gone already when the Forge was switched off
  }
  await start(baudRate);
  return {
    name: "USB",
    write: (line) => writer.write(new TextEncoder().encode(line)),
    onLine: (fn) => listeners.push(fn),
    bytes: { write: (data) => writer.write(data), read: (ms) => queue.read(ms), flush: () => queue.flush() },
    async setBaud(baud) { await stop(); queue.flush(); await start(baud); },
    close: stop,
  };
}
