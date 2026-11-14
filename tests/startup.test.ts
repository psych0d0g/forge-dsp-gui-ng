import { describe, expect, it } from "vitest";
import { decodeStartup, formatUptime } from "../src/lib/device";

// measured on the DEV Forge (96ELN, 2.4.0): cold start, then the start after an update
const COLD = [247, 486, 486, 492, 1198, 2134, 3030, 3926, 4934, 4936, 5209, 7180, 7181, 7183, 7227, 7406, 7543, 8470, 8470, 9576, 0];
const AFTER_UPDATE = [...COLD.slice(0, 20), 58605];

describe("start-up times (forge-dsp-firmware#67)", () => {
  it("stages from the phases", () => {
    const s = decodeStartup(COLD)!;
    expect(s.stages.map((x) => x.ms)).toEqual([0, 1198, 2728, 3257, 360, 927, 0, 1106]);
    expect(s.total).toBe(9576);
    expect(s.stuck).toBe(false);
  });
  it("a start that waited in the bootloader", () => {
    const s = decodeStartup(AFTER_UPDATE)!;
    expect(s.total).toBe(9576 + 58605);
    expect(s.stuck).toBe(true);
  });
  it("phases not reached, firmware without the list", () => {
    const s = decodeStartup([...COLD.slice(0, 18), -1, -1, 0])!;
    expect(s.total).toBeNull();
    expect(s.stages.at(-1)!.ms).toBeNull();
    expect(decodeStartup(null)).toBeNull();
  });
  it("uptime", () => {
    expect(formatUptime(62416)).toBe("0:01:02");
    expect(formatUptime(3723000)).toBe("1:02:03");
    expect(formatUptime(90061000)).toBe("1 d 01:01:01");
  });
});
