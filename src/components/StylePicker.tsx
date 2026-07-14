import { useTranslation } from "react-i18next";
import { STYLE_IDS, styleMeta, type StyleId } from "../utils/planStyles";

// Radio-card picker for the training methodology style, shared by PlanView's
// setup/edit forms and the onboarding wizard. `recommended` tags (and, while
// the user hasn't picked, usually equals) the profile-derived suggestion from
// recommendStyle.
type StylePickerProps = {
  value: StyleId;
  onChange: (style: StyleId) => void;
  recommended?: StyleId | null;
};

export function StylePicker({ value, onChange, recommended }: StylePickerProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {(STYLE_IDS as StyleId[]).map(id => {
        const meta = styleMeta(id);
        const selected = id === value;
        const cardCls = "w-full text-left rounded-xl border p-3 transition-colors " +
          (selected ? "bg-orange-500/15 border-orange-500/60" : "bg-slate-700/40 border-slate-600 hover:border-slate-500");
        return (
          <button key={id} type="button" onClick={() => onChange(id)} className={cardCls}>
            <div className="flex items-center gap-2">
              <span className={"text-sm font-semibold " + (selected ? "text-orange-300" : "text-white")}>{meta.label}</span>
              {recommended === id && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 flex-shrink-0">
                  {t("styles.recommended")}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-snug">{meta.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}
