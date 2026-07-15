// Marketing i18n — a SEPARATE i18next namespace ("marketing"), registered here
// and imported only by MarketingGate. Because this module lives in the web-only
// marketing chunk (MarketingGate is dynamically imported and constant-folded to
// null in the native build via VITE_NATIVE_BUILD), these strings — and the
// es/fr marketing dictionaries — never ship in the APK. The app's own strings
// stay in the default "translation" namespace (bundled/lazy per locale).
//
// The English bundle takes brand + hero headline from copy.json, the single
// source shared with the OG-image generator, so the page and the social card
// can't drift. es/fr provide their own translated hero lines.
import i18n from "i18next";
import { RC_LANG_KEY, setLocale, isLangId, type LangId } from "../i18n";
import copy from "./copy.json";
import en from "./marketing.en.json";
import es from "./marketing.es.json";
import fr from "./marketing.fr.json";

let registered = false;

// Register once; idempotent so re-mounting MarketingGate is cheap.
export function ensureMarketingI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("en", "marketing", {
    ...en,
    brand: copy.brand,
    heroLine1: copy.heroLine1,
    heroLine2: copy.heroLine2,
  }, true, true);
  i18n.addResourceBundle("es", "marketing", es, true, true);
  i18n.addResourceBundle("fr", "marketing", fr, true, true);
}

// Language switch for the marketing page. The es/fr *marketing* dictionaries are
// static imports registered above, so they're already in memory — switching the
// visible landing copy is instant and can't fail. We deliberately DON'T route
// this through the app-wide setLocale on the critical path: that would download
// the full ~50KB app "translation" chunk (which the landing page doesn't use)
// just to flip the footer, and its dynamic import can fail — leaving a tap that
// silently does nothing. Instead we flip immediately here, persist the choice,
// then warm the app bundle in the background (best-effort) so the LoginScreen —
// the one landing surface that uses the app namespace — is localized by the time
// it's opened. A failed warm just leaves the login modal in English.
export function setMarketingLocale(lang: LangId): void {
  if (!isLangId(lang)) return;
  void i18n.changeLanguage(lang); // marketing bundle already present → instant
  document.documentElement.lang = lang;
  try { localStorage.setItem(RC_LANG_KEY, lang); } catch { /* private mode */ }
  void setLocale(lang); // warm the app "translation" chunk for LoginScreen
}
