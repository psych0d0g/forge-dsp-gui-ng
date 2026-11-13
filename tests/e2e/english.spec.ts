// The interface in English (#18): every page against the simulator, and no German left in what
// is shown (texts, titles, labels). The device's own strings (identity, file names) are not German.
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "en-US" });

const PAGES = ["Overview", "Mixer", "Filters & EQ", "Delay", "Control blocks", "Presets", "Biquad allocation", "Diagnostics",
  "Memory card", "Firmware", "Settings", "Console"];
/** German words and letters that do not occur in English UI text */
const GERMAN = /[äöüÄÖÜß„“]|\b(und|der|die|das|nicht|mit|für|auf|ist|wird|oder|Gerät|Kanal|Ausgang|Eingang|Einstellungen|Datei|Wert|keine?)\b/;

async function germanLeft(page: Page): Promise<string[]> {
  return page.evaluate((re) => {
    const rx = new RegExp(re);
    const found = new Set<string>();
    const walk = document.createTreeWalker(document.querySelector(".shell")!, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = (n.textContent ?? "").trim();
      if (s && rx.test(s) && !(n.parentElement?.closest("pre, code, option[value]:not([value=''])") && /^[<>→←]/.test(s))) found.add(s.slice(0, 120));
    }
    for (const el of Array.from(document.querySelectorAll("[title], [aria-label], [placeholder]")))
      for (const a of ["title", "aria-label", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v && rx.test(v)) found.add(`${a}: ${v.slice(0, 120)}`);
      }
    return [...found];
  }, GERMAN.source);
}

for (const [what, url] of [["simulator", "./?sim=V40-96ELN&lang=en"], ["demo", "./?demo&lang=en"]])
test(`every page in English, without German left (${what})`, async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 30_000 });
  const left: Record<string, string[]> = {};
  for (const label of PAGES) {
    await page.locator("nav").getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("nav [aria-current=page]")).toHaveText(label);
    await page.waitForTimeout(what === "demo" ? 1200 : 300);   // the demo answers diagnostics and card reads
    // one line per kind of text: numbers and channel numbers folded
    const g = [...new Set((await germanLeft(page)).map((x) => x.replace(/\d+/g, "#")))];
    if (g.length) left[label] = g;
  }
  expect(left).toEqual({});
});

test("the language can be switched in the header and is kept", async ({ page }) => {
  await page.goto("./?demo");
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await page.getByRole("button", { name: "Language" }).click();
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible();
  await page.reload();                                       // ?demo connects again, now in German
  await expect(page.getByRole("button", { name: "Trennen" })).toBeVisible();
});
