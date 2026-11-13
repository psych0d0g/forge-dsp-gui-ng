// Firmware releases for the desktop app: the main process may fetch from GitHub directly (no CORS),
// so it serves the same ./firmware/index.json and ./firmware/<tag>/<file> as the Pages build
// (scripts/fetch-firmware.mjs). Files are downloaded on first use and kept in the user data folder.
const { app, net } = require("electron");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO = "psych0d0g/forge-dsp-firmware";
const wanted = (tag) => /^v\d+\.\d+\.\d+$/.test(tag) || tag === "0.0.1116000";
const cacheDir = () => path.join(app.getPath("userData"), "firmware");

async function get(url, json) {
  const r = await net.fetch(url, { headers: { "User-Agent": "forge-dsp-desktop", Accept: json ? "application/vnd.github+json" : "application/octet-stream" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return json ? r.json() : Buffer.from(await r.arrayBuffer());
}

let releases = null;  // API list of this session
async function list() {
  if (!releases) releases = (await get(`https://api.github.com/repos/${REPO}/releases?per_page=100`, true)).filter((r) => !r.draft && wanted(r.tag_name));
  return releases;
}

/** an asset from the cache or GitHub -> bytes */
async function asset(rel, a) {
  const file = path.join(cacheDir(), rel.tag_name, a.name);
  if (fs.existsSync(file) && fs.statSync(file).size === a.size) return fs.readFileSync(file);
  const b = await get(a.browser_download_url, false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
  return b;
}

async function index() {
  const out = [];
  for (const r of (await list()).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))) {
    const hex = r.assets.filter((a) => a.name.endsWith(".hex"));
    if (!hex.length) continue;
    const assets = [];
    for (const a of hex.sort((x, y) => x.name.localeCompare(y.name))) {
      const b = await asset(r, a);
      assets.push({ file: a.name, size: b.length, sha256: createHash("sha256").update(b).digest("hex") });
    }
    out.push({ tag: r.tag_name, name: r.name || r.tag_name, date: (r.published_at ?? "").slice(0, 10), prerelease: !!r.prerelease,
      original: r.tag_name === "0.0.1116000", url: r.html_url, assets });
  }
  return { format: 1, repo: REPO, releases: out };
}

/** forge://app/firmware/... -> Response */
async function serve(rest) {
  try {
    if (rest === "index.json") return new Response(JSON.stringify(await index()), { headers: { "Content-Type": "application/json" } });
    const [tag, name] = rest.split("/").map(decodeURIComponent);
    const rel = (await list()).find((r) => r.tag_name === tag);
    const a = rel?.assets.find((x) => x.name === name);
    if (!a) return new Response("not found", { status: 404 });
    return new Response(await asset(rel, a), { headers: { "Content-Type": "application/octet-stream" } });
  } catch (e) {
    return new Response(String(e && e.message || e), { status: 502 });  // offline: the page offers only local files
  }
}

module.exports = { serve };
