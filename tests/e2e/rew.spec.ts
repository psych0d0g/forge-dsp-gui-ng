// Filters from REW (#23): pasted into Filters & EQ, they reach the firmware (simulator).
import { expect, test } from "@playwright/test";

const REW = `Equaliser: Generic
Filter  1: ON  PK       Fc   63.0 Hz  Gain  -8.0 dB  Q  4.00
Filter  2: ON  HP       Fc   35.0 Hz
Filter  3: ON  LS 6dB   Fc  100 Hz  Gain 3.0 dB
`;

test("REW filters replace the filters of output 1", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./?sim=V40-96ELN");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  await page.locator("nav").getByRole("button", { name: "Filter & EQ", exact: true }).click();
  await page.getByRole("button", { name: "Aus REW …" }).click();
  await page.getByLabel("Text aus REW").fill(REW);
  await expect(page.getByText("3 Filter erkannt, 2 übernehmbar.")).toBeVisible();
  await expect(page.locator(".rewlist")).toContainText("gibt es im Forge nicht");
  await page.getByRole("button", { name: /^2 Filter nach .* übernehmen$/ }).click();
  await expect(page.getByText("2 Filter übernommen.")).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator("nav").getByRole("button", { name: "Konsole", exact: true }).click();
  const ask = async (reg: string) => {
    await page.getByLabel("Befehl").fill(`get.1 ${reg}`);
    await page.getByRole("button", { name: "Senden" }).click();
  };
  await ask("biquad.1.1");
  await expect(page.locator("main pre").locator("span").last()).toContainText("biquad.1.1=[1,63,-80,4000,");
  await ask("biquad.1.2");
  await expect(page.locator("main pre").locator("span").last()).toContainText("biquad.1.2=[9,35,0,");
});
