// Crossover wizard (#25): a 3-way + sub crossover reaches the firmware (simulator).
import { expect, test } from "@playwright/test";

test("3-way + sub: passes, names and polarity in the firmware", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./?sim=V40-96ELN");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  await page.locator("nav").getByRole("button", { name: "Filter & EQ", exact: true }).click();
  await page.getByRole("button", { name: "Weichen-Assistent …" }).click();
  const dlg = page.getByTestId("xover");
  await dlg.getByRole("button", { name: "3-Wege + Sub" }).click();
  await dlg.getByLabel("Steilheit").selectOption("lr12");
  await dlg.getByRole("button", { name: "Weiche schreiben" }).click();
  await expect(page.getByText("Weiche geschrieben: 8 Ausgänge.")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.locator("nav").getByRole("button", { name: "Konsole", exact: true }).click();
  const ask = async (reg: string) => {
    await page.getByLabel("Befehl").fill(`get.1 ${reg}`);
    await page.getByRole("button", { name: "Senden" }).click();
    return page.locator("main pre").locator("span").last();
  };
  await expect(await ask("system.channel.name.1")).toContainText('"Hochton L"');
  await expect(await ask("system.channel.name.8")).toContainText('"Sub R"');
  // LR12: from the bottom sub, woofer (inverted), mid, tweeter (inverted)
  await expect(await ask("phase.out")).toContainText("phase.out=[1,1,0,0,1,1,0,0]");
  await expect(await ask("biquad.3.1")).toContainText("biquad.3.1=[11,400,");   // mid: high pass at 400 (LR12)
  await expect(await ask("biquad.3.2")).toContainText("biquad.3.2=[5,3000,");   // and low pass at 3000
});
