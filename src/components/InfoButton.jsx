import { useState } from "react";
import { Info } from "lucide-react";

// A small "ⓘ info" label that opens a full-screen explanatory panel. The panel
// chrome (overlay, header, scroll, close) lives here; callers pass a title and
// the explanation as children, so the same affordance reads consistently across
// the Plan and Stats views.
export function InfoButton({title, label = "info", children}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 transition-colors">
        <Info size={13}/>{label}
      </button>

      {open && (
        <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col" onClick={() => setOpen(false)}>
          <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
            <span className="text-sm font-semibold">{title}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
          </header>
          <div className="flex-1 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="max-w-lg mx-auto p-4 space-y-4 text-sm text-slate-300 leading-relaxed">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Reusable section block inside an info panel: a coloured heading + body.
export function InfoSection({title, accent = "text-orange-400", children}) {
  return (
    <div className="bg-slate-800 rounded-2xl p-4 space-y-2">
      <p className={"text-sm font-semibold " + accent}>{title}</p>
      <div className="space-y-2 text-slate-400 text-xs leading-relaxed">{children}</div>
    </div>
  );
}
