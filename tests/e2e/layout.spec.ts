// Layout on desktop and phone width: no page wider than the screen, the menu reachable.
import { expect, test } from "@playwright/test";

const PAGES = ["Übersicht", "Mixer", "Filter & EQ", "Laufzeit", "Steuerblöcke", "Presets", "Biquad-Verteilung", "Diagnose",
  "Speicherkarte", "Firmware", "Einstellungen", "Konsole"];

test("no page scrolls sideways", async ({ page, isMobile }) => {
  await page.goto("./?sim=V40-96ELN");
  await expect(page.locator("header.top")).toContainText("Simulator", { timeout: 30_000 });
  for (const label of PAGES) {
    if (isMobile) await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.locator("nav").getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("nav [aria-current=page]")).toHaveText(label);
    // the document and main (scrolls on its own); wide tables scroll inside their own box
    const wide = await page.evaluate(() => Math.max(...[document.documentElement, document.querySelector("main")!]
      .map((e) => e.scrollWidth - e.clientWidth)));
    expect(wide, `${label}: ${wide}px too wide`).toBeLessThanOrEqual(0);
  }
});
