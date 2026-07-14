import { useState } from "react";
import { useTranslation } from "react-i18next";
import { INPUT_CLS } from "../constants";
import { HRZoneBar } from "../components/HRZoneBar";
import type { SettingsState } from "../types";

type HRZonesProps = {
  settings: SettingsState;
  saveSettings: (settings: SettingsState) => void;
};

// Editable heart-rate profile, nested inside the Settings → Profile card (no
// outer card of its own). Auto-saves on blur; the full zone breakdown lives in
// Progress → Stats (HRZonesCard).
export function HRZones({settings, saveSettings}: HRZonesProps) {
  const { t } = useTranslation();
  const [age,    setAge]    = useState(String(settings.age || ""));
  const [maxHR,  setMaxHR]  = useState(String(settings.maxHR || ""));
  const [restHR, setRestHR] = useState(String(settings.restHR || 60));
  const [maxHRHint, setMaxHRHint] = useState("");

  const ageN  = parseInt(age)    || 0;
  const mhrN  = parseInt(maxHR)  || 0;
  const rhrN  = parseInt(restHR) || 60;
  const tanakaMax  = ageN ? Math.round(208 - 0.7 * ageN) : null;
  const effMax = mhrN || tanakaMax || 0;
  const ready  = effMax > 0 && rhrN > 0 && effMax - rhrN > 0;

  // Settings fields auto-save on blur (no Save button) — commit reads the
  // coalesced numbers; estimateHR persists explicitly since setState is async.
  const commit = () => {
    saveSettings({...settings, age:ageN, maxHR:mhrN||tanakaMax||0, restHR:rhrN});
  };

  const estimateHR = () => {
    if (!tanakaMax) { setMaxHRHint(t("settings.hr.enterAge")); return; }
    setMaxHR(String(tanakaMax));
    setRestHR("60");
    setMaxHRHint(t("settings.hr.estimated", { max: tanakaMax }));
    saveSettings({...settings, age:ageN, maxHR:tanakaMax, restHR:60});
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-1">{t("settings.hr.title")}</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-xs text-slate-400 block mb-1.5">{t("settings.hr.age")}</label>
          <input type="number" min="10" max="90" placeholder="35" value={age} onChange={e => setAge(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
        <div><label className="text-xs text-slate-400 block mb-1.5">{t("settings.hr.maxHr")}</label>
          <input type="number" min="100" max="230" placeholder={t("settings.hr.autoPlaceholder")} value={maxHR} onChange={e => setMaxHR(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
        <div><label className="text-xs text-slate-400 block mb-1.5">{t("settings.hr.restHr")}</label>
          <input type="number" min="30" max="120" placeholder="60" value={restHR} onChange={e => setRestHR(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
      </div>

      <div>
        {!mhrN && (
          <button type="button" onClick={estimateHR}
            className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition-colors">
            {t("settings.hr.dontKnow")}
          </button>
        )}
        {maxHRHint && <p className="text-xs text-slate-500 mt-1.5">{maxHRHint}</p>}
      </div>

      {ready && (
        <div className="space-y-1.5">
          <HRZoneBar effMax={effMax} restHR={rhrN}/>
          <p className="text-xs text-slate-500">{t("settings.hr.fullBreakdown")}</p>
        </div>
      )}
    </div>
  );
}
