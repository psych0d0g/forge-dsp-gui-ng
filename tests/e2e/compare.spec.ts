// Compare (#24): two presets of the firmware in the simulator, the device against a file.
import { expect, test } from "@playwright/test";

test("preset against preset and device against file (simulator)", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("dialog", (d) => d.accept());
  await page.goto("./?sim=V40-96ELN");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  const nav = (name: string) => page.locator("nav").getByRole("button", { name, exact: true }).click();
  const ask = async (cmd: string) => {
    await page.getByLabel("Befehl").fill(cmd);
    await page.getByRole("button", { name: "Senden" }).click();
  };

  // a difference in the loaded preset: output 1 at another level, through the console
  await nav("Konsole");
  await ask("get.1 preset.loaded");
  await expect(page.locator("main pre")).toContainText("preset.loaded=");
  const loaded = Number((await page.locator("main pre").innerText()).match(/preset\.loaded=(\d)/)![1]);
  await ask("get.1 gain.out");
  await expect(page.locator("main pre")).toContainText("gain.out=[");
  const before = Number((await page.locator("main pre").innerText()).match(/gain\.out=\[(\d+)/)![1]);
  const want = before === 200 ? 190 : 200;
  await ask(`set.1 gain.out.1=${want}`);
  await page.waitForTimeout(500);

  await nav("Presets");
  await page.locator("main h2").first().click();
  await page.keyboard.press("Control+Shift+L");                    // read the device again (the console bypasses the state)
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  const other = loaded === 0 ? 1 : 0;
  const card = page.locator(".card").nth(other);
  await card.getByRole("button", { name: "Vergleichen" }).click();
  const cmp = page.getByTestId("compare").first();
  await expect(cmp).toContainText(`Preset ${loaded + 1} gegen Preset ${other + 1}`, { timeout: 60_000 });
  await expect(cmp).toContainText("Pegel");
  await expect(cmp.getByRole("row").filter({ hasText: /Pegel .*1/ }).first()).toBeVisible();

  // the loaded preset is loaded again, the change still there
  await nav("Konsole");
  await ask("get.1 preset.loaded");
  await expect(page.locator("main pre").locator("span").last()).toContainText(`preset.loaded=${loaded}`);
  await ask("get.1 gain.out");
  await expect(page.locator("main pre").locator("span").last()).toContainText(`gain.out=[${want},`);

  // a file with two values: one as in the device, one different
  await nav("Presets");
  await page.locator("input[type=file]").setInputFiles({ name: "test.cfg", mimeType: "text/plain",
    buffer: Buffer.from(`[96ELN]\nFILE_v10 = "gain.out.1=${want}"\nFILE_v10 = "delay.2=48"\n`) });
  await page.getByRole("button", { name: "Unterschiede zeigen" }).click();
  const fc = page.getByTestId("compare").last();
  await expect(fc).toContainText("Gerät gegen test.cfg");
  await expect(fc).toContainText("1 Unterschied");
  await expect(fc).toContainText("Laufzeit");
  await expect(fc).toContainText("0.5 ms");
});
