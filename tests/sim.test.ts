import { describe, expect, it } from "vitest";
import { ForgeClient } from "../src/lib/protocol";
import { readDevice } from "../src/lib/device";
import { simFlavours, simTransport, type SimModule, type SimStore } from "../src/lib/transport/sim";

/** a stand-in for the emscripten module: answers ping, keeps one value in the EEPROM */
function fakeModule() {
  const heap = new Uint8Array(8192);
  let out = "", resets = 0, pending = 0, boots = 0;
  const enc = new TextEncoder();
  const m: SimModule = {
    HEAPU8: heap,
    _sim_eeprom: () => 0,
    _sim_boot: () => { boots++; const r = pending; pending = 0; return r; },
    _sim_loop: () => undefined,
    _sim_output: () => { const b = enc.encode(out + "\0"); heap.set(b, 4096); out = ""; return 4096; },
    _sim_reset_pending: () => pending,
    ccall: (_n, _r, _t, [line]) => {
      const l = String(line);
      if (l === "get.1 system.ping") out += ' <.1 system.ping="pong"\r\n';
      else if (l === "set.1 gain.out.1=200") { heap[10] = 200; out += " *.1 gain.out.1 ok\r\n"; }
      else if (l === "get.1 gain.out.1") out += ` <.1 gain.out.1=${heap[10]}\r\n`;
      else if (l === "set.1 system.boot=1") { out += " *.1 system.boot ok\r\n"; pending = 1; resets++; }
    },
    UTF8ToString: (p) => { const e = heap.indexOf(0, p); return new TextDecoder().decode(heap.subarray(p, e)); },
  };
  return { m, stats: () => ({ resets, boots }) };
}
const memStore = () => { const kv = new Map<string, Uint8Array>(); const s: SimStore = { load: (k) => kv.get(k) ?? null, save: (k, d) => void kv.set(k, d) }; return { s, kv }; };

describe("simulator transport", () => {
  it("answers like a device and keeps the EEPROM", async () => {
    const { m, stats } = fakeModule();
    const { s, kv } = memStore();
    const t = simTransport(m, "V40-96ELN", s, 1000);
    const c = new ForgeClient(t);
    expect((await c.get("system.ping"))[0].value).toBe("pong");
    await c.set("gain.out.1", 200);
    await t.close();
    expect(kv.get("forge-sim-eeprom-V40-96ELN")![10]).toBe(200);

    const again = fakeModule();              // a new visit: the EEPROM comes back
    const t2 = simTransport(again.m, "V40-96ELN", s, 1000);
    expect((await new ForgeClient(t2).get("gain.out.1"))[0].value).toBe(200);
    await t2.close();
    expect(stats().boots).toBe(1);
  });
  it("boots again after a reset of the firmware", async () => {
    const { m, stats } = fakeModule();
    const t = simTransport(m, "X", memStore().s, 1000);
    await new ForgeClient(t).set("system.boot", 1);
    await t.close();
    expect(stats()).toEqual({ resets: 1, boots: 2 });
  });
  it("lists the flavours from sim/index.json", async () => {
    const get = (async () => new Response(JSON.stringify({ flavours: ["V40-96ELN", 3, "V30-96LN"] }))) as unknown as typeof fetch;
    expect(await simFlavours("./sim/", get)).toEqual(["V40-96ELN", "V30-96LN"]);
    expect(await simFlavours("./sim/", (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toEqual([]);
  });
});

// the real firmware, when CI has built it (forge-dsp-firmware tools/sim -> tests/sim/)
const REAL = new URL("./sim/forge-sim-V40-96ELN.mjs", import.meta.url).href;
const real = await import(/* @vite-ignore */ REAL).catch(() => null);
describe.skipIf(!real)("simulator with the real firmware (V40-96ELN)", () => {
  it("reads a whole device", async () => {
    const factory = real.default;
    const m = await factory({ print: () => undefined, printErr: () => undefined });
    const t = simTransport(m, "V40-96ELN", memStore().s, 1000);
    const c = new ForgeClient(t);
    expect((await c.get("system.ping"))[0].value).toBe("pong");
    const s = await readDevice(c, () => undefined);
    expect(s.identity.keyInfo).toBe("96ELN-4.0");
    expect(s.gain.out.length).toBe(8);
    await c.set("gain.out.3", 180);
    expect((await c.get("gain.out.3"))[0].value).toBe(180);
    await t.close();
  }, 120_000);
});
