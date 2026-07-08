import { Plus } from "lucide-react";

// Shared "Don't see your race?" affordance — a divider + the orange dashed
// "Add it to the catalogue" card. Used by onboarding (where the contributed race
// becomes the training target) and the Races → Browse segment (plain contribute).
// `children` slots in whatever follows the card (onboarding: the secondary manual
// entry; Browse: the unverified disclaimer).
export function AddRaceCard({ onClick, subtitle, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-800"/>
        <span className="text-xs text-slate-500">Don&apos;t see your race?</span>
        <div className="h-px flex-1 bg-slate-800"/>
      </div>
      <button onClick={onClick}
        className="w-full flex items-center gap-3 text-left rounded-xl border border-dashed border-orange-400/50 bg-orange-500/10 hover:bg-orange-500/15 hover:border-orange-400 px-4 py-3 transition-colors">
        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
          <Plus size={16} className="text-orange-300"/>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-orange-200">Add it to the catalogue</p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </button>
      {children}
    </div>
  );
}
