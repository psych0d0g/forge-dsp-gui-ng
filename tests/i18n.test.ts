// Languages (#18): en.ts is complete by type (Record<Key, string>); here: same placeholders in both
// languages, every key used somewhere in the sources, and every key in the sources defined.
import { describe, expect, it } from "vitest";
import { DE } from "../src/lib/i18n/de";
import { EN } from "../src/lib/i18n/en";

const sources = Object.values(import.meta.glob(["../src/**/*.ts", "../src/**/*.svelte", "!../src/lib/i18n/**"],
  { query: "?raw", import: "default", eager: true }) as Record<string, string>).join("\n");
const used = new Set([...sources.matchAll(/\bt[kx]?\(\s*"([a-z]+\.[A-Za-z0-9]+)"/g)].map((m) => m[1]));
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

describe("language files (#18)", () => {
  it("has the texts", () => expect(Object.keys(DE).length).toBeGreaterThan(700));
  it("same placeholders in German and English", () => {
    expect(Object.keys(DE).filter((k) => holes(DE[k as keyof typeof DE]) !== holes(EN[k as keyof typeof DE]))).toEqual([]);
  });
  it("every key is used", () => expect(Object.keys(DE).filter((k) => !used.has(k))).toEqual([]));
  it("every key in the sources exists", () => expect([...used].filter((k) => !(k in DE))).toEqual([]));
});
