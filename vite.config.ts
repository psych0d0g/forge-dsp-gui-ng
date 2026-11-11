import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained index.html: the ESP32 serves exactly one (gzip) file from its flash.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { include: ["tests/**/*.test.ts"] },
});
