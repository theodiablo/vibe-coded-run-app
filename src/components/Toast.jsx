// Presentational only; the auto-dismiss timer lives in the parent so this
// stays a pure component.
export function Toast({msg, type}) {
  return (
    <div className="fixed left-4 right-4 max-w-md mx-auto z-50" style={{top:52}}>
      <div className={"py-2.5 px-4 rounded-xl text-sm font-medium text-center shadow-lg text-white " + (type === "err" ? "bg-red-500" : "bg-emerald-500")}>
        {msg}
      </div>
    </div>
  );
}
