import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";
import { PLAY_STORE_URL, APP_STORE_URL } from "../constants";
import { isIos, isAndroid } from "../native";

// The platform's own store listing; empty when unknown (APP_STORE_URL is blank
// until the App Store record exists), in which case the buttons hide rather
// than dead-link — the copy still tells the user to update.
const storeUrl = () => (isIos ? APP_STORE_URL : PLAY_STORE_URL);

// Open the store listing.
// Android must NOT go through @capacitor/browser: its Chrome Custom Tabs path
// (an extra translucent BrowserControllerActivity + custom-tabs service
// binding) only catches ActivityNotFoundException natively, so any other
// runtime failure launching the tab kills the process — tapping "Update"
// crashed the app on-device. A plain top-frame navigation is intercepted by
// Capacitor's WebViewClient (Bridge.launchIntent): external hosts never load
// in the WebView, they're handed to the OS as an ACTION_VIEW intent — which
// the Play Store app claims for its own listing URL — with
// ActivityNotFoundException caught inside Capacitor. No plugin, no extra
// activity, and the store opens as the app, not a browser tab.
// iOS keeps Browser.open (SFSafariViewController, same as the OAuth flow),
// falling back to a normal new tab.
async function openStore() {
  const url = storeUrl();
  if (!url) return;
  if (isAndroid) {
    window.location.assign(url);
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } catch { window.open(url, "_blank", "noopener"); }
}

// Hard gate: the installed app is below the minimum supported version (e.g. after
// a breaking backend change). Full-screen and non-dismissible — the user must
// update to continue.
export function UpdateRequired() {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[3000] bg-slate-900 flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-500/15 flex items-center justify-center">
          <Download className="text-orange-400" size={24} />
        </div>
        <h1 className="text-xl font-bold text-white">{t("app.update.requiredTitle")}</h1>
        <p className="text-sm text-slate-400">
          {t("app.update.requiredBody")}
        </p>
        {storeUrl() && (
          <button onClick={openStore}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors">
            {t("app.update.updateNow")}
          </button>
        )}
      </div>
    </div>
  );
}

// Soft nudge: a newer version is available but the current one still works.
// Dismissible top bar.
export function UpdateBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[2500] bg-orange-500 text-white text-sm px-4 py-2 flex items-center gap-3 shadow-lg">
      <span className="flex-1">{t("app.update.available")}</span>
      {storeUrl() && (
        <button onClick={openStore} className="font-semibold underline whitespace-nowrap">{t("app.update.update")}</button>
      )}
      <button onClick={() => setDismissed(true)} aria-label={t("app.update.dismiss")} className="p-1 -mr-1 hover:opacity-80">
        <X size={16} />
      </button>
    </div>
  );
}
