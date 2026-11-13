import { describe, expect, it } from "vitest";
import { assetsFor, fetchAsset, loadReleases, variantsFor, type Release } from "../src/lib/boot/releases";
// @ts-expect-error plain JS module of the Pages build
import { buildIndex, wanted } from "../scripts/fetch-firmware.mjs";

const files = (names: string[]) => names.map((file) => ({ file, size: 1, sha256: "" }));
const port: Release = { tag: "v2.1.0", name: "2.1.0", date: "2026-11-13", prerelease: false, original: false, url: "",
  assets: files(["forge-dsp-V30-96ELN-2.1.0.hex", "forge-dsp-V30-96LN-2.1.0.hex", "forge-dsp-V4x-96ELN-2.1.0.hex", "forge-dsp-V4x-96ELN-3-2.1.0.hex"]) };
const orig: Release = { ...port, tag: "0.0.1116000", original: true,
  assets: files(["forge-dsp-V30-96ELN-bascom-1.11.6000.hex", "forge-dsp-V30-96LN-bascom-1.11.6000.hex", "forge-dsp-V40-96ELN-bascom-1.11.6000.hex",
    "forge-dsp-V40-CORED8-bascom-1.11.6000.hex", "forge-dsp-V41-CORED8-bascom-1.11.6000.hex", "forge-dsp-V40-96ELN-3-bascom-1.11.6000.hex",
    "forge-dsp-V41-96ELN-3-bascom-1.11.6000.hex"]) };
const pick = (r: Release, m: string, p: string, c: boolean | null) => assetsFor(r, m, p, c).map((a) => a.file);

describe("firmware from the releases (#10)", () => {
  it("picks the build of the device", () => {
    expect(pick(port, "96ELN", "4.0", true)).toEqual(["forge-dsp-V4x-96ELN-2.1.0.hex"]);
    expect(pick(port, "96ELN", "4.0", false)).toEqual(["forge-dsp-V30-96ELN-2.1.0.hex"]);         // PCB 3.0, no Si5338
    expect(pick(port, "96ELN", "4.0", null)).toEqual(["forge-dsp-V4x-96ELN-2.1.0.hex", "forge-dsp-V30-96ELN-2.1.0.hex"]);
    expect(pick(port, "CORED8", "4.1", null)).toEqual(["forge-dsp-V4x-96ELN-2.1.0.hex"]);
    expect(pick(port, "96ELN3", "4.0", null)).toEqual(["forge-dsp-V4x-96ELN-3-2.1.0.hex"]);
    expect(pick(port, "96LN", "3.0", null)).toEqual(["forge-dsp-V30-96LN-2.1.0.hex"]);
    expect(pick(orig, "CORED8", "4.1", null)).toEqual(["forge-dsp-V41-CORED8-bascom-1.11.6000.hex"]);
    expect(pick(orig, "96ELN3", "4.0", null)).toEqual(["forge-dsp-V40-96ELN-3-bascom-1.11.6000.hex"]);
    expect(pick(orig, "96ELN", "4.0", true)).toEqual(["forge-dsp-V40-96ELN-bascom-1.11.6000.hex"]);
    expect(variantsFor("XYZ", "1.0", null)).toEqual([]);
  });

  it("index of the Pages build: newest first, only releases with .hex, no drafts", () => {
    const rel = (tag_name: string, published_at: string, draft = false) => ({ tag_name, published_at, draft, name: tag_name, html_url: "", prerelease: false });
    const bytes = new TextEncoder().encode("abc");
    const idx = buildIndex([rel("v2.0.0", "2026-11-12"), rel("v2.1.0", "2026-11-13"), rel("v2.2.0", "2026-11-14", true),
      rel("toolchain-x", "2026-11-10"), rel("0.0.1116000", "2026-11-11")],
    { "v2.0.0": { "a.hex": bytes }, "v2.1.0": { "b.hex": bytes }, "0.0.1116000": { "c.hex": bytes } });
    expect(idx.releases.map((r: Release) => r.tag)).toEqual(["v2.1.0", "v2.0.0", "0.0.1116000"]);
    expect(idx.releases[0].assets[0]).toEqual({ file: "b.hex", size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    expect(idx.releases[2].original).toBe(true);
    expect(wanted("toolchain-avr-gcc-16.2.1-p1")).toBe(false);
  });

  it("loads from next to the page and checks the SHA-256", async () => {
    const text = ":00000001FF\n";
    const body = new TextEncoder().encode(text);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const r: Release = { ...port, assets: [{ file: "f.hex", size: body.length, sha256: sha }] };
    const served: Record<string, string> = { "./firmware/index.json": JSON.stringify({ releases: [r] }), "./firmware/v2.1.0/f.hex": text };
    const get = (async (url: string) => (served[url] !== undefined ? new Response(served[url]) : new Response("", { status: 404 }))) as typeof fetch;
    expect((await loadReleases("./firmware/", get))?.[0].tag).toBe("v2.1.0");
    expect(await fetchAsset(r, r.assets[0], "./firmware/", get)).toBe(text);
    await expect(fetchAsset({ ...r, assets: [{ ...r.assets[0], sha256: "00" }] }, { ...r.assets[0], sha256: "00" }, "./firmware/", get)).rejects.toThrow(/Prüfsumme/);
    expect(await loadReleases("./nothing/", get)).toBeNull();
  });
});
