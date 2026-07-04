import { useState, useRef, useEffect } from "react";
import { Loader, MessageCircle, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { coachPropose, coachCritique, coachConfirm } from "../coach";
import { diffPlans } from "../utils/coachDiff";
import { validatePlan } from "../utils/coachValidation";
import { track } from "../telemetry";

// The model replies in markdown (headers, bold, tables); rendered via
// react-markdown rather than manually injecting raw HTML through a sanitizer
// pair — it emits real React elements, so there's no HTML string to sanitize.
// Component overrides keep every element inside the narrow chat bubble's
// dark slate / orange-500 palette instead of react-markdown's default
// (unstyled, full-size) tags.
const MD_COMPONENTS = {
  h1: (p) => <p className="text-sm font-bold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  h2: (p) => <p className="text-sm font-bold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  h3: (p) => <p className="text-sm font-semibold text-slate-100 mt-2 mb-1 first:mt-0" {...p}/>,
  p: (p) => <p className="mb-2 last:mb-0 leading-relaxed" {...p}/>,
  strong: (p) => <strong className="font-semibold text-slate-100" {...p}/>,
  ul: (p) => <ul className="list-disc pl-4 mb-2 space-y-0.5 last:mb-0" {...p}/>,
  ol: (p) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 last:mb-0" {...p}/>,
  li: (p) => <li className="leading-relaxed" {...p}/>,
  a: (p) => <a className="text-orange-400 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...p}/>,
  code: (p) => <code className="bg-slate-900/60 px-1 py-0.5 rounded text-orange-300 text-xs font-mono" {...p}/>,
  pre: (p) => <pre className="bg-slate-900/60 rounded-lg p-2 overflow-x-auto text-xs font-mono mb-2 last:mb-0" {...p}/>,
  blockquote: (p) => <blockquote className="border-l-2 border-slate-600 pl-2 italic text-slate-400 mb-2 last:mb-0" {...p}/>,
  hr: () => <hr className="border-slate-700 my-2"/>,
  table: (p) => <div className="overflow-x-auto mb-2 last:mb-0"><table className="w-full text-xs border-collapse" {...p}/></div>,
  th: (p) => <th className="border border-slate-700 px-2 py-1 text-left font-semibold bg-slate-800/60" {...p}/>,
  td: (p) => <td className="border border-slate-700 px-2 py-1 align-top" {...p}/>,
};

const CoachText = ({ text }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
);

// Full-screen coach chat (propose-and-confirm). The user describes what
// happened ("my knee hurts", "I missed the whole week"); the agent proposes a
// validated adjustment to the plan; the user Accepts it or steers with a
// follow-up message. Nothing touches the plan until Accept — and even then the
// accepted plan is re-validated client-side (belt and braces) before
// applyPlan persists it through the normal savePlan path.
export function CoachChat({ plan, onApplyPlan, showToast, onClose }) {
  // msg: { role: "user"|"coach", text, proposal?: {plan, diff} }
  const [msgs, setMsgs] = useState([{
    role: "coach",
    text: "Hi! Tell me what's going on — a niggle, a missed week, a schedule clash — and I'll suggest how to adapt your plan. You'll always see the change before anything is applied.",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trajectoryId, setTrajectoryId] = useState(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  // Only the most recent proposal is ever confirmable, and only while its
  // trajectory is still open — derived at render (not a per-message flag
  // mutated at every append site), so a stale "Apply" button can't survive an
  // append path that forgets to reset it.
  let lastProposalIndex = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].proposal) { lastProposalIndex = i; break; }

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs(m => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = trajectoryId ? await coachCritique(trajectoryId, text) : await coachPropose(text);
      track("coach_proposal", { status: res.status, round: res.roundIndex });
      if (res.status === "no_valid_adjustment") {
        // A failed round 0 closes the trajectory server-side (nothing to fall
        // back on); a failed critique leaves it open, so an earlier valid
        // proposal on this trajectory stays confirmable — trust the server's
        // trajectoryClosed flag rather than re-deriving it from roundIndex.
        setTrajectoryId(res.trajectoryClosed ? null : res.trajectoryId);
        setMsgs(m => [...m, { role: "coach", text: res.rationale }]);
      } else {
        if (!res.changed) {
          // Server supersedes the previous proposal even on changed:false — there
          // is nothing valid to confirm, so clear trajectoryId to hide Apply.
          setTrajectoryId(null);
          setMsgs(m => [...m, { role: "coach", text: res.rationale || "Nothing in the plan needs to change for that." }]);
        } else {
          setTrajectoryId(res.trajectoryId);
          const diff = diffPlans(plan, res.proposedPlan);
          setMsgs(m => [...m, { role: "coach", text: res.rationale, proposal: { diff } }]);
        }
      }
    } catch (err) {
      setMsgs(m => [...m, { role: "coach", text: err.message }]);
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
      const { plan: accepted, baseline: serverBaseline } = await coachConfirm(trajectoryId);
      // Clear before the client check: the server already accepted the trajectory,
      // so the Apply button must not survive a client-side validation failure
      // (which would let a retry call coachConfirm on an already-accepted trajectory).
      // Use the server's stored baseline so the waiver set matches what the server used.
      setTrajectoryId(null);
      const check = validatePlan(accepted, { baseline: serverBaseline ?? plan });
      if (!check.ok) throw new Error("The proposal no longer validates — nothing was applied.");
      onApplyPlan(accepted);
      track("coach_plan_applied");
      setMsgs(m => [...m, { role: "coach", text: "Done — your plan is updated. Anything else?" }]);
      showToast("Plan adjusted by your coach ✓");
    } catch (err) {
      setMsgs(m => [...m, { role: "coach", text: err.message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <div className="flex justify-between items-center px-4 border-b border-slate-800 flex-shrink-0" style={{height:44}}>
        <div className="flex items-center gap-1.5">
          <MessageCircle size={15} className="text-orange-400"/>
          <span className="text-sm font-semibold">Coach</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white p-1.5"><X size={18}/></button>
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
                      <p className="text-xs font-semibold text-slate-300">Week {w.weekNumber}</p>
                      {w.changes.map((c, j) => <p key={j} className="text-xs text-slate-400">· {c}</p>)}
                    </div>
                  ))}
                  {i === lastProposalIndex && trajectoryId && (
                    <button onClick={accept} disabled={busy}
                      className="w-full mt-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                      Apply this adjustment
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-slate-400 text-xs"><Loader size={14} className="animate-spin"/>Coach is thinking…</div>}
        <div ref={endRef}/>
      </div>

      <div className="border-t border-slate-800 p-3 flex-shrink-0">
        <div className="max-w-lg mx-auto flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") send(); }}
            placeholder={trajectoryId ? "Suggest an edit…" : "e.g. my knee hurts after yesterday's run"}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <button onClick={send} disabled={busy || !input.trim()} aria-label="Send"
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 rounded-xl transition-colors">
            <Send size={16}/>
          </button>
        </div>
      </div>
    </div>
  );
}
