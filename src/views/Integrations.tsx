import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Watch, Loader, Check, RefreshCw } from "lucide-react";
import { connectableProviders } from "../imports/registry";
import { BetaBadge } from "../components/BetaBadge";
import type { ImportProvider } from "../imports/types";
import type { SettingsState } from "../types";

type IntegrationsProps = {
  settings: SettingsState;
  saveSettings: (settings: SettingsState) => void;
  showToast?: (msg: string, type?: string) => void;
  // Manual wider-window scan across all providers — returns how many runs it found.
  scanImportsNow?: () => Promise<number>;
};

// Where is a provider's synced enable-flag? Health Connect predates the registry
// and keeps its own settings.watchImport key (don't churn the synced blob);
// anything newer lands in the settings.imports map.
type ImportsFlags = Record<string, boolean>;
function providerEnabled(settings: SettingsState, id: string): boolean {
  if (id === "healthconnect") return !!settings.watchImport;
  return !!(settings.imports as ImportsFlags | undefined)?.[id];
}
function withProviderEnabled(settings: SettingsState, id: string, on: boolean): SettingsState {
  if (id === "healthconnect") return { ...settings, watchImport: on };
  return { ...settings, imports: { ...(settings.imports as ImportsFlags | undefined), [id]: on } };
}

// Import integrations, nested in Settings → Profile. Driven by the provider
// registry: every *connectable* available provider gets a row (file import is
// not a connection — it lives in the Record screen). Native-only today because
// the only connectable provider (Health Connect) is; a future cloud provider
// would surface here on web too.
export function Integrations({ settings, saveSettings, showToast, scanImportsNow }: IntegrationsProps) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  // Per-provider "this device is authorized" (null = still checking).
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await connectableProviders();
      if (cancelled) return;
      setProviders(list);
      for (const p of list) {
        const ok = p.isConnected ? await p.isConnected() : false;
        if (cancelled) return;
        setConnected(prev => ({ ...prev, [p.id]: !!ok }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const connect = async (p: ImportProvider) => {
    setBusyId(p.id);
    try {
      const ok = p.connect ? await p.connect() : false;
      setConnected(prev => ({ ...prev, [p.id]: ok }));
      if (ok) {
        saveSettings(withProviderEnabled(settings, p.id, true));
        showToast?.(t("settings.integrations.connectSuccess"));
        // Instant payoff: scan straight away for anything already waiting.
        scanImportsNow?.().then(n => { if (!n) showToast?.(t("settings.integrations.noNewRuns")); }).catch(() => {});
      } else {
        showToast?.(t("settings.integrations.accessDenied"), "err");
      }
    } catch {
      showToast?.(t("settings.integrations.connectFailed"), "err");
    } finally {
      setBusyId(null);
    }
  };

  const turnOff = (p: ImportProvider) => {
    saveSettings(withProviderEnabled(settings, p.id, false));
    setConnected(prev => ({ ...prev, [p.id]: false }));
    p.disconnect?.();
  };

  const scanOlder = async () => {
    if (!scanImportsNow) return;
    setScanning(true);
    try {
      const n = await scanImportsNow();
      if (!n) showToast?.(t("settings.integrations.noRuns30"));
    } catch {
      showToast?.(t("settings.integrations.scanFailed"), "err");
    } finally {
      setScanning(false);
    }
  };

  if (!providers.length) return null;

  return (
    <div className="space-y-3 pt-2 border-t border-slate-700/60">
      <div className="flex items-center gap-2 pt-1">
        <Watch size={14} className="text-orange-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t("settings.integrations.title")}</p>
        <BetaBadge label={t("settings.newBeta")} />
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        {t("settings.integrations.subtitle")}
      </p>

      {providers.map(p => {
        const on = providerEnabled(settings, p.id) && connected[p.id];
        return (
          <div key={p.id} className="space-y-2">
            {on ? (
              <>
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-emerald-300">
                  <Check size={15} className="shrink-0" />
                  <span>{t("settings.integrations.connectedRow", { label: p.label })}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={scanOlder} disabled={scanning}
                    className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
                    {scanning ? <Loader size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {t("settings.integrations.scan30")}
                  </button>
                  <button type="button" onClick={() => turnOff(p)}
                    className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-300">
                    {t("settings.integrations.turnOff")}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => connect(p)} disabled={busyId === p.id}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
                {busyId === p.id ? <Loader size={15} className="animate-spin" /> : <Watch size={15} />}
                {t("settings.integrations.connect", { label: p.label })}
              </button>
            )}
            {p.help && <p className="text-xs text-slate-500">{p.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
