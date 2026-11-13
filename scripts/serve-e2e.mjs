// Static server for the end-to-end tests: dist/ (the built page) and tests/sim/ below /sim/, the
// layout of the Pages site.   node scripts/serve-e2e.mjs [PORT]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml" };
const port = Number(process.argv[2] ?? 4180);

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (path.includes("..")) { res.writeHead(400).end(); return; }
  if (path.endsWith("/")) path += "index.html";
  if (path === "/firmware/index.json") {   // the Pages build copies the firmware releases here: none in the tests
    res.writeHead(200, { "Content-Type": TYPES[".json"] }).end(JSON.stringify({ format: 1, repo: "psych0d0g/forge-dsp-firmware", releases: [] }));
    return;
  }
  const file = path.startsWith("/sim/") ? join("tests", path) : join("dist", path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`e2e server on :${port}`));
