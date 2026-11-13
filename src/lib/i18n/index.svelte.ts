// Languages of the interface (#18). Texts live in de.ts (all keys) and en.ts (Record<Key, string>,
// complete by type). t("section.name", { n }) for a key in the code; tk("…") marks a key in a
// table that is shown later with tx(label); tx() also passes any text that is no key unchanged.
// The language comes from the browser, can be switched in the header or the settings and is kept
// in localStorage; ?lang=en forces it.
import { DE, type Key } from "./de";
import { EN } from "./en";

export type { Key };
export type Lang = "de" | "en";
export const LANGS: { code: Lang; name: string }[] = [{ code: "de", name: "Deutsch" }, { code: "en", name: "English" }];
const TEXTS: Record<Lang, Record<Key, string>> = { de: DE, en: EN };

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "de" || q === "en") return q;
    const s = localStorage.getItem("lang");
    if (s === "de" || s === "en") return s;
  } catch { /* no window or storage */ }
  return typeof navigator !== "undefined" && !/^de\b/i.test(navigator.language ?? "de") ? "en" : "de";
}

export const i18n = $state({ lang: (typeof window === "undefined" ? "de" : initial()) as Lang });
if (typeof document !== "undefined") document.documentElement.lang = i18n.lang;

export function setLang(l: Lang) {
  i18n.lang = l;
  try { localStorage.setItem("lang", l); } catch { /* private mode */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** the text of a key in the current language, {name} placeholders filled from vars */
export function t(key: Key, vars?: Vars): string {
  return fill(TEXTS[i18n.lang][key] ?? DE[key], vars);
}
/** like t() for a key held in a variable (tables marked with tk); a text that is no key stays as it is */
export function tx(key: string, vars?: Vars): string {
  return fill((TEXTS[i18n.lang] as Record<string, string>)[key] ?? key, vars);
}
/** marks a key in a table: shown later with tx(); returns the key */
export const tk = (key: Key): Key => key;
