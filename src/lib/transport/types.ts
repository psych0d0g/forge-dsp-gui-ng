/** A line-based connection to a Forge: USB (Web Serial) or the ESP32 bridge (WebSocket). */
export interface Transport {
  readonly name: string;
  write(line: string): Promise<void>;
  onLine(fn: (line: string) => void): void;
  close(): Promise<void>;
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
