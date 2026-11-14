/** A line-based connection to a Forge: USB (Web Serial) or the ESP32 bridge (WebSocket). */
export interface Transport {
  readonly name: string;
  write(line: string): Promise<void>;
  onLine(fn: (line: string) => void): void;
  close(): Promise<void>;
  /** raw bytes of the same port, for the bootloader (USB only) */
  bytes?: ByteLink;
  /** reopen the port at another rate (USB only; the Forge switches with system.baud.usb, #62) */
  setBaud?(baud: number): Promise<void>;
}

/** raw byte access (see lib/boot/client.ts) */
export interface ByteLink {
  write(data: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  flush(): void;
}

/** received bytes waiting for a reader; bounded, so text traffic does not pile up unread */
export class ByteQueue {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private wake: (() => void) | null = null;
  push(data: Uint8Array) {
    this.chunks.push(data);
    this.size += data.length;
    while (this.size > 65536 && this.chunks.length > 1) this.size -= this.chunks.shift()!.length;
    this.wake?.();
  }
  async read(timeoutMs: number): Promise<Uint8Array> {
    if (!this.size)
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { this.wake = null; resolve(); }, timeoutMs);
        this.wake = () => { clearTimeout(t); this.wake = null; resolve(); };
      });
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.flush();
    return out;
  }
  flush() { this.chunks = []; this.size = 0; }
}

/** Splits a byte/text stream into lines at LF, as the firmware does (bytematch = 10). */
export class LineSplitter {
  private buf = "";
  constructor(private emit: (line: string) => void) {}
  push(text: string) {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i + 1).replace(/\r?\n$/, "");
      this.buf = this.buf.slice(i + 1);
      if (line.trim() !== "") this.emit(line);
    }
  }
}
