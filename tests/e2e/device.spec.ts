// Device settings (#26): the start-up and shutdown delays of the last control block reach the
// firmware (simulator). The block is fixed there: written set by set, not as a whole.
import { expect, test } from "@playwright/test";

test("switching on and off: delays reach the firmware", async ({ page }) => {
  await page.goto("./?sim=V40-96ELN");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  await page.locator("nav").getByRole("button", { name: "Geräteeinstellungen", exact: true }).click();
  const power = page.getByTestId("power");
  await expect(power).toBeVisible();
  const before = power.getByLabel("Wartezeit vor Remote Out an");
  await before.fill("0");
  await before.press("Enter");
  await expect(page.getByRole("status")).toContainText("Gespeichert");
  const off = power.getByLabel("Wartezeit bis Forge aus");
  await off.fill("2");
  await off.press("Enter");
  await page.waitForTimeout(300);
  await page.locator("nav").getByRole("button", { name: "Konsole", exact: true }).click();
  await page.getByLabel("Befehl").fill("get.1 modc.32.sets");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("main pre").locator("span").last()).toContainText(/modc\.32\.sets=\[0,\d+,\d+,8\]/);
});
