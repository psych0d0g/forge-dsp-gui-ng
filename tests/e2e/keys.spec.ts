// Keyboard shortcuts (#24): outputs, the overview, Filters & EQ.
import { expect, test } from "@playwright/test";

test("1 … 8 mute, P + number polarity, M all; the firmware gets it (simulator)", async ({ page }) => {
  await page.goto("./?sim=V40-96ELN");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible({ timeout: 30_000 });
  await page.locator("main h2").first().click();
  await page.keyboard.press("2");
  await page.keyboard.down("p"); await page.keyboard.press("3"); await page.keyboard.up("p");
  await page.waitForTimeout(400);
  await page.locator("nav").getByRole("button", { name: "Konsole", exact: true }).click();
  const ask = async (reg: string) => {
    await page.getByLabel("Befehl").fill(`get.1 ${reg}`);
    await page.getByRole("button", { name: "Senden" }).click();
  };
  await ask("mute.out");
  await expect(page.locator("main pre")).toContainText("mute.out=[0,1,0,0,0,0,0,0]");
  await ask("phase.out");
  await expect(page.locator("main pre")).toContainText("phase.out=[0,0,1,0,0,0,0,0]");
  await page.locator("main h2").click();
  await page.keyboard.press("m");                                  // all muted
  await page.waitForTimeout(400);
  await ask("mute.out");
  await expect(page.locator("main pre")).toContainText("mute.out=[1,1,1,1,1,1,1,1]");
  await page.locator("main h2").click();
  await page.keyboard.press("m");                                  // as before
  await page.waitForTimeout(400);
  await ask("mute.out");
  await expect(page.locator("main pre").locator("span").last()).toContainText("mute.out=[0,1,0,0,0,0,0,0]");
});

test("the overview: ? and the link in the footer; Ctrl+number opens pages", async ({ page }) => {
  await page.goto("./?demo");
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Tastenkürzel" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("footer").getByRole("button", { name: "Tastenkürzel" }).click();
  await expect(page.getByRole("dialog", { name: "Tastenkürzel" })).toContainText("P + 1 … 8");
  await page.getByRole("dialog").getByRole("button", { name: "Schließen" }).click();
  await page.keyboard.press("Control+4");
  await expect(page.locator("nav [aria-current=page]")).toHaveText("Laufzeit");
});

test("Filters & EQ: F2 output 2, arrows choose a band and move its level, F its frequency (demo)", async ({ page }) => {
  await page.goto("./?demo&page=filters");
  await expect(page.locator("main h2")).toHaveText("Filter & EQ");
  await page.locator("main h2").click();
  await page.keyboard.press("F2");
  await expect(page.locator(".chans [aria-selected=true]")).toContainText("2");
  await page.keyboard.press("ArrowRight");
  const strip = page.locator(".strip.sel");
  await expect(strip).toHaveCount(1);
  const gain = strip.locator('input[data-k="gain"]');
  const before = Number(await gain.inputValue());
  await page.keyboard.press("ArrowUp");
  await expect(gain).toHaveValue(String(Math.round((before + 0.1) * 10) / 10));
  await page.keyboard.press("Shift+ArrowDown");
  await expect(gain).toHaveValue(String(Math.round((before - 0.9) * 10) / 10));
  await page.keyboard.press("f");
  await expect(strip.locator('input[data-k="f"]')).toBeFocused();
});
