import { useTranslation, Trans } from "react-i18next";
import { InfoButton, InfoSection } from "./InfoButton";

// "ⓘ info" affordance + panel explaining how race predictions are computed.
// Mirrors the maths in utils/predictions.js.
export function PredictionsInfo() {
  const { t } = useTranslation();
  return (
    <InfoButton title={t("progress.predictions.info.title")} label={t("progress.predictions.info.label")}>
      <p className="text-slate-300 text-sm">
        {t("progress.predictions.info.intro")}
      </p>

      <InfoSection title={t("progress.predictions.info.riegelTitle")}>
        <p>
          {t("progress.predictions.info.riegelP1")}
        </p>
        <p className="font-mono text-slate-300 text-[11px] bg-slate-900/60 rounded-lg p-2">
          <Trans i18nKey="progress.predictions.info.riegelFormula" components={[<sup/>]}/>
        </p>
        <p>
          <Trans i18nKey="progress.predictions.info.riegelP2" components={[<span className="text-slate-300"/>]}/>
        </p>
      </InfoSection>

      <InfoSection title={t("progress.predictions.info.bestTitle")} accent="text-orange-400">
        <p>
          <Trans i18nKey="progress.predictions.info.bestBody" components={[<span className="text-orange-300"/>]}/>
        </p>
      </InfoSection>

      <InfoSection title={t("progress.predictions.info.hrTitle")} accent="text-sky-400">
        <p>
          <Trans i18nKey="progress.predictions.info.hrP1" components={[<span className="text-sky-300"/>]}/>
        </p>
        <p>
          {t("progress.predictions.info.hrP2")}
        </p>
      </InfoSection>

      <InfoSection title={t("progress.predictions.info.elevTitle")} accent="text-emerald-400">
        <p>
          <Trans i18nKey="progress.predictions.info.elevBody" components={[<span className="text-orange-300"/>]}/>
        </p>
      </InfoSection>

      <p className="text-slate-500 text-xs">
        {t("progress.predictions.info.footer")}
      </p>
    </InfoButton>
  );
}
