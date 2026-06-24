import { useState } from "react";
import { Check, Download, Upload, LogOut, Trash2 } from "lucide-react";
import { INPUT_CLS } from "../constants";
import { HRZones } from "../views/HRZones";
import { isNative } from "../native";

// Full-screen settings: editable profile name, heart-rate zones, and the
// less-frequently-used data actions (Backup / Restore) tucked away here so
// they don't clutter the header.
export function SettingsModal({settings, saveSettings, runs, onBackup, onRestore, onSignOut, onDeleteAccount, onClose, showToast}) {
  const [name,  setName]  = useState(settings.name || "");
  const [saved, setSaved] = useState(false);
  const saveName = () => {
    const n = name.trim();
    saveSettings({...settings, name: n});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (showToast) showToast(n ? "Name updated." : "Name cleared.");
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <span className="text-sm font-semibold">Settings</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-5">
          {/* Profile */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Profile</p>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Your name</label>
              <input type="text" maxLength={40} value={name} placeholder="Your name"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); }} className={INPUT_CLS}/>
            </div>
            <button onClick={saveName}
              className={"w-full text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 " + (saved ? "bg-emerald-500" : "bg-orange-500 hover:bg-orange-600")}>
              {saved ? <><Check size={16}/>Saved</> : "Save name"}
            </button>
          </div>

          {/* Heart rate */}
          <HRZones settings={settings} saveSettings={saveSettings} runs={runs} showToast={showToast}/>

          {/* Data */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Data</p>
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
