import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Download, Upload, LogOut, Trash2, Shield } from "lucide-react";
import { LANGS, setLocale, currentLang, isLangId, type LangId } from "../i18n";
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
  const { t } = useTranslation();
  const [name, setName] = useState(settings.name || "");
  // Language: synced preference, falling back to whatever the UI is showing
  // (device-detected) when unset. Picking persists to the blob AND the
  // per-device rc_lang key (inside setLocale) so pre-auth screens match.
  const lang: LangId = isLangId(settings.language) ? settings.language : currentLang();
  const pickLang = (id: LangId) => {
    if (id !== settings.language) saveSettings({...settings, language: id});
    void setLocale(id);
  };
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
    if (showToast) showToast(next ? t("settings.privacy.sharingOn") : t("settings.privacy.sharingOff"));
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col animate-slide-up">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <span className="text-sm font-semibold">{t("settings.title")}</span>
        <button onClick={onClose} aria-label={t("common.close")} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-5">
          {/* Profile — identity + physiology, all "about you" */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
            <p className="text-sm font-semibold text-slate-200">{t("settings.profile.title")}</p>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("settings.profile.name")}</label>
              <input type="text" maxLength={40} value={name} placeholder={t("settings.profile.name")}
                onChange={e => setName(e.target.value)} onBlur={commitName}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} className={INPUT_CLS}/>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("settings.language.label")}</label>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("settings.language.label")}>
                {LANGS.map(l => (
                  <button key={l.id} type="button" onClick={() => pickLang(l.id)}
                    role="radio" aria-checked={lang === l.id}
                    className={"py-2 rounded-xl text-sm font-semibold transition-colors " +
                      (lang === l.id ? "bg-orange-500 text-white" : "bg-slate-700 hover:bg-slate-600 text-slate-200")}>
                    {l.label}
                  </button>
                ))}
              </div>
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
              <p className="text-sm font-semibold text-slate-200">{t("settings.memory.title")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("settings.memory.desc")}</p>
            </div>
            <textarea value={memory} maxLength={USER_CONTEXT_MAX_CHARS} rows={6}
              onChange={e => setMemory(e.target.value)} onBlur={commitMemory}
              placeholder={t("settings.memory.placeholder")}
              className={INPUT_CLS + " resize-none leading-relaxed"}/>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="text-slate-500">
                <Trans i18nKey="settings.memory.footer" components={{
                  link: onOpenCoach
                    ? <button type="button" onClick={onOpenCoach}
                        className="text-orange-400 hover:text-orange-300 underline underline-offset-2"/>
                    : <span/>,
                }}/>
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
              <p className="text-sm font-semibold text-slate-200">{t("settings.privacy.title")}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-200">{t("settings.privacy.shareLabel")}</p>
                <p className="text-xs text-slate-400">{t("settings.privacy.shareDesc")}</p>
              </div>
              <button onClick={toggleAnalytics} role="switch" aria-checked={analyticsOn}
                aria-label={t("settings.privacy.shareAria")}
                className={"relative shrink-0 w-11 h-6 rounded-full transition-colors " + (analyticsOn ? "bg-orange-500" : "bg-slate-600")}>
                <span className={"absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform " + (analyticsOn ? "translate-x-5" : "translate-x-0")}/>
              </button>
            </div>
            {isNative && (
              <p className="text-xs text-slate-500">{t("settings.privacy.crashNote")}</p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300">
                {t("settings.privacy.policyLink")}
              </a>
              <span className="text-slate-600">·</span>
              <a href={DISCLAIMER_URL} target="_blank" rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300">
                {t("settings.privacy.disclaimerLink")}
              </a>
            </div>
          </div>

          {/* Backup & restore */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">{t("settings.backup.title")}</p>
            <p className="text-xs text-slate-400">{t("settings.backup.desc")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onBackup}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Download size={15}/>{t("settings.backup.backupBtn")}
              </button>
              <button onClick={onRestore}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Upload size={15}/>{t("settings.backup.restoreBtn")}
              </button>
            </div>
          </div>

          {/* Account */}
          {(onSignOut || onDeleteAccount) && (
            <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
              {onSignOut && (
                <button onClick={onSignOut}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                  <LogOut size={15}/>{t("settings.account.signOut")}
                </button>
              )}
              {/* In-app account deletion must be reachable on every platform:
                  the App Store REQUIRES it for apps with account creation, and
                  Play's data-deletion policy is happiest with it too. The flow
                  is a plain Supabase RPC — nothing web-only about it. */}
              {onDeleteAccount && (
                <button onClick={onDeleteAccount}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-red-400 flex items-center justify-center gap-2 transition-colors">
                  <Trash2 size={15}/>{t("settings.deleteAccount.title")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
