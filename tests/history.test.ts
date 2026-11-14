import { describe, expect, it } from "vitest";
import { stepDiff } from "../src/lib/history.svelte";

describe("undo: what to write to get back to a step (#24)", () => {
  it("changed values, emptied names, the profile last", () => {
    const now = new Map([["gain.out.1", "200"], ["mixer.position", "2"], ["system.channel.name.3", '"Sub"'], ["delay.4", "0"]]);
    const to = new Map([["gain.out.1", "211"], ["mixer.position", "1"], ["delay.4", "0"]]);
    expect(stepDiff(now, to)).toEqual([["gain.out.1", "211"], ["system.channel.name.3", '""'], ["mixer.position", "1"]]);
  });
});
