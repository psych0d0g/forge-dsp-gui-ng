import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const commit = (process.env.GITHUB_SHA ?? git("rev-parse HEAD")).slice(0, 7) || "unknown";

// One self-contained index.html: the ESP32 serves exactly one (gzip) file from its flash, and
// GitHub Pages serves the same file below /<repo>/ (relative base, no absolute paths).
export default defineConfig({
  base: "./",
  plugins: [svelte(), viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(commit) },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/render/**"] },  // render tests: vitest.render.config.ts
});
