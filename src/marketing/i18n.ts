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
