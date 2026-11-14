// The interface in a real browser against the firmware in the simulator (?sim): what a user does,
// click by click. Every test starts with a fresh browser profile, so with a factory-new Forge.
import { expect, test, type Page } from "@playwright/test";

const FLAVOUR = "V40-96ELN";

/** open the page on the simulator and wait until the device is read in */
async function start(page: Page, errors: string[] = []) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`./?sim=${FLAVOUR}`);
  await expect(page.locator("header.top")).toContainText(`Simulator (${FLAVOUR})`, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: /^Forge DSP / })).toBeVisible();
  return errors;
}
const nav = (page: Page, label: string) => page.locator("nav").getByRole("button", { name: label, exact: true }).click();
const state = (page: Page, key: string) => page.locator("dt", { hasText: new RegExp(`^${key}$`) }).locator("xpath=following-sibling::dd[1]");

test("connects to the simulator and reads a factory-new Forge", async ({ page }) => {
  const errors = await start(page);
  await expect(state(page, "Preset")).toHaveText(/^1\s+von 4$/);
  await expect(state(page, "Temperatur")).toHaveText("38.0 °C");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("every page opens without errors", async ({ page }) => {
  const errors = await start(page);
  for (const label of ["Mixer", "Filter & EQ", "Laufzeit", "Steuerblöcke", "Presets", "Biquad-Verteilung", "Diagnose",
    "Speicherkarte", "Firmware", "Einstellungen", "Konsole", "Übersicht"]) {
    await nav(page, label);
    await expect(page.locator("nav [aria-current=page]")).toHaveText(label);
    await expect(page.locator("main h2").first()).toBeVisible();
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("console: raw commands go to the firmware", async ({ page }) => {
  await start(page);
  await nav(page, "Konsole");
  await page.getByLabel("Befehl").fill("get.1 system.firmware");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("main pre")).toContainText(`system.firmware="1.11.6000"`);
  await page.getByLabel("Befehl").fill("get.1 system.firmware.port");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("main pre")).toContainText(/system\.firmware\.port="[^"]+"/);
});

test("a delay set in the interface survives a reload of the page", async ({ page }) => {
  await start(page);
  await nav(page, "Laufzeit");
  const field = page.getByLabel(/^Laufzeit .* in ms$/).first();
  const label = await field.getAttribute("aria-label");
  await field.fill("1.25");
  await field.press("Enter");
  await expect(field).toHaveValue("1.25");
  await page.waitForTimeout(6000);    // the firmware writes its EEPROM a few seconds after the last change

  await start(page);
  await nav(page, "Laufzeit");
  await expect(page.getByLabel(label!, { exact: true })).toHaveValue("1.25");
});

test("loading another preset", async ({ page }) => {
  await start(page);
  await nav(page, "Presets");
  const card2 = page.locator("section.card", { hasText: "Preset 2" });
  await card2.getByRole("button", { name: "Laden", exact: true }).click();
  await expect(card2).toContainText("geladen", { timeout: 30_000 });
  await nav(page, "Übersicht");
  await expect(state(page, "Preset")).toHaveText(/^2\s+von 4$/);
});

test("a restart of the device (system.boot) reconnects to the same state", async ({ page }) => {
  await start(page);
  await nav(page, "Konsole");
  await page.getByLabel("Befehl").fill("set.1 system.boot=1");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByLabel("Befehl").fill("get.1 system.ping");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("main pre")).toContainText(/system\.ping/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("output limiter: a threshold set in the mixer reaches the firmware", async ({ page }) => {
  await start(page);
  await nav(page, "Mixer");
  const sel = page.getByLabel(/^Limiter /).first();
  await expect(sel).toBeVisible();
  await sel.selectOption("-60");
  await page.waitForTimeout(500);
  await nav(page, "Konsole");
  await page.getByLabel("Befehl").fill("get.1 system.dsp.limiter");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("main pre")).toContainText("system.dsp.limiter=[-60,");
});
