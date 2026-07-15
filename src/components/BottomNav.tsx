import { Activity, Calendar, Trophy, TrendingUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

// The app's bottom navigation: four row tabs (Home · Plan · Races · Progress)
// with a raised center Record FAB. Extracted from RunningCoach so the marketing
// landing's phone mockup can render the *real* nav (always the current design)
// instead of a hand-drawn copy that would drift. Presentational only — the
// caller owns positioning (via `className`) and the handlers; omit the handlers
// (as the marketing mockup does) to render it as a static, decorative preview.

const NAV_TABS = [
  { id: "dash", labelKey: "nav.home", Icon: Activity },
  { id: "plan", labelKey: "nav.plan", Icon: Calendar },
  { id: "races", labelKey: "nav.races", Icon: Trophy },
  { id: "progress", labelKey: "nav.progress", Icon: TrendingUp },
] as const;

type NavItem = { id: string; labelKey: string; Icon: React.ComponentType<{ size?: number }> };

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors " +
        (active ? "text-orange-400" : "text-slate-400 hover:text-slate-200")
      }
    >
      <item.Icon size={20} />
      {t(item.labelKey)}
    </button>
  );
}

type BottomNavProps = {
  /** id of the active tab (matches NAV_TABS ids; e.g. "dash"). */
  active: string;
  /** Positioning/utility classes — e.g. "fixed bottom-0 inset-x-0 z-20" in the
   *  app, "absolute bottom-0 inset-x-0" inside the marketing phone frame. */
  className?: string;
  onTab?: (id: string) => void;
  onRecord?: () => void;
  /** Progress opens the stats sub-view specifically; falls back to onTab. */
  onProgress?: () => void;
};

export function BottomNav({ active, className = "", onTab, onRecord, onProgress }: BottomNavProps) {
  const { t } = useTranslation();
  const select = (id: string) => {
    if (id === "progress" && onProgress) return onProgress();
    onTab?.(id);
  };
  return (
    <nav
      className={"bg-slate-800 border-t border-slate-700 flex items-stretch " + className}
      style={{ height: 64 }}
    >
      {NAV_TABS.slice(0, 2).map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => select(item.id)} />
      ))}
      {/* Center Record FAB — raised above the bar. */}
      <div className="flex-1 flex items-center justify-center">
        <button
          onClick={onRecord}
          aria-label={t("nav.record")}
          className="flex items-center justify-center bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg transition-colors"
          style={{ width: 54, height: 54, marginTop: -18 }}
        >
          <Plus size={26} />
        </button>
      </div>
      {NAV_TABS.slice(2).map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => select(item.id)} />
      ))}
    </nav>
  );
}
