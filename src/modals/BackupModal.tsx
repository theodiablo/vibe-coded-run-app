// @ts-nocheck
import { useState, useRef } from "react";
import { Download } from "lucide-react";
import { ymd } from "../utils/format";

export function BackupModal({data, onClose}) {
  const [copied, setCopied] = useState(false);
  const taRef = useRef();
  const json  = JSON.stringify(data, null, 2);

  const tryDownload = () => {
    const url   = URL.createObjectURL(new Blob([json], {type:"application/json"}));
    const fname = "running-coach-" + ymd(new Date()) + ".json";
    const a     = Object.assign(document.createElement("a"), {href: url, download: fname});
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };

  const copyJSON = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done).catch(() => {
        if (taRef.current) { taRef.current.select(); document.execCommand("copy"); done(); }
      });
    } else {
      if (taRef.current) { taRef.current.select(); document.execCommand("copy"); done(); }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700">
          <div>
            <p className="font-semibold text-sm">Backup Data</p>
            <p className="text-xs text-slate-400">{(data.runs ? data.runs.length : 0) + " run(s) · " + (data.plan ? "plan saved" : "no plan") + (data.userContext?.notes ? " · coach memory" : "") + (data.routes?.length ? " · " + data.routes.length + " route(s)" : "")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">Copy or download — save it to Notes, email, etc. Use Restore to reload it after any update.</p>
          <textarea ref={taRef} readOnly value={json} rows={6}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none"
            onFocus={e => e.target.select()}/>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={tryDownload}
              className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
              <Download size={15}/>Download
            </button>
            <button onClick={copyJSON}
              className={"py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors text-white " + (copied ? "bg-emerald-500" : "bg-orange-500 hover:bg-orange-600")}>
              {copied ? "Copied!" : "Copy JSON"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
