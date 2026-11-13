import { isNative, nativeGet } from "../native";
// Firmware releases next to the page (scripts/fetch-firmware.mjs in the Pages build): GitHub serves
// release assets without CORS headers, so the files come from the page's own origin, listed in
// ./firmware/index.json with their SHA-256.

export interface ReleaseAsset { file: string; size: number; sha256: string }
export interface Release {
  tag: string; name: string; date: string; prerelease: boolean; original: boolean; url: string;
  assets: ReleaseAsset[];
}

export const RELEASE_BASE = "./firmware/";
export const FIRMWARE_REPO = "psych0d0g/forge-dsp-firmware";

interface ApiRelease { tag_name: string; name: string | null; published_at: string | null; draft: boolean; prerelease: boolean;
  html_url: string; assets: { name: string; size: number; digest?: string | null }[] }

/** releases of the firmware from the GitHub API, as the Pages build lists them (scripts/fetch-firmware.mjs) */
export function releasesFromApi(list: ApiRelease[]): Release[] {
  return list
    .filter((r) => !r.draft && (/^v\d+\.\d+\.\d+$/.test(r.tag_name) || r.tag_name === "0.0.1116000"))
    .map((r) => ({
      tag: r.tag_name, name: r.name || r.tag_name, date: (r.published_at ?? "").slice(0, 10), prerelease: r.prerelease,
      original: r.tag_name === "0.0.1116000", url: r.html_url,
      assets: r.assets.filter((a) => a.name.endsWith(".hex")).sort((x, y) => x.name.localeCompare(y.name))
        .map((a) => ({ file: a.name, size: a.size, sha256: (a.digest ?? "").replace(/^sha256:/, "") })),
    }))
    .filter((r) => r.assets.length)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function nativeReleases(): Promise<Release[]> {
  const raw = await nativeGet(`https://api.github.com/repos/${FIRMWARE_REPO}/releases?per_page=100`);
  return releasesFromApi(JSON.parse(new TextDecoder().decode(raw)));
}

/** the index next to the page; null if there is none (local build, ESP32 bridge, demo).
 * In the desktop app straight from the GitHub API (no CORS there; the API gives each file's SHA-256). */
export async function loadReleases(base = RELEASE_BASE, get: typeof fetch = fetch): Promise<Release[] | null> {
  if (isNative() && base === RELEASE_BASE) return nativeReleases().catch(() => null);
  try {
    const r = await get(`${base}index.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.releases) ? (j.releases as Release[]) : null;
  } catch {
    return null;
  }
}

/**
 * Build variants a device can take, best first. model/pcb from system.key.info; hasClock tells the
 * 96ELN PCB 3.0 (no Si5338) from 4.x, which both report "96ELN-4.0" (null = unknown: both).
 * Port releases name the builds V30-96LN, V30-96ELN, V4x-96ELN (also CORE D8), V4x-96ELN-3; the
 * original release names every board (V40-96ELN, V41-CORED8, …).
 */
export function variantsFor(model: string, pcb: string, hasClock: boolean | null): string[] {
  const v4 = pcb.startsWith("4.") ? `V${pcb.replace(".", "")}` : "";
  switch (model) {
    case "96LN": return ["V30-96LN"];
    case "96ELN": {
      const v40 = ["V4x-96ELN", "V40-96ELN"], v30 = ["V30-96ELN"];
      return hasClock === true ? v40 : hasClock === false ? v30 : [...v40, ...v30];
    }
    case "96ELN3": return ["V4x-96ELN-3", v4 && `${v4}-96ELN-3`].filter(Boolean);
    case "CORED8": return ["V4x-96ELN", v4 && `${v4}-CORED8`].filter(Boolean);
  }
  return [];
}

const variantOf = (file: string) => /^forge-dsp-(V[0-9x]{2}-[0-9A-Z]+(?:-3)?)-/i.exec(file)?.[1] ?? "";

/** the assets of a release that fit the device, best first */
export function assetsFor(rel: Release, model: string, pcb: string, hasClock: boolean | null): ReleaseAsset[] {
  const want = variantsFor(model, pcb, hasClock);
  return want.flatMap((v) => rel.assets.filter((a) => variantOf(a.file).toUpperCase() === v.toUpperCase()));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** load an asset from next to the page (desktop app: from GitHub) and check it against the index -> the .hex text */
export async function fetchAsset(rel: Release, a: ReleaseAsset, base = RELEASE_BASE, get: typeof fetch = fetch): Promise<string> {
  let bytes: Uint8Array;
  if (isNative() && base === RELEASE_BASE) {
    bytes = await nativeGet(`https://github.com/${FIRMWARE_REPO}/releases/download/${encodeURIComponent(rel.tag)}/${encodeURIComponent(a.file)}`);
  } else {
    const r = await get(`${base}${encodeURIComponent(rel.tag)}/${encodeURIComponent(a.file)}`);
    if (!r.ok) throw new Error(`${a.file}: HTTP ${r.status}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const sha = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
  if (bytes.length !== a.size || (a.sha256 && sha !== a.sha256)) throw new Error(`${a.file}: Prüfsumme stimmt nicht mit dem Release überein`);
  return new TextDecoder().decode(bytes);
}
