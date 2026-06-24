import { useState } from "react";
import { Download, X } from "lucide-react";
import { PLAY_STORE_URL } from "../constants";

// Open the Play Store listing (native: in the Play app via the system browser
// handler; falls back to a normal new tab if the plugin isn't available).
async function openStore() {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: PLAY_STORE_URL });
  } catch { window.open(PLAY_STORE_URL, "_blank", "noopener"); }
}

// Hard gate: the installed app is below the minimum supported version (e.g. after
// a breaking backend change). Full-screen and non-dismissible — the user must
// update to continue.
export function UpdateRequired() {
  return (
    <div className="fixed inset-0 z-[3000] bg-slate-900 flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-500/15 flex items-center justify-center">
          <Download className="text-orange-400" size={24} />
        </div>
        <h1 className="text-xl font-bold text-white">Update required</h1>
        <p className="text-sm text-slate-400">
          This version of Running Coach is no longer supported. Please update to the
          latest version to keep using the app.
        </p>
        <button onClick={openStore}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors">
          Update now
        </button>
      </div>
    </div>
  );
}

// Soft nudge: a newer version is available but the current one still works.
// Dismissible top bar.
export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[2500] bg-orange-500 text-white text-sm px-4 py-2 flex items-center gap-3 shadow-lg">
      <span className="flex-1">A new version of Running Coach is available.</span>
      <button onClick={openStore} className="font-semibold underline whitespace-nowrap">Update</button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="p-1 -mr-1 hover:opacity-80">
        <X size={16} />
      </button>
    </div>
  );
}
