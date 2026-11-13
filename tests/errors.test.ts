import { describe, expect, it } from "vitest";
import { deviceError, explain } from "../src/lib/errors";
import { parseAnswer } from "../src/lib/protocol";

describe("error texts", () => {
  it("explains the firmware's four error answers", () => {
    const a = parseAnswer(" !.1 system.startup.9 command out of range")!;
    expect(deviceError(a)).toBe("Der Wert oder die Nummer für „system.startup.9“ liegt außerhalb dessen, was das Gerät erlaubt.");
    expect(deviceError(parseAnswer(" !.1 system.dsp.limiter.1 unknown command")!)).toMatch(/kennt „system.dsp.limiter.1“ nicht/);
    expect(deviceError(parseAnswer(" !.1 gain.out.1 unknown para")!)).toMatch(/Format/);
    expect(deviceError(parseAnswer(" !.1 system.sd.write chksum")!)).toMatch(/Prüfsumme/);
    expect(deviceError({ register: "x.y", message: "something new" })).toBe("x.y: something new");
  });
  it("explains transport errors and leaves others alone", () => {
    expect(explain(new Error("timeout: get.1 system.ping"))).toBe("Das Gerät hat auf „get.1 system.ping“ nicht geantwortet. Ist es noch eingeschaltet und verbunden?");
    expect(explain(new DOMException("Failed to open serial port.", "NetworkError"))).toMatch(/belegt/);
    expect(explain("/dev/ttyUSB0: Device or resource busy")).toMatch(/belegt/);       // desktop app (Rust)
    expect(explain("/dev/ttyUSB0: Permission denied")).toMatch(/uucp/);
    expect(explain(new DOMException("No port selected by the user.", "NotFoundError"))).toBe("Kein Anschluss gewählt.");
    expect(explain(new Error("WebSocket ws://192.168.4.1/ws failed"))).toMatch(/ESP32-Brücke unter ws:\/\/192.168.4.1\/ws/);
    expect(explain(new Error("Die neue Firmware antwortet nicht."))).toBe("Die neue Firmware antwortet nicht.");
  });
});
