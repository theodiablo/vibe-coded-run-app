// Presentational only; the auto-dismiss timer lives in the parent so this
// stays a pure component. An optional `action` ({label, onClick}) renders an
// inline button (e.g. Undo).
export function Toast({msg, type, action}) {
  return (
    <div className="fixed left-4 right-4 max-w-md mx-auto z-50" style={{top:52}}>
      <div className={"py-2.5 px-4 rounded-xl text-sm font-medium shadow-lg text-white flex items-center justify-center gap-3 " + (type === "err" ? "bg-red-500" : "bg-emerald-500")}>
        <span>{msg}</span>
        {action && (
          <button onClick={action.onClick}
            className="flex-shrink-0 underline underline-offset-2 font-semibold hover:opacity-80">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
