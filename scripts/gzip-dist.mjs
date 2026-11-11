// dist/index.html -> dist/index.html.gz (served by the ESP32 with Content-Encoding: gzip)
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, constants } from "node:zlib";

const html = readFileSync("dist/index.html");
const gz = gzipSync(html, { level: constants.Z_BEST_COMPRESSION });
writeFileSync("dist/index.html.gz", gz);
console.log(`index.html ${html.length} B, gzip ${gz.length} B`);
