// Several Forge in the RS485 chain (#15), with the demo: a CORE D8 answers as device 2.
import { expect, test } from "@playwright/test";

test("finds the second device and shows it", async ({ page }) => {
  await page.goto("./?demo");
  const sel = page.getByLabel("Gerät in der Kette");
  await expect(sel).toBeVisible({ timeout: 15_000 });
  await expect(sel.locator("option")).toHaveText(["Gerät 1: 96ELN", "Gerät 2: CORED8"]);
  await sel.selectOption("2");
  await expect(page.locator("header.top strong")).toHaveText("Forge DSP CORED8");
  await page.locator("nav").getByRole("button", { name: "Firmware", exact: true }).click();
  await expect(page.getByText(/Das Update geht nur für Gerät 1/)).toBeVisible();
  await sel.selectOption("1");
  await expect(page.locator("header.top strong")).toHaveText("Forge DSP 96ELN");
});
