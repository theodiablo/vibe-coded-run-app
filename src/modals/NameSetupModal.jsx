import { useState } from "react";
import { Activity } from "lucide-react";

// First-run onboarding: ask the user what to call them.
export function NameSetupModal({onSave}) {
  const [val, setVal] = useState("");
  const save = () => { const n = val.trim(); if (n) onSave(n); };
  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 overflow-hidden shadow-xl">
        <div className="px-5 pt-6 pb-4 text-center">
          <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto mb-3">
            <Activity size={22} className="text-orange-400"/>
          </div>
          <p className="font-bold text-lg">Welcome to Running Coach</p>
          <p className="text-sm text-slate-400 mt-1">What should we call you?</p>
        </div>
        <div className="px-5 pb-5 space-y-3">
          <input autoFocus type="text" value={val} maxLength={40}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            placeholder="Your name"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white text-center focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <button onClick={save} disabled={!val.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Let's go
          </button>
        </div>
      </div>
    </div>
  );
}
