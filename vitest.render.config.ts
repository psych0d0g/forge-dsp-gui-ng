// Render tests (tests/render): the pages in a DOM (happy-dom) with the browser build of Svelte.
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ["browser"] },
  test: { include: ["tests/render/**/*.test.ts"], environment: "happy-dom" },
});
