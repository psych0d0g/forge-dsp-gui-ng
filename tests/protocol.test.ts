import { describe, expect, it } from "vitest";
import { checksumHex, encodeValue, getLine, parseAnswer, parseValue, setLine, ForgeClient } from "../src/lib/protocol";
import { LineSplitter, type Transport } from "../src/lib/transport/types";

describe("checksum", () => {
  // checked against the port firmware: set.1 gain.out.1=200;53 -> ok, ;C3 -> "chksum"
  it("sums register and value", () => {
    expect(checksumHex("gain.out.1=200")).toBe("53");
    expect(checksumHex("system.ping")).toBe("81");
  });
});

describe("request lines", () => {
  it("get/set with target and checksum", () => {
    expect(getLine("system.ping")).toBe("get.1 system.ping\r\n");
    expect(getLine("system.ping", { target: "a" })).toBe("get.a system.ping\r\n");
    expect(setLine("gain.out.1", 200, { checksum: true })).toBe("set.1 gain.out.1=200;53\r\n");
    expect(setLine("system.key.info", "CORED8-4.1")).toBe('set.1 system.key.info="CORED8-4.1"\r\n');
    expect(encodeValue([1, 108, "00232400"])).toBe('[1,108,"00232400"]');
  });
  it("rejects line breaks and ';' in values", () => {
    expect(() => setLine("system.channel.name.1", "a;b")).toThrow();
    expect(() => getLine("gain out")).toThrow();
  });
});

describe("answers", () => {
  // lines as the port firmware sends them (forge-dsp-firmware tests/test_cmd.py)
  it("get with string, list and number", () => {
    expect(parseAnswer(' <.1 system.ping="pong"\r\n')).toMatchObject({ kind: "get", device: 1, register: "system.ping", value: "pong" });
    expect(parseAnswer(' <.1 system.key.info.list=["96ELN-4.0","CORED8-4.0","CORED8-4.1"]')?.value)
      .toEqual(["96ELN-4.0", "CORED8-4.0", "CORED8-4.1"]);
    expect(parseAnswer(" <.1 gain.out.2=150")?.value).toBe(150);
  });
  it("info, error, event", () => {
    expect(parseAnswer(" *.1 gain.out.1 ok")).toMatchObject({ kind: "info", register: "gain.out.1", message: "ok" });
    expect(parseAnswer(" !.1 system.startup.9 command out of range"))
      .toMatchObject({ kind: "error", register: "system.startup.9", message: "command out of range" });
    expect(parseAnswer(" #.1 preset.loaded=2")).toMatchObject({ kind: "event", register: "preset.loaded", value: 2 });
    expect(parseAnswer("garbage")).toBeNull();
  });
  it("nested values", () => {
    expect(parseValue('["CORED8",96000,[1,2],""]')).toEqual(["CORED8", 96000, [1, 2], ""]);
    expect(parseValue("DF280F18")).toBe("DF280F18");
  });
});

describe("line splitter", () => {
  it("splits at LF across chunks and drops empty lines", () => {
    const got: string[] = [];
    const s = new LineSplitter((l) => got.push(l));
    s.push(" <.1 a=1\r");
    s.push("\n\r\n <.1 b=");
    s.push("2\r\n");
    expect(got).toEqual([" <.1 a=1", " <.1 b=2"]);
  });
});

class FakeForge implements Transport {
  name = "fake";
  private fn: (l: string) => void = () => {};
  sent: string[] = [];
  constructor(private answer: (line: string) => string[]) {}
  async write(line: string) {
    this.sent.push(line);
    const out = this.answer(line);
    setTimeout(() => out.forEach((l) => this.fn(l)), 1);
  }
  onLine(fn: (l: string) => void) { this.fn = fn; }
  async close() {}
}

describe("client", () => {
  it("serializes requests and matches answers", async () => {
    const t = new FakeForge((l) => (l.startsWith("get.1 system.ping") ? [' #.1 preset.loaded=1', ' <.1 system.ping="pong"'] : [" *.1 gain.out.1 ok"]));
    const c = new ForgeClient(t, 200, 20);
    const events: string[] = [];
    c.onAnswer((a) => events.push(a.register));
    const [a, b] = await Promise.all([c.get("system.ping"), c.set("gain.out.1", 200)]);
    expect(a.map((x) => x.value)).toEqual(["pong"]);
    expect(b[0].message).toBe("ok");
    expect(events).toEqual(["preset.loaded"]);
    expect(t.sent).toEqual(["get.1 system.ping\r\n", "set.1 gain.out.1=200\r\n"]);
  });
  it("collects wildcard answers and times out", async () => {
    const t = new FakeForge((l) => (l.includes("*") ? [' <.1 system.startup.1=""', ' <.1 system.startup.2=""'] : []));
    const c = new ForgeClient(t, 50, 20);
    expect((await c.get("system.startup.*")).length).toBe(2);
    await expect(c.get("system.ping")).rejects.toThrow(/timeout/);
  });
});
