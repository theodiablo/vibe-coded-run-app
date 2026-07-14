import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import { detectInitialLocale, isLangId, RC_LANG_KEY } from "./detect";
import { dayName, setLocale } from "./index";

// ---- key-set parity ---------------------------------------------------------
// A key present in en but missing in es/fr would silently fall back to English
// at runtime; fail CI instead. Extra keys in es/fr are equally a bug (dead
// weight or a typo'd key that will never be looked up).

type Tree = Record<string, unknown>;

function keyPaths(obj: Tree, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) ? keyPaths(v as Tree, path) : [path];
  });
}

// Interpolation slots must survive translation — a missing {{var}} renders a
// hole in the sentence for that locale.
function slots(obj: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      slots(v as Tree, path).forEach((sv, sk) => out.set(sk, sv));
    } else if (typeof v === "string") {
      const vars = [...v.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(",");
      out.set(path, vars);
    }
  }
  return out;
}

describe("locale dictionaries", () => {
  it.each([["es", es], ["fr", fr]] as const)("%s has the same key set as en", (_lang, dict) => {
    const enKeys = keyPaths(en).sort();
    const langKeys = keyPaths(dict as Tree).sort();
    expect(langKeys).toEqual(enKeys);
  });

  it.each([["es", es], ["fr", fr]] as const)("%s keeps every en interpolation slot", (_lang, dict) => {
    const enSlots = slots(en);
    const langSlots = slots(dict as Tree);
    for (const [key, vars] of enSlots) {
      expect(langSlots.get(key), `interpolation vars for ${key}`).toBe(vars);
    }
  });
});

// ---- detection --------------------------------------------------------------

describe("detectInitialLocale", () => {
  afterEach(() => {
    localStorage.removeItem(RC_LANG_KEY);
    vi.unstubAllGlobals();
  });

  it("prefers the stored override", () => {
    localStorage.setItem(RC_LANG_KEY, "fr");
    vi.stubGlobal("navigator", { language: "es-MX" });
    expect(detectInitialLocale()).toBe("fr");
  });

  it("falls back to the browser language prefix", () => {
    vi.stubGlobal("navigator", { language: "es-MX" });
    expect(detectInitialLocale()).toBe("es");
  });

  it("defaults to en for unsupported languages", () => {
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(detectInitialLocale()).toBe("en");
  });

  it("ignores garbage in localStorage", () => {
    localStorage.setItem(RC_LANG_KEY, "xx");
    vi.stubGlobal("navigator", { language: "de" });
    expect(detectInitialLocale()).toBe("en");
  });

  it("isLangId accepts exactly the supported set", () => {
    expect(isLangId("en") && isLangId("es") && isLangId("fr")).toBe(true);
    expect(isLangId("de")).toBe(false);
    expect(isLangId(null)).toBe(false);
  });
});

// ---- setLocale side-effects --------------------------------------------------

describe("setLocale", () => {
  beforeEach(() => localStorage.removeItem(RC_LANG_KEY));
  afterEach(async () => {
    await setLocale("en", { persist: false });
    localStorage.removeItem(RC_LANG_KEY);
  });

  it("sets <html lang> and persists rc_lang", async () => {
    await setLocale("es");
    expect(document.documentElement.lang).toBe("es");
    expect(localStorage.getItem(RC_LANG_KEY)).toBe("es");
  });

  it("skips persistence when asked (boot detection)", async () => {
    await setLocale("fr", { persist: false });
    expect(document.documentElement.lang).toBe("fr");
    expect(localStorage.getItem(RC_LANG_KEY)).toBeNull();
  });

  it("localizes weekday labels", async () => {
    expect(dayName(0)).toBe("Mon");
    await setLocale("fr", { persist: false });
    expect(dayName(0).toLowerCase().startsWith("lun")).toBe(true);
    expect(dayName(6).toLowerCase().startsWith("dim")).toBe(true);
  });
});
