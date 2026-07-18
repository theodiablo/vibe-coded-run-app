import { useState, useRef, useEffect, type ComponentPropsWithoutRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useDismissable } from "../hooks/useDismissable";
import { Loader, MessageCircle, Send, X, Flag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { coachPropose, coachCritique, coachConfirm, coachPing } from "../coach";
import { submitCoachFeedback } from "../coachFeedback";
import { diffPlans } from "../utils/coachDiff";
import { validatePlan } from "../utils/coachValidation";
import { track } from "../telemetry";
import { PRIVACY_URL, DISCLAIMER_URL } from "../constants";
import type { Plan } from "../types";

// The model replies in markdown (headers, bold, tables); rendered via
// react-markdown rather than manually injecting raw HTML through a sanitizer
// pair — it emits real React elements, so there's no HTML string to sanitize.
// Component overrides keep every element inside the narrow chat bubble's
// dark slate / orange-500 palette instead of react-markdown's default
// (unstyled, full-size) tags.
const MD_COMPONENTS = {
  h1: (p: ComponentPropsWithoutRef<"p">) => <p className="text-sm font-bold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  h2: (p: ComponentPropsWithoutRef<"p">) => <p className="text-sm font-bold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  h3: (p: ComponentPropsWithoutRef<"p">) => <p className="text-sm font-semibold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  p: (p: ComponentPropsWithoutRef<"p">) => <p className="mb-2 last:mb-0 leading-relaxed" {...p}/>,
  strong: (p: ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold text-slate-100" {...p}/>,
  ul: (p: ComponentPropsWithoutRef<"ul">) => <ul className="list-disc pl-4 mb-2 space-y-0.5 last:mb-0" {...p}/>,
  ol: (p: ComponentPropsWithoutRef<"ol">) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 last:mb-0" {...p}/>,
  li: (p: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed" {...p}/>,
  a: (p: ComponentPropsWithoutRef<"a">) => <a className="text-orange-400 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...p}/>,
  code: (p: ComponentPropsWithoutRef<"code">) => <code className="bg-slate-900/60 px-1 py-0.5 rounded text-orange-300 text-xs font-mono" {...p}/>,
  pre: (p: ComponentPropsWithoutRef<"pre">) => <pre className="bg-slate-900/60 rounded-lg p-2 overflow-x-auto text-xs font-mono mb-2 last:mb-0" {...p}/>,
  blockquote: (p: ComponentPropsWithoutRef<"blockquote">) => <blockquote className="border-l-2 border-slate-600 pl-2 italic text-slate-400 mb-2 last:mb-0" {...p}/>,
  hr: () => <hr className="border-slate-700 my-2"/>,
  table: (p: ComponentPropsWithoutRef<"table">) => <div className="overflow-x-auto mb-2 last:mb-0"><table className="w-full text-xs border-collapse" {...p}/></div>,
  th: (p: ComponentPropsWithoutRef<"th">) => <th className="border border-slate-700 px-2 py-1 text-left font-semibold bg-slate-800/60" {...p}/>,
  td: (p: ComponentPropsWithoutRef<"td">) => <td className="border border-slate-700 px-2 py-1 align-top" {...p}/>,
};

const CoachText = ({ text }: { text: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
);

// Tappable starter prompts for the empty chat — teach what the coach can do and
// lower the blank-page barrier. Each just seeds `send` with the phrase.
// Stored as i18n keys (resolved with t() at render) so a runtime language
// switch isn't frozen to the boot language by a module-level t() call.
const COACH_EXAMPLE_KEYS = [
  "coach.examples.fresh",
  "coach.examples.extraDay",
  "coach.examples.moveLongRun",
  "coach.examples.confidence",
];

// Full-screen coach chat (propose-and-confirm). The user describes what
// happened ("my knee hurts", "I missed the whole week"); the agent proposes a
// validated adjustment to the plan; the user Accepts it or steers with a
// follow-up message. Nothing touches the plan until Accept — and even then the
// accepted plan is re-validated client-side (belt and braces) before
// applyPlan persists it through the normal savePlan path.
type MemorySuggestion = { id: string; text: string; status: "pending" | "saved" | "dismissed" };
type CoachMessage = {
  role: "user" | "coach";
  text: string;
  proposal?: { diff: { weekNumber: number; changes: string[] }[] };
  trajectoryId?: string | null;
  roundIndex?: number | null;
  memorySuggestions?: MemorySuggestion[];
};

type CoachResult = {
  rationale?: string;
  trajectoryId?: string | null;
  roundIndex?: number;
  memorySuggestions?: { id: string; text: string }[];
  status?: string;
  trajectoryClosed?: boolean;
  changed?: boolean;
  proposedPlan?: Plan;
};

type CoachChatProps = {
  plan: Plan;
  onApplyPlan: (plan: Plan) => void;
  appendUserContext: (text: string) => boolean;
  showToast: (msg: string, type?: string) => void;
  onClose: () => void;
  // Optional pre-filled draft for the input box — e.g. opening the coach from a
  // specific plan session seeds "About my Tempo run on 23 Jul…" so the
  // conversation is about that run. The user reviews and sends (never auto-sent).
  initialInput?: string;
};

export function CoachChat({ plan, onApplyPlan, appendUserContext, showToast, onClose, initialInput }: CoachChatProps) {
  const { t } = useTranslation();
  useDismissable(true, onClose);
  // msg: { role: "user"|"coach", text, proposal?: {plan, diff}, trajectoryId?, roundIndex? }
  // trajectoryId/roundIndex are stamped on every real coach answer (the ones
  // logged server-side to agent_rounds) so it can be flagged as wrong; the
  // greeting, the post-accept "Done", and error bubbles have no round behind
  // them and stay unstamped, which hides the flag affordance on them.
  const [msgs, setMsgs] = useState<CoachMessage[]>(() => [{
    role: "coach",
    text: t("coach.greeting"),
  }]);
  const [input, setInput] = useState(initialInput ?? "");
  const [busy, setBusy] = useState(false);
  const [trajectoryId, setTrajectoryId] = useState<string | null>(null);
  const [flaggingIndex, setFlaggingIndex] = useState(-1);
  const [flagText, setFlagText] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flaggedKeys, setFlaggedKeys] = useState<Set<string>>(() => new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  // Warm the edge function the moment the chat opens so the user's first message
  // lands on an already-booted isolate instead of eating the cold start (the
  // failure mode where round 0 alone times out). Fire-and-forget; coachPing
  // never throws.
  useEffect(() => { coachPing(); }, []);

  // Only the most recent proposal is ever confirmable, and only while its
  // trajectory is still open — derived at render (not a per-message flag
  // mutated at every append site), so a stale "Apply" button can't survive an
  // append path that forgets to reset it.
  let lastProposalIndex = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].proposal) { lastProposalIndex = i; break; }
  let lastOpenAnswerIndex = -1;
  if (trajectoryId) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "coach" && msgs[i].trajectoryId === trajectoryId && msgs[i].roundIndex != null) {
        lastOpenAnswerIndex = i;
        break;
      }
    }
  }

  const coachMsg = (res: CoachResult, fallbackText: string): CoachMessage => ({
    role: "coach",
    text: res.rationale || fallbackText,
    trajectoryId: res.trajectoryId,
    roundIndex: res.roundIndex,
    memorySuggestions: (res.memorySuggestions || []).map(s => ({ ...s, status: "pending" })),
  });

  const applyCoachResult = (res: CoachResult) => {
    track("coach_proposal", { status: res.status, round: res.roundIndex });
    if (res.status === "no_valid_adjustment") {
      setTrajectoryId(res.trajectoryClosed ? null : res.trajectoryId ?? null);
      setMsgs(m => [...m, coachMsg(res, t("coach.fallback.noValidAdjustment"))]);
    } else if (!res.changed) {
      setTrajectoryId(null);
      setMsgs(m => [...m, coachMsg(res, t("coach.fallback.noChangeNeeded"))]);
    } else {
      setTrajectoryId(res.trajectoryId ?? null);
      if (!res.proposedPlan) throw new Error(t("coach.errors.noProposedPlan"));
      const diff = diffPlans(plan, res.proposedPlan);
      setMsgs(m => [...m, { ...coachMsg(res, t("coach.fallback.proposal")), proposal: { diff } }]);
    }
  };

  const send = async (preset?: string | unknown) => {
    // `preset` comes from an example chip; a bare click/keydown passes an event,
    // so only treat a real string as an override and otherwise read the input.
    const text = (typeof preset === "string" ? preset : input).trim();
    if (!text || busy) return;
    // Count genuine coach interactions — a user actually sending a message.
    // Never the message text; just whether it opens a chat or follows up on an
    // already-open trajectory (a proposal round). Consent-gated in track().
    track("coach_message_sent", { followUp: !!trajectoryId });
    setInput("");
    setMsgs(m => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = trajectoryId ? await coachCritique(trajectoryId, text) : await coachPropose(text);
      applyCoachResult(res);
    } catch (err) {
      setMsgs(m => [...m, { role: "coach", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setBusy(false);
    }
  };

  // The server's confirm re-validates and returns the authoritative plan — the
  // proposal card is display-only.
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!trajectoryId) throw new Error(t("coach.errors.noProposalReady"));
      const { plan: accepted, baseline: serverBaseline } = await coachConfirm(trajectoryId);
      if (!accepted) throw new Error(t("coach.errors.confirmNoPlan"));
      // Clear before the client check: the server already accepted the trajectory,
      // so the Apply button must not survive a client-side validation failure
      // (which would let a retry call coachConfirm on an already-accepted trajectory).
      // Use the server's stored baseline so the waiver set matches what the server used.
      setTrajectoryId(null);
      const check = validatePlan(accepted, { baseline: serverBaseline ?? plan });
      if (!check.ok) throw new Error(t("coach.errors.revalidateFailed"));
      onApplyPlan(accepted);
      track("coach_plan_applied", {});
      setMsgs(m => [...m, { role: "coach", text: t("coach.fallback.applied") }]);
      showToast(t("coach.toast.planAdjusted"));
    } catch (err) {
      setMsgs(m => [...m, { role: "coach", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setBusy(false);
    }
  };

  const submitFlag = async (m: CoachMessage, index: number) => {
    const correction = flagText.trim();
    if (!correction || flagBusy) return;
    const canCritique = index === lastOpenAnswerIndex && trajectoryId === m.trajectoryId;
    setFlagBusy(true);
    try {
      if (!m.trajectoryId || m.roundIndex == null) throw new Error(t("coach.errors.noResponseToFlag"));
      await submitCoachFeedback({ trajectoryId: m.trajectoryId, roundIndex: m.roundIndex, correction });
      track("coach_feedback_submitted", { roundIndex: m.roundIndex });
      setFlaggedKeys(prev => new Set(prev).add(`${m.trajectoryId}:${m.roundIndex}`));
    } catch {
      showToast(t("coach.toast.feedbackFailed"));
    } finally {
      setFlagBusy(false);
    }
    setFlaggingIndex(-1);
    setFlagText("");
    if (!canCritique) {
      showToast(t("coach.toast.feedbackSent"));
      return;
    }
    setMsgs(cur => [...cur, { role: "user", text: correction }]);
    setBusy(true);
    try {
      if (!m.trajectoryId) throw new Error(t("coach.errors.noConversation"));
      const res = await coachCritique(m.trajectoryId, correction);
      applyCoachResult(res);
    } catch (err) {
      setMsgs(cur => [...cur, { role: "coach", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setBusy(false);
    }
  };

  const saveMemorySuggestion = (msgIndex: number, suggestionId: string, text: string) => {
    const saved = appendUserContext(text);
    setMsgs(cur => cur.map((m, i) => i !== msgIndex ? m : {
      ...m,
      memorySuggestions: (m.memorySuggestions || []).map(s => s.id === suggestionId ? { ...s, status: "saved" } : s),
    }));
    showToast(saved ? t("coach.memory.saved") : t("coach.toast.memoryDuplicate"));
  };

  const dismissMemorySuggestion = (msgIndex: number, suggestionId: string) => {
    setMsgs(cur => cur.map((m, i) => i !== msgIndex ? m : {
      ...m,
      memorySuggestions: (m.memorySuggestions || []).map(s => s.id === suggestionId ? { ...s, status: "dismissed" } : s),
    }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col animate-slide-up">
      <div className="flex justify-between items-center px-4 border-b border-slate-800 flex-shrink-0"
        style={{height:"calc(44px + var(--safe-top))", paddingTop:"var(--safe-top)"}}>
        <div className="flex items-center gap-1.5">
          <MessageCircle size={15} className="text-orange-400"/>
          <span className="text-sm font-semibold">{t("coach.title")}</span>
        </div>
        <button onClick={onClose} aria-label={t("common.close")} className="text-slate-400 hover:text-white p-1.5"><X size={18}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-lg w-full mx-auto">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={"rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%] " +
              (m.role === "user"
                ? "whitespace-pre-wrap bg-orange-500/20 border border-orange-500/30"
                : "bg-slate-800 border border-slate-700")}>
              {m.role === "user" ? m.text : <CoachText text={m.text}/>}
              {m.proposal && (
                <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
                  {m.proposal.diff.map(w => (
                    <div key={w.weekNumber}>
                      <p className="text-xs font-semibold text-slate-300">{t("coach.week", { num: w.weekNumber })}</p>
                      {w.changes.map((c, j) => <p key={j} className="text-xs text-slate-400">· {c}</p>)}
                    </div>
                  ))}
                  {i === lastProposalIndex && trajectoryId && (
                    <button onClick={accept} disabled={busy}
                      className="w-full mt-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                      {t("coach.apply")}
                    </button>
                  )}
                </div>
              )}
              {(m.memorySuggestions || []).filter(s => s.status !== "dismissed").map(s => (
                <div key={s.id} className="mt-3 pt-3 border-t border-slate-700 space-y-2">
                  <p className="text-xs font-semibold text-slate-300">{t("coach.memory.prompt")}</p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap">{s.text}</p>
                  {s.status === "saved" ? (
                    <p className="text-xs text-emerald-400">{t("coach.memory.saved")}</p>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => saveMemorySuggestion(i, s.id, s.text)}
                        className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2.5 py-1 rounded-lg transition-colors">
                        {t("coach.memory.save")}
                      </button>
                      <button onClick={() => dismissMemorySuggestion(i, s.id)}
                        className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg transition-colors">
                        {t("common.notNow")}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {m.trajectoryId != null && m.roundIndex != null && (
                flaggedKeys.has(`${m.trajectoryId}:${m.roundIndex}`) ? (
                  <p className="mt-2 text-xs text-slate-500">{t("coach.flag.thanks")}</p>
                ) : flaggingIndex === i ? (
                  <div className="mt-2 pt-2 border-t border-slate-700 space-y-1.5">
                    <textarea value={flagText} onChange={e => setFlagText(e.target.value)}
                      placeholder={t("coach.flag.placeholder")} rows={2} autoFocus
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-orange-400 placeholder-slate-500 resize-none"/>
                    <div className="flex gap-2">
                      <button onClick={() => submitFlag(m, i)} disabled={flagBusy || busy || !flagText.trim()}
                        className="text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-2.5 py-1 rounded-lg transition-colors">
                        {t("coach.send")}
                      </button>
                      <button onClick={() => { setFlaggingIndex(-1); setFlagText(""); }} disabled={flagBusy}
                        className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg transition-colors">
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setFlaggingIndex(i); setFlagText(""); }}
                    className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    <Flag size={11}/> {t("coach.flag.cta")}
                  </button>
                )
              )}
            </div>
          </div>
        ))}
        {msgs.length === 1 && !busy && !initialInput && (
          <div className="flex flex-wrap gap-2 pt-1">
            {COACH_EXAMPLE_KEYS.map(k => (
              <button key={k} onClick={() => send(t(k))}
                className="text-xs text-slate-300 bg-slate-800 border border-slate-700 hover:border-orange-400/60 hover:text-white rounded-full px-3 py-1.5 transition-colors">
                {t(k)}
              </button>
            ))}
          </div>
        )}
        {busy && <div className="flex items-center gap-2 text-slate-400 text-xs"><Loader size={14} className="animate-spin"/>{t("coach.thinking")}</div>}
        <div ref={endRef}/>
      </div>

      <div className="border-t border-slate-800 p-3 flex-shrink-0" style={{paddingBottom:"calc(0.75rem + var(--safe-bottom))"}}>
        <div className="max-w-lg mx-auto text-[11px] text-slate-500 mb-2">
          {/* Children stay in one text flow so the <1>/<3> element indices in the
              dictionary string line up with the two anchors. */}
          <Trans i18nKey="coach.footer">Your coach uses your message, plan, recent runs, and saved memory to answer. See our <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-orange-300 underline underline-offset-2">privacy policy</a> and <a href={DISCLAIMER_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-orange-300 underline underline-offset-2">safety note</a>.</Trans>
        </div>
        <div className="max-w-lg mx-auto flex gap-2">
          <input id="coach-message" name="coach-message" aria-label={t("coach.input.aria")} value={input} onChange={e => setInput(e.target.value)}
            autoFocus={!!initialInput}
            onKeyDown={e => { if (e.key === "Enter") send(); }}
            placeholder={trajectoryId ? t("coach.input.placeholderFollowUp") : t("coach.input.placeholder")}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <button onClick={send} disabled={busy || !input.trim()} aria-label={t("coach.send")}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 rounded-xl transition-colors">
            <Send size={16}/>
          </button>
        </div>
      </div>
    </div>
  );
}
