// Firmware releases next to the page (scripts/fetch-firmware.mjs in the Pages build): GitHub serves
// release assets without CORS headers, so the files come from the page's own origin, listed in
// ./firmware/index.json with their SHA-256.

export interface ReleaseAsset { file: string; size: number; sha256: string }
export interface Release {
  tag: string; name: string; date: string; prerelease: boolean; original: boolean; url: string;
  assets: ReleaseAsset[];
}

export const RELEASE_BASE = "./firmware/";

/** the index next to the page; null if there is none (local build, ESP32 bridge, demo) */
export async function loadReleases(base = RELEASE_BASE, get: typeof fetch = fetch): Promise<Release[] | null> {
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

/** load an asset from next to the page and check it against the index -> the .hex text */
export async function fetchAsset(rel: Release, a: ReleaseAsset, base = RELEASE_BASE, get: typeof fetch = fetch): Promise<string> {
  const r = await get(`${base}${encodeURIComponent(rel.tag)}/${encodeURIComponent(a.file)}`);
  if (!r.ok) throw new Error(`${a.file}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const sha = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
  if (bytes.length !== a.size || sha !== a.sha256) throw new Error(`${a.file}: Prüfsumme stimmt nicht mit dem Release überein`);
  return new TextDecoder().decode(bytes);
}
