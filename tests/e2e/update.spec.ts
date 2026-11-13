// Firmware update in the demo (simulated bootloader and microSD): with a card in the Forge the
// firmware backs up flash, EEPROMs and DSP EEPROMs to it first (#19), nothing is downloaded.
import { expect, test } from "@playwright/test";

/** a small Intel HEX image with the identity strings of a 96ELN 4.0 port build */
function hex(): string {
  const data = Buffer.concat([Buffer.alloc(256, 0x0c), Buffer.from("\0" + "96ELN\0" + "4.0\0" + "-CCBYNCSA-20261113-MDD\0", "latin1")]);
  const lines: string[] = [];
  for (let a = 0; a < data.length; a += 16) {
    const chunk = data.subarray(a, a + 16);
    const rec = Buffer.concat([Buffer.from([chunk.length, a >> 8, a & 0xff, 0]), chunk]);
    const sum = (0x100 - (rec.reduce((s, b) => s + b, 0) & 0xff)) & 0xff;
    lines.push(":" + Buffer.concat([rec, Buffer.from([sum])]).toString("hex").toUpperCase());
  }
  return lines.join("\n") + "\n:00000001FF\n";
}

test("update with the backup on the card in the Forge", async ({ page }) => {
  await page.goto("./?demo&page=firmware");
  await expect(page.locator("main h2")).toHaveText("Firmware");
  await page.locator('input[type=file][accept=".hex"]').setInputFiles({ name: "forge-dsp-V4x-96ELN-9.9.9.hex", mimeType: "text/plain", buffer: Buffer.from(hex()) });
  await expect(page.getByText("Das Image kennt dieses Gerät (96ELN-4.0).")).toBeVisible();
  await expect(page.getByText(/auf die Speicherkarte im Forge, Platz 1/)).toBeVisible();
  const tick = page.getByLabel("Hinweise gelesen, dieses Image ist richtig");
  if (await tick.count()) await tick.check();
  let downloads = 0;
  page.on("download", () => downloads++);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Update starten" }).click();
  await expect(page.getByText(/^Fertig: \d+ Bytes geschrieben und geprüft/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Gesichert auf der Speicherkarte im Forge, Platz 1: FLASH_1\.BIN, EEPROM_1\.BIN, PRESET_1\.BIN, DSP1_1\.BIN/)).toBeVisible();
  expect(downloads).toBe(0);
});
