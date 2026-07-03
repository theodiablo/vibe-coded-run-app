import { useState, useEffect } from "react";
import { Bluetooth, Loader, Check, Trash2 } from "lucide-react";
import { HR_METHODS } from "../hr/source";
import { bleSource } from "../hr/ble";
import { healthConnectSource } from "../hr/healthconnect";
import { getPairedDevice, setPairedDevice, forgetPairedDevice } from "../hr/device";
import { HrSensorDisclosure } from "../modals/HrSensorDisclosure";
import { HR_BLE_DISCLOSED_KEY } from "../constants";
import { BetaBadge } from "../components/BetaBadge";

// Heart-rate sensor configuration, nested in the Settings → Profile card (native
// only — HR capture doesn't exist on web). The *method* preference syncs in
// settings.hrMethod; the chosen Bluetooth device is stored per-device (device.js).
// Pairing follows the disclosure-then-OS-prompt pattern of background location.
export function HrSensor({ settings, saveSettings, showToast }) {
  const persistedMethod = settings.hrMethod || "off";
  const [setupMethod, setSetupMethod] = useState(null);
  const method = setupMethod || persistedMethod;
  const [paired, setPaired] = useState(getPairedDevice());
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState([]);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);
  const [hcConnected, setHcConnected] = useState(null); // null = unknown/checking

  const setMethod = (m) => saveSettings({ ...settings, hrMethod: m });
  const chooseMethod = (m) => {
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

  // Reflect whether Health Connect read access is already granted (non-prompting),
  // so Settings shows a persistent "connected" state. Only meaningful on native.
  useEffect(() => {
    if (method !== "healthconnect") return;
    let cancelled = false;
    healthConnectSource.checkPermissions().then((ok) => { if (!cancelled) setHcConnected(ok); });
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
      await bleSource.scan((d) => setFound((prev) => prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
    } catch {
      showToast?.("Couldn't scan for sensors — make sure Bluetooth is on.", "err");
    }
    setScanning(false);
  };

  // Gate the first scan behind the prominent disclosure + OS Bluetooth prompt.
  const startScan = () => { if (disclosed()) runScan(); else setShowDisclosure(true); };
  const acceptDisclosure = async () => {
    setShowDisclosure(false);
    const ok = await bleSource.requestPermissions();
    if (!ok) { showToast?.("Bluetooth permission is needed to pair a sensor.", "err"); return; }
    markDisclosed();
    runScan();
  };

  const choose = (d) => {
    setPairedDevice(d);
    setPaired(d);
    setFound([]);
    setSetupMethod(null);
    if (method !== "bluetooth") setMethod("bluetooth");
    showToast?.("Paired " + d.name + ".");
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
        showToast?.("Health Connect isn't supported on this device (needs Android 8+).", "err");
        return;
      }
      // "Available" → the OS shows the permission screen. "NotInstalled" → the plugin
      // opens Google Play so the user can install Health Connect first.
      const ok = await healthConnectSource.requestPermissions();
      setHcConnected(ok);
      if (ok) { setSetupMethod(null); setMethod("healthconnect"); }
      else if (persistedMethod === "healthconnect") setMethod("off");
      showToast?.(
        ok ? "Health Connect connected — heart rate will be read after your runs."
          : status === "NotInstalled"
            ? "Install Health Connect from Google Play, then tap Connect again."
            : "Access wasn't granted. In Health Connect, allow Running Coach to read Heart rate.",
        ok ? "ok" : "err");
    } catch {
      showToast?.("Couldn't open Health Connect. Make sure it's installed and up to date.", "err");
    } finally {
      setHcBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-1">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Heart-rate sensor</p>
        <BetaBadge label="New beta" />
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        Capture heart rate automatically during a run instead of typing it in.
      </p>
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
        This is a new, lightly tested feature. Sensor pairing, live readings, or
        Health Connect imports may fail or arrive late, so check the saved heart
        rate before relying on it.
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-3 gap-2">
        {HR_METHODS.map((m) => (
          <button key={m.id} type="button" onClick={() => chooseMethod(m.id)}
            className={"py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 " +
              (method === m.id
                ? "bg-orange-500 border-orange-500 text-white"
                : "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600")}>
            <span>{m.label}</span>
            {m.id !== "off" && <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">new</span>}
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
              <button type="button" onClick={forget} aria-label="Forget sensor"
                className="text-slate-400 hover:text-red-400 shrink-0"><Trash2 size={15} /></button>
            </div>
          )}
          <button type="button" onClick={startScan} disabled={scanning}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
            {scanning ? <Loader size={15} className="animate-spin" /> : <Bluetooth size={15} />}
            {scanning ? "Scanning…" : paired ? "Pair a different sensor" : "Pair a sensor"}
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
              Put your sensor in pairing mode (or enable heart-rate broadcast on your
              watch), then scan. Some watches only broadcast while a workout is active.
            </p>
          )}
        </div>
      )}

      {/* Health Connect */}
      {method === "healthconnect" && (
        <div className="space-y-2">
          {hcConnected && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-emerald-300">
              <Check size={15} className="shrink-0" />
              <span>Connected — heart rate is added to your runs automatically.</span>
            </div>
          )}
          <button type="button" onClick={connectHc} disabled={hcBusy}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50">
            {hcBusy ? <Loader size={15} className="animate-spin" /> : null}
            {hcConnected ? "Reconnect Health Connect" : "Connect Health Connect"}
          </button>
          <p className="text-xs text-slate-500">
            Reads your heart rate from Android Health Connect after a run — useful if
            your watch syncs there but doesn&apos;t broadcast live. It may take a few
            minutes to appear after you finish.
          </p>
        </div>
      )}

      {showDisclosure && (
        <HrSensorDisclosure onAccept={acceptDisclosure} onCancel={() => setShowDisclosure(false)} />
      )}
    </div>
  );
}
