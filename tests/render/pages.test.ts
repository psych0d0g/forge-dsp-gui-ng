import { beforeAll, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Component } from "svelte";
import { app, connect, type PageId } from "../../src/lib/app.svelte";
import Overview from "../../src/pages/Overview.svelte";
import Mixer from "../../src/pages/Mixer.svelte";
import Filters from "../../src/pages/Filters.svelte";
import Delay from "../../src/pages/Delay.svelte";
import Modc from "../../src/pages/Modc.svelte";
import Presets from "../../src/pages/Presets.svelte";
import Biquads from "../../src/pages/Biquads.svelte";
import Diagnose from "../../src/pages/Diagnose.svelte";
import SdCard from "../../src/pages/SdCard.svelte";
import Firmware from "../../src/pages/Firmware.svelte";
import Settings from "../../src/pages/Settings.svelte";
import Console from "../../src/pages/Console.svelte";

// Every page builds in the demo without throwing: catches errors the unit tests do not see
// (e.g. a derived value read before the first channel is chosen).
const PAGES: [PageId, Component, string?][] = [
  ["overview", Overview], ["mixer", Mixer], ["filters", Filters], ["filters", Filters, "?demo&over=3,5"], ["delay", Delay],
  ["modc", Modc], ["presets", Presets], ["biquads", Biquads], ["diagnose", Diagnose], ["sdcard", SdCard],
  ["firmware", Firmware], ["settings", Settings], ["console", Console],
];

describe("pages build in the demo", () => {
  beforeAll(async () => {
    await connect("demo");
  });
  for (const [id, Page, search] of PAGES) {
    it(`${id}${search ?? ""}`, () => {
      history.replaceState(null, "", `/${search ?? "?demo"}`);
      app.page = id;
      const el = document.createElement("div");
      document.body.appendChild(el);
      const c = mount(Page, { target: el });
      flushSync();
      expect(el.querySelector("h2")?.textContent?.length).toBeGreaterThan(0);
      if (search?.includes("over=")) expect(el.querySelectorAll("path.sum").length).toBe(1);   // crossover sum drawn
      unmount(c);
      el.remove();
    });
  }
});
