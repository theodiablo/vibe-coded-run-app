import { useState } from "react";
import { Download, Upload, LogOut, Trash2, Shield } from "lucide-react";
import { INPUT_CLS, PRIVACY_URL, DISCLAIMER_URL, USER_CONTEXT_MAX_CHARS, USER_CONTEXT_WARN_CHARS, USER_CONTEXT_NOTICE_CHARS } from "../constants";
import { HRZones } from "../views/HRZones";
import { HrSensor } from "../views/HrSensor";
import { Integrations } from "../views/Integrations";
import { isNative } from "../native";
import { getConsent, setConsent } from "../telemetry";
import type { SettingsState, UserContextState } from "../types";

type SettingsModalProps = {
  settings: SettingsState;
  saveSettings: (settings: SettingsState) => void;
  userContext: UserContextState;
  saveUserContext: (context: UserContextState) => void;
  onBackup: () => void;
  onRestore: () => void;
  onSignOut?: () => void;
  onDeleteAccount?: () => void;
  onOpenCoach?: () => void;
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  scanImportsNow?: () => Promise<number>;
};

// Full-screen settings: editable profile name, heart-rate zones, and the
// less-frequently-used data actions (Backup / Restore) tucked away here so
// they don't clutter the header.
export function SettingsModal({settings, saveSettings, userContext, saveUserContext, onBackup, onRestore, onSignOut, onDeleteAccount, onOpenCoach, onClose, showToast, scanImportsNow}: SettingsModalProps) {
  const [name, setName] = useState(settings.name || "");
  const sourceMemory = userContext?.notes || "";
  const [memorySource, setMemorySource] = useState(sourceMemory);
  const [memory, setMemory] = useState(sourceMemory);
  if (sourceMemory !== memorySource) {
    setMemorySource(sourceMemory);
    setMemory(sourceMemory);
  }
  // Auto-save on blur/Enter — no Save button (matches the HR fields below).
  const commitName = () => {
    const n = name.trim();
    if (n !== (settings.name || "")) saveSettings({...settings, name: n});
  };
  const commitMemory = () => {
    const notes = memory.slice(0, USER_CONTEXT_MAX_CHARS);
    if (notes !== (userContext?.notes || "")) saveUserContext({ ...(userContext || {}), notes });
  };

  // Telemetry consent (opt-in). The source of truth is the telemetry module's
  // per-device localStorage flag, set first via the first-run ConsentBanner;
  // this toggle just lets the user change their mind. Local state mirrors it so
  // the switch re-renders on tap.
  const [analyticsOn, setAnalyticsOn] = useState(getConsent());
  const toggleAnalytics = () => {
    const next = !analyticsOn;
    setConsent(next);
    setAnalyticsOn(next);
    if (showToast) showToast(next ? "Sharing enabled." : "Sharing disabled.");
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <span className="text-sm font-semibold">Settings</span>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-5">
          {/* Profile — identity + physiology, all "about you" */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
            <p className="text-sm font-semibold text-slate-200">Profile</p>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Your name</label>
              <input type="text" maxLength={40} value={name} placeholder="Your name"
                onChange={e => setName(e.target.value)} onBlur={commitName}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} className={INPUT_CLS}/>
            </div>
            <HRZones settings={settings} saveSettings={saveSettings}/>
            {/* Heart-rate sensor capture is native-only (BLE / Health Connect). */}
            {isNative && <HrSensor settings={settings} saveSettings={saveSettings} showToast={showToast}/>}
            {/* Post-run import integrations (registry-driven; today Health Connect,
                which only exists on native — Integrations renders nothing on web). */}
            <Integrations settings={settings} saveSettings={saveSettings} showToast={showToast} scanImportsNow={scanImportsNow}/>
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">Coach memory</p>
              <p className="text-xs text-slate-400 mt-1">
                Things your coach should remember for future chats, like recurring injuries,
                training preferences, schedule constraints, or important corrections. Markdown
                headings like "## Schedule" or "## Injury history" are welcome. This is saved
                to your account, used in AI coach requests, and editable any time.
              </p>
            </div>
            <textarea value={memory} maxLength={USER_CONTEXT_MAX_CHARS} rows={6}
              onChange={e => setMemory(e.target.value)} onBlur={commitMemory}
              placeholder="e.g. 2026-07-06: Prefers Sunday long runs."
              className={INPUT_CLS + " resize-none leading-relaxed"}/>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="text-slate-500">
                We only save the AI suggestions you choose to store
                {onOpenCoach ? <>
                  {" "}in your{" "}
                  <button type="button" onClick={onOpenCoach}
                    className="text-orange-400 hover:text-orange-300 underline underline-offset-2">
                    AI Coach conversations
                  </button>
                </> : " in your AI Coach conversations"}.
              </p>
              <p className={memory.length >= USER_CONTEXT_NOTICE_CHARS ? "text-red-400" : memory.length >= USER_CONTEXT_WARN_CHARS ? "text-amber-400" : "text-slate-500"}>
                {memory.length} / {USER_CONTEXT_MAX_CHARS}
              </p>
            </div>
          </div>

          {/* Privacy */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Shield size={15} className="text-orange-400"/>
              <p className="text-sm font-semibold text-slate-200">Privacy</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-200">Share usage &amp; crash reports</p>
                <p className="text-xs text-slate-400">
                  Limited app analytics and crash diagnostics. No run data,
                  routes, heart-rate samples, or coach messages are ever sent.
                </p>
              </div>
              <button onClick={toggleAnalytics} role="switch" aria-checked={analyticsOn}
                aria-label="Share usage and crash reports"
                className={"relative shrink-0 w-11 h-6 rounded-full transition-colors " + (analyticsOn ? "bg-orange-500" : "bg-slate-600")}>
                <span className={"absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform " + (analyticsOn ? "translate-x-5" : "translate-x-0")}/>
              </button>
            </div>
            {isNative && (
              <p className="text-xs text-slate-500">
                If the app crashes, you&apos;ll still be asked before any crash
                report is sent.
              </p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300">
                Privacy policy
              </a>
              <span className="text-slate-600">·</span>
              <a href={DISCLAIMER_URL} target="_blank" rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300">
                Health &amp; safety disclaimer
              </a>
            </div>
          </div>

          {/* Backup & restore */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Backup &amp; restore</p>
            <p className="text-xs text-slate-400">Save a copy of your runs &amp; plan, or reload from a previous backup.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onBackup}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Download size={15}/>Backup
              </button>
              <button onClick={onRestore}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Upload size={15}/>Restore
              </button>
            </div>
          </div>

          {/* Account */}
          {(onSignOut || (!isNative && onDeleteAccount)) && (
            <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
              {onSignOut && (
                <button onClick={onSignOut}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                  <LogOut size={15}/>Sign out
                </button>
              )}
              {!isNative && onDeleteAccount && (
                <button onClick={onDeleteAccount}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-red-400 flex items-center justify-center gap-2 transition-colors">
                  <Trash2 size={15}/>Delete account
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
