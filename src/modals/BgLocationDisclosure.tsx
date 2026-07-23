import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useDismissable } from "../hooks/useDismissable";
import { MapPin } from "lucide-react";
import { PRIVACY_URL } from "../constants";
import { isBackgroundLocationAvailable } from "../geo/background";
import { ModalOverlay, ConfirmButtons } from "../components/ModalPrimitives";

type BgLocationDisclosureProps = { onAccept: () => void; onCancel: () => void };

// Prominent disclosure for background location, shown in the native shell BEFORE
// the OS permission prompt (a Google Play requirement for ACCESS_BACKGROUND_LOCATION).
// The user must affirmatively accept this in-app screen; the OS dialog then gates
// the actual grant. See LiveRunTracker for the once-per-install gating.
//
// On a build that declares ACCESS_BACKGROUND_LOCATION (the debug/personal build)
// the OS asks for three things in a row — location, then "Allow all the time" (a
// Settings round-trip), then notifications — which is confusing without warning.
// So on that build we add an explicit, bolded step-by-step block telling the user
// exactly what to tap. On the release build (`bgSteps` stays false) the disclosure
// is unchanged: it keeps its Play-compliant "While using the app" wording.
export function BgLocationDisclosure({ onAccept, onCancel }: BgLocationDisclosureProps) {
  const { t } = useTranslation();
  useDismissable(true, onCancel);
  const [bgSteps, setBgSteps] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isBackgroundLocationAvailable().then(v => { if (!cancelled) setBgSteps(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return (
    <ModalOverlay>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-slate-700">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <MapPin size={16} className="text-orange-400" />
          <p className="font-semibold text-sm">{t("login.bgLocation.title")}</p>
        </div>
        <div className="p-4 space-y-3 text-sm text-slate-300">
          <p>
            <Trans i18nKey="login.bgLocation.body" components={{ strong: <strong /> }} />
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[13px] text-slate-400">
            <li><Trans i18nKey="login.bgLocation.bulletRecording" components={{ strong: <strong /> }} /></li>
            <li>{t("login.bgLocation.bulletRoute")}</li>
            <li>{t("login.bgLocation.bulletStored")}</li>
          </ul>
          {bgSteps && (
            <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3 space-y-2">
              <p className="text-[13px] font-semibold text-orange-300">{t("login.bgLocation.stepsIntro")}</p>
              <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-slate-300">
                <li><Trans i18nKey="login.bgLocation.step1" components={{ strong: <strong className="text-white" /> }} /></li>
                <li><Trans i18nKey="login.bgLocation.step2" components={{ strong: <strong className="text-white" /> }} /></li>
                <li><Trans i18nKey="login.bgLocation.step3" components={{ strong: <strong className="text-white" /> }} /></li>
              </ol>
            </div>
          )}
          <p className="text-[13px] text-slate-400">
            <Trans
              i18nKey={bgSteps ? "login.bgLocation.privacyNoteBg" : "login.bgLocation.privacyNote"}
              components={{
                privacy: (
                  <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
                    className="text-orange-400 underline" />
                ),
                strong: <strong />,
              }}
            />
          </p>
          <ConfirmButtons cancelLabel={t("common.notNow")} acceptLabel={t("login.bgLocation.allowContinue")}
            onCancel={onCancel} onAccept={onAccept} />
        </div>
      </div>
    </ModalOverlay>
  );
}
