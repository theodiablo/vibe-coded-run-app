import { useState, useEffect } from "react";
import { Watch, Loader, Check, RefreshCw } from "lucide-react";
import { watchImportSource, hasWatchAuthorization } from "../watch/import";
import { BetaBadge } from "../components/BetaBadge";
import type { SettingsState } from "../types";

type WatchImportProps = {
  settings: SettingsState;
  saveSettings: (settings: SettingsState) => void;
  showToast?: (msg: string, type?: string) => void;
  // Manual "scan older runs" — returns how many new runs were found.
  scanWatchNow?: () => Promise<number>;
};

// Import finished runs (distance, duration, elevation, heart rate) from a watch
// via Android Health Connect — for runners who leave their phone at home. Nested
// in Settings → Profile (native only). The method *preference* syncs in
// settings.watchImport; the actual Health Connect grant is per-device
// (WATCH_HC_AUTH_KEY), so a synced preference alone never reads the bridge.
export function WatchImport({ settings, saveSettings, showToast, scanWatchNow }: WatchImportProps) {
  const enabled = !!settings.watchImport;
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // null = unknown/checking. Whether this device currently holds the HC grant.
  const [connected, setConnected] = useState<boolean | null>(null);

  // Reflect whether Health Connect exercise-read access is already granted here
  // (non-prompting), so Settings shows a persistent connected state.
  useEffect(() => {
    if (!enabled) return; // when off, `authed` is already false via `enabled`
    let cancelled = false;
    watchImportSource.checkPermissions().then(ok => { if (!cancelled) setConnected(ok); });
    return () => { cancelled = true; };
  }, [enabled]);

  const connect = async () => {
    setBusy(true);
    try {
      const status = await watchImportSource.availability();
      if (status === "NotSupported") {
        showToast?.("Health Connect isn't supported on this device (needs Android 14+).", "err");
        return;
      }
      const ok = await watchImportSource.requestPermissions();
      setConnected(ok);
      if (ok) {
        saveSettings({ ...settings, watchImport: true });
        showToast?.("Connected — your watch runs will appear here after they sync.");
        // Instant payoff: scan straight away for anything already in Health Connect.
        scanWatchNow?.().then(n => { if (!n) showToast?.("No new runs to import yet."); }).catch(() => {});
      } else {
        showToast?.(
          status === "NotInstalled"
            ? "Install Health Connect from Google Play, then tap Connect again."
            : "Access wasn't granted. In Health Connect, allow Running Coach to read Exercise, Distance, Elevation and Heart rate.",
          "err");
      }
    } catch {
      showToast?.("Couldn't open Health Connect. Make sure it's installed and up to date.", "err");
    } finally {
      setBusy(false);
    }
  };

  const disable = () => {
    saveSettings({ ...settings, watchImport: false });
    setConnected(false);
  };

  const scanOlder = async () => {
    if (!scanWatchNow) return;
    setScanning(true);
    try {
      const n = await scanWatchNow();
      if (!n) showToast?.("No new runs found in the last 30 days.");
    } catch {
      showToast?.("Couldn't read from Health Connect.", "err");
    } finally {
      setScanning(false);
    }
  };

  const authed = enabled && (connected || hasWatchAuthorization());

  return (
    <div className="space-y-3 pt-2 border-t border-slate-700/60">
      <div className="flex items-center gap-2 pt-1">
        <Watch size={14} className="text-orange-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Runs from your watch</p>
        <BetaBadge label="New beta" />
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        Import finished runs — distance, time, elevation and heart rate — from a
        Garmin or other watch, so you don&apos;t have to carry your phone.
      </p>

      {authed ? (
        <>
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-emerald-300">
            <Check size={15} className="shrink-0" />
            <span>Connected — new runs are offered for import automatically.</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={scanOlder} disabled={scanning}
              className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
              {scanning ? <Loader size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Scan last 30 days
            </button>
            <button type="button" onClick={disable}
              className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-300">
              Turn off
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={connect} disabled={busy}
          className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader size={15} className="animate-spin" /> : <Watch size={15} />}
          Connect Health Connect
        </button>
      )}

      <p className="text-xs text-slate-500">
        In the Garmin Connect app, turn on Health Connect (Settings → Health
        Connect; needs Android 14+). Runs sync a few minutes after your watch
        syncs. No route/map is included — heart rate, pace and elevation are.
      </p>
    </div>
  );
}
