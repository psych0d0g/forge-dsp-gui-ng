import { LineSplitter, type Transport } from "./types";

// Minimal typing of the Web Serial API (Chromium browsers).
interface SerialPortLike {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export const webSerialAvailable = () => typeof navigator !== "undefined" && "serial" in navigator;

/** USB-COM of the Forge (CP2102): 38400 8N1 by default. */
export async function openWebSerial(baudRate = 38400): Promise<Transport> {
  const serial = (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial;
  const port = await serial.requestPort();
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
  const listeners: ((l: string) => void)[] = [];
  const split = new LineSplitter((l) => listeners.forEach((f) => f(l)));
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  let open = true;
  (async () => {
    const dec = new TextDecoder();
    while (open) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) break;
      if (value) split.push(dec.decode(value, { stream: true }));
    }
  })();
  return {
    name: "USB",
    write: (line) => writer.write(new TextEncoder().encode(line)),
    onLine: (fn) => listeners.push(fn),
    close: async () => {
      open = false;
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      writer.releaseLock();
      await port.close();
    },
  };
}
