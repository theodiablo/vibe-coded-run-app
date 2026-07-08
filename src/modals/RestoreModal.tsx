import { useState } from "react";

export function RestoreModal({onRestore, onClose}) {
  const [text, setText] = useState("");
  const [err,  setErr]  = useState("");
  const attempt = () => {
    try {
      const d = JSON.parse(text.trim());
      if (!d.runs && !d.plan && !d.userContext) { setErr("Doesn't look like a valid backup."); return; }
      onRestore(d); onClose();
    } catch { setErr("Invalid JSON — make sure you copied the entire backup."); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700">
          <p className="font-semibold text-sm">Restore from Backup</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">Paste your backup JSON below.</p>
          <textarea value={text} onChange={e => { setText(e.target.value); setErr(""); }} rows={6}
            placeholder="Paste your backup JSON here..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-orange-400"/>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button onClick={attempt} disabled={!text.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Restore Data
          </button>
        </div>
      </div>
    </div>
  );
}
