import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth, Loader, Check, Trash2 } from "lucide-react";
import { hrMethodsForPlatform } from "../hr/source";
import { bleSource } from "../hr/ble";
import { healthConnectSource } from "../hr/healthconnect";
import { healthKitSource } from "../hr/healthkit";
import { getPairedDevice, setPairedDevice, forgetPairedDevice } from "../hr/device";
import { HrSensorDisclosure } from "../modals/HrSensorDisclosure";
import { HR_BLE_DISCLOSED_KEY } from "../constants";
import { BetaBadge } from "../components/BetaBadge";
import type { HrMethod, SettingsState } from "../types";

type HrDevice = { id: string; name: string };
type HrSensorProps = {
  settings: SettingsState;
  saveSettings: (settings: SettingsState) => void;
  showToast?: (msg: string, type?: string) => void;
};

// Heart-rate sensor configuration, nested in the Settings → Profile card (native
// only — HR capture doesn't exist on web). The *method* preference syncs in
// settings.hrMethod; the chosen Bluetooth device is stored per-device (device.js).
// Pairing follows the disclosure-then-OS-prompt pattern of background location.
export function HrSensor({ settings, saveSettings, showToast }: HrSensorProps) {
  const { t } = useTranslation();
  const methods = hrMethodsForPlatform();
  // hrMethod syncs across devices, so it can name the other platform's health
  // store (e.g. "healthconnect" synced from an Android phone, opened on iOS).
  // Render such a value as "off" here instead of a dead configuration panel —
  // the preference itself is left untouched for the device it belongs to.
  const rawMethod = settings.hrMethod || "off";
  const persistedMethod = methods.some((m) => m.id === rawMethod) ? rawMethod : "off";
  const [setupMethod, setSetupMethod] = useState<HrMethod | null>(null);
  const method = setupMethod || persistedMethod;
  const [paired, setPaired] = useState<HrDevice | null>(() => getPairedDevice());
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<HrDevice[]>([]);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);
  const [hcConnected, setHcConnected] = useState<boolean | null>(null); // null = unknown/checking

  const setMethod = (m: HrMethod) => saveSettings({ ...settings, hrMethod: m });
  const chooseMethod = (m: HrMethod) => {
    if (m === "off") {
      setSetupMethod(null);
      setMethod("off");
    }
    else if (m === "bluetooth" && paired) {
      setSetupMethod(null);
      setMethod("bluetooth");
    }
    else setSetupMethod(m);
  };

  // Reflect whether health-store read access is already granted (non-prompting),
  // so Settings shows a persistent "connected" state. Only meaningful on native.
  // For HealthKit, checkPermissions reports the local auth marker — iOS never
  // reveals read authorization, so a completed grant flow is the only signal.
  useEffect(() => {
    if (method !== "healthconnect" && method !== "healthkit") return;
    const src = method === "healthkit" ? healthKitSource : healthConnectSource;
    let cancelled = false;
    src.checkPermissions().then((ok) => { if (!cancelled) setHcConnected(ok); });
    return () => { cancelled = true; };
  }, [method]);

  const disclosed = () => {
    try { return localStorage.getItem(HR_BLE_DISCLOSED_KEY) === "1"; } catch { return false; }
  };
  const markDisclosed = () => {
    try { localStorage.setItem(HR_BLE_DISCLOSED_KEY, "1"); } catch { /* quota — non-fatal */ }
  };

  const runScan = async () => {
    setFound([]);
    setScanning(true);
    try {
      await bleSource.scan((d: HrDevice) => setFound((prev) => prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
    } catch {
      showToast?.(t("settings.hrSensor.scanFailed"), "err");
    }
    setScanning(false);
  };

  // Gate the first scan behind the prominent disclosure + OS Bluetooth prompt.
  const startScan = () => { if (disclosed()) runScan(); else setShowDisclosure(true); };
  const acceptDisclosure = async () => {
    setShowDisclosure(false);
    const ok = await bleSource.requestPermissions();
    if (!ok) { showToast?.(t("settings.hrSensor.permissionNeeded"), "err"); return; }
    markDisclosed();
    runScan();
  };

  const choose = (d: HrDevice) => {
    setPairedDevice(d);
    setPaired(d);
    setFound([]);
    setSetupMethod(null);
    if (method !== "bluetooth") setMethod("bluetooth");
    showToast?.(t("settings.hrSensor.paired", { name: d.name }));
  };
  const forget = () => {
    forgetPairedDevice();
    setPaired(null);
    setSetupMethod("bluetooth");
    if (persistedMethod === "bluetooth") setMethod("off");
  };

  const connectHc = async () => {
    setHcBusy(true);
    try {
      const status = await healthConnectSource.availability();
      if (status === "NotSupported") {
        showToast?.(t("settings.hrSensor.hcNotSupported"), "err");
        return;
      }
      // "Available" → the OS shows the permission screen. "NotInstalled" → the plugin
      // opens Google Play so the user can install Health Connect first.
      const ok = await healthConnectSource.requestPermissions();
      setHcConnected(ok);
      if (ok) { setSetupMethod(null); setMethod("healthconnect"); }
      else if (persistedMethod === "healthconnect") setMethod("off");
      showToast?.(
        ok ? t("settings.hrSensor.hcSuccess")
          : status === "NotInstalled"
            ? t("settings.hrSensor.hcInstall")
            : t("settings.hrSensor.hcDenied"),
        ok ? "ok" : "err");
    } catch {
      showToast?.(t("settings.hrSensor.hcOpenFailed"), "err");
    } finally {
      setHcBusy(false);
    }
  };

  // Apple Health (iOS). granted:true means the authorization sheet flow
  // completed — HealthKit never says whether read access was actually granted,
  // so this optimistically proceeds and empty reads later just stay pending.
  const connectHk = async () => {
    setHcBusy(true);
    try {
      if (!(await healthKitSource.isAvailable())) {
        showToast?.(t("settings.hrSensor.hkNotSupported"), "err");
        return;
      }
      const ok = await healthKitSource.requestPermissions();
      setHcConnected(ok);
      if (ok) { setSetupMethod(null); setMethod("healthkit"); }
      else if (persistedMethod === "healthkit") setMethod("off");
      showToast?.(ok ? t("settings.hrSensor.hkSuccess") : t("settings.hrSensor.hkDenied"), ok ? "ok" : "err");
    } catch {
      showToast?.(t("settings.hrSensor.hkOpenFailed"), "err");
    } finally {
      setHcBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-1">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t("settings.hrSensor.title")}</p>
        <BetaBadge label={t("settings.newBeta")} />
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        {t("settings.hrSensor.subtitle")}
      </p>
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
        {t("settings.hrSensor.betaWarning")}
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-3 gap-2">
        {methods.map((m) => (
          <button key={m.id} type="button" onClick={() => chooseMethod(m.id as HrMethod)}
            className={"py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 " +
              (method === m.id
                ? "bg-orange-500 border-orange-500 text-white"
                : "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600")}>
            <span>{t("settings.hrSensor.methods." + m.id)}</span>
            {m.id !== "off" && <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">{t("settings.hrSensor.newTag")}</span>}
          </button>
        ))}
      </div>

      {/* Bluetooth pairing */}
      {method === "bluetooth" && (
        <div className="space-y-2">
          {paired && (
            <div className="flex items-center justify-between gap-2 bg-slate-700/60 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-slate-200 min-w-0">
                <Bluetooth size={14} className="text-sky-400 shrink-0" />
                <span className="truncate">{paired.name}</span>
              </span>
              <button type="button" onClick={forget} aria-label={t("settings.hrSensor.forgetAria")}
                className="text-slate-400 hover:text-red-400 shrink-0"><Trash2 size={15} /></button>
            </div>
          )}
          <button type="button" onClick={startScan} disabled={scanning}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
            {scanning ? <Loader size={15} className="animate-spin" /> : <Bluetooth size={15} />}
            {scanning ? t("settings.hrSensor.scanning") : paired ? t("settings.hrSensor.pairAnother") : t("settings.hrSensor.pair")}
          </button>
          {found.map((d) => (
            <button key={d.id} type="button" onClick={() => choose(d)}
              className="w-full flex items-center justify-between gap-2 bg-slate-700/60 hover:bg-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200">
              <span className="truncate">{d.name}</span>
              {paired?.id === d.id && <Check size={15} className="text-emerald-400 shrink-0" />}
            </button>
          ))}
          {!scanning && !found.length && !paired && (
            <p className="text-xs text-slate-500">
              {t("settings.hrSensor.pairHelp")}
            </p>
          )}
        </div>
      )}

      {/* Apple Health (iOS) */}
      {method === "healthkit" && (
        <div className="space-y-2">
          {hcConnected && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-emerald-300">
              <Check size={15} className="shrink-0" />
              <span>{t("settings.hrSensor.hkConnected")}</span>
            </div>
          )}
          <button type="button" onClick={connectHk} disabled={hcBusy}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
            {hcBusy ? <Loader size={15} className="animate-spin" /> : null}
            {hcConnected ? t("settings.hrSensor.hkReconnect") : t("settings.hrSensor.hkConnect")}
          </button>
          <p className="text-xs text-slate-500">
            {t("settings.hrSensor.hkHelp")}
          </p>
        </div>
      )}

      {/* Health Connect */}
      {method === "healthconnect" && (
        <div className="space-y-2">
          {hcConnected && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-emerald-300">
              <Check size={15} className="shrink-0" />
              <span>{t("settings.hrSensor.hcConnected")}</span>
            </div>
          )}
          <button type="button" onClick={connectHc} disabled={hcBusy}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
            {hcBusy ? <Loader size={15} className="animate-spin" /> : null}
            {hcConnected ? t("settings.hrSensor.hcReconnect") : t("settings.hrSensor.hcConnect")}
          </button>
          <p className="text-xs text-slate-500">
            {t("settings.hrSensor.hcHelp")}
          </p>
        </div>
      )}

      {showDisclosure && (
        <HrSensorDisclosure onAccept={acceptDisclosure} onCancel={() => setShowDisclosure(false)} />
      )}
    </div>
  );
}
