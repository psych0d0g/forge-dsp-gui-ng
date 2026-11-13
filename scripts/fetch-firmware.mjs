// Firmware releases next to the page (GitHub Pages build): GitHub serves release assets without
// CORS headers, so the browser cannot load them from github.com. This script copies the .hex files
// of every release of the firmware repository to <out>/<tag>/ and writes <out>/index.json; the page
// then loads them from its own origin and checks the SHA-256 from the index before flashing.
//
//   node scripts/fetch-firmware.mjs OUT_DIR [owner/repo]     (GITHUB_TOKEN optional, raises the rate limit)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "psych0d0g/forge-dsp-firmware";

/** which releases are offered: the port releases (v1.2.3) and the original firmware (0.0.1116000) */
export const wanted = (tag) => /^v\d+\.\d+\.\d+$/.test(tag) || tag === "0.0.1116000";

/**
 * index.json from the API's release list and the downloaded files ({tag: {file: bytes}}):
 * newest first, drafts left out, only .hex files, with SHA-256 and size.
 */
export function buildIndex(releases, files) {
  return {
    format: 1,
    repo: REPO,
    releases: releases
      .filter((r) => !r.draft && wanted(r.tag_name) && files[r.tag_name])
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
      .map((r) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        date: (r.published_at ?? "").slice(0, 10),
        prerelease: !!r.prerelease,
        original: r.tag_name === "0.0.1116000",
        url: r.html_url,
        assets: Object.entries(files[r.tag_name])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, bytes]) => ({ file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })),
      })),
  };
}

async function get(url, json) {
  const headers = { "User-Agent": "forge-dsp-gui-ng-pages", Accept: json ? "application/vnd.github+json" : "application/octet-stream" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return json ? r.json() : new Uint8Array(await r.arrayBuffer());
}

async function main(out, repo = REPO) {
  const releases = await get(`https://api.github.com/repos/${repo}/releases?per_page=100`, true);
  const files = {};
  for (const r of releases) {
    if (r.draft || !wanted(r.tag_name)) continue;
    for (const a of r.assets.filter((a) => a.name.endsWith(".hex"))) {
      const bytes = await get(a.browser_download_url, false);
      mkdirSync(join(out, r.tag_name), { recursive: true });
      writeFileSync(join(out, r.tag_name, a.name), bytes);
      (files[r.tag_name] ??= {})[a.name] = bytes;
    }
  }
  const index = buildIndex(releases, files);
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1));
  console.log(index.releases.map((r) => `${r.tag}: ${r.assets.length} files`).join("\n"));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (!process.argv[2]) {
    console.error("usage: node scripts/fetch-firmware.mjs OUT_DIR [owner/repo]");
    process.exit(2);
  }
  main(process.argv[2], process.argv[3]).catch((e) => { console.error(e.message); process.exit(1); });
}
