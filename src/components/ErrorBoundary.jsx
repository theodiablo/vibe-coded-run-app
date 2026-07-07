import { Component } from "react";
import { AlertTriangle } from "lucide-react";
import { isNative } from "../native";
import { getConsent, captureError } from "../telemetry";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";

// App-wide crash guard. A render-time exception anywhere below this boundary
// would otherwise white-screen the user; instead we show a friendly fallback
// with a reload, and feed the crash to telemetry under the consent rules:
//
//   • web   — auto-report when the user hasn't opted out of analytics.
//   • native — hold the report and ask the user, per crash, whether to send it
//     (their explicit requirement). Nothing is uploaded until they tap "Send".
//
// Class component because error boundaries have no hooks equivalent.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // decision: null = undecided (native prompt showing), "sent" | "declined".
    this.state = { error: null, decision: null, showDetails: false, copied: false };
    this.info = null;
    this.kind = "react";
  }

  static getDerivedStateFromError(error) {
    return { error, decision: null };
  }

  componentDidCatch(error, info) {
    this.info = info;
    this.kind = "react";
    // Web auto-reports (consent permitting); native waits for the user.
    if (!isNative && getConsent()) {
      this.report();
      this.setState({ decision: "sent" });
    }
  }

  componentDidMount() {
    if (!isNative) return;
    this.onWindowError = (e) => {
      this.info = null;
      this.kind = "window.error";
      this.setState({ error: e.error || new Error(e.message || "Unknown error"), decision: null, showDetails: true, copied: false });
    };
    this.onUnhandledRejection = (e) => {
      this.info = null;
      this.kind = "unhandledrejection";
      const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
      this.setState({ error: err, decision: null, showDetails: true, copied: false });
    };
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  componentWillUnmount() {
    if (!isNative) return;
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  traceText() {
    const err = this.state.error;
    if (!err) return "";
    return [
      "Running Coach crash report",
      "Time: " + new Date().toISOString(),
      "Kind: " + this.kind,
      "Native: " + String(isNative),
      "URL: " + window.location.href,
      "User agent: " + navigator.userAgent,
      "",
      "Error: " + (err.name || "Error") + ": " + (err.message || String(err)),
      "",
      err.stack || "No JS stack available.",
      this.info?.componentStack ? "\nComponent stack:\n" + this.info.componentStack : "",
    ].filter(Boolean).join("\n");
  }

  report() {
    captureError(this.state.error, {
      kind: this.kind,
      componentStack: this.info?.componentStack,
      trace: this.traceText(),
    });
  }

  send = () => {
    this.report();
    this.setState({ decision: "sent" });
  };

  decline = () => this.setState({ decision: "declined" });

  toggleDetails = () => this.setState(prev => ({ showDetails: !prev.showDetails }));

  copyTrace = () => {
    const text = this.traceText();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => this.setState({ copied: true }))
        .catch(() => this.setState({ showDetails: true }));
    } else {
      this.setState({ showDetails: true });
    }
  };

  emailTrace = () => {
    if (!SUPPORT_EMAIL) return;
    const subject = encodeURIComponent("Running Coach crash trace");
    const body = encodeURIComponent(this.traceText());
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  // Full reload — after a render crash the React tree is in an unknown state.
  reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    // Show the per-crash report prompt only on native, only while undecided.
    const askToSend = isNative && this.state.decision === null;

    return (
      <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-slate-800 rounded-2xl p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertTriangle className="text-orange-400" size={32} />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold">Something went wrong</p>
            <p className="text-sm text-slate-400">
              The app hit an unexpected error. Reloading usually fixes it — your
              runs and plan are saved.
            </p>
          </div>

          <div className="space-y-2 text-left">
            <button onClick={this.toggleDetails}
              className="w-full py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
              {this.state.showDetails ? "Hide error trace" : "Show error trace"}
            </button>
            {this.state.showDetails && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 border border-slate-700 p-3 text-[11px] text-slate-300 text-left">
                {this.traceText()}
              </pre>
            )}
            <div className={"grid gap-2 " + (SUPPORT_EMAIL ? "grid-cols-2" : "grid-cols-1")}>
              <button onClick={this.copyTrace}
                className="py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                {this.state.copied ? "Copied" : "Copy trace"}
              </button>
              {SUPPORT_EMAIL ? (
                <button onClick={this.emailTrace}
                  className="py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                  Email trace
                </button>
              ) : null}
            </div>
          </div>

          {askToSend ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Send a limited crash report to help fix this?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={this.decline}
                  className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                  Don&apos;t send
                </button>
                <button onClick={this.send}
                  className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                  Send report
                </button>
              </div>
            </div>
          ) : (
            <>
              {this.state.decision === "sent" && (
                <p className="text-xs text-emerald-400">Crash report sent. Thank you.</p>
              )}
              <button onClick={this.reload}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                Reload
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
}
