// Locale detection for pre-auth surfaces (marketing, login, consent banner):
// the synced settings blob only exists after sign-in, so the boot locale comes
// from a per-device localStorage override (written whenever the user explicitly
// picks a language) falling back to the browser language. Mirrors the telemetry
// consent pattern: per-device key, try/catch around storage access.

export type LangId = "en" | "es" | "fr";
export const LANG_IDS: readonly LangId[] = ["en", "es", "fr"];

export const RC_LANG_KEY = "rc_lang";

export const isLangId = (v: unknown): v is LangId =>
  LANG_IDS.includes(v as LangId);

export function getStoredLang(): LangId | null {
  try {
    const v = localStorage.getItem(RC_LANG_KEY);
    return isLangId(v) ? v : null;
  } catch {
    return null;
  }
}

export function detectInitialLocale(): LangId {
  const stored = getStoredLang();
  if (stored) return stored;
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  const prefix = nav.slice(0, 2).toLowerCase();
  return isLangId(prefix) ? prefix : "en";
}
