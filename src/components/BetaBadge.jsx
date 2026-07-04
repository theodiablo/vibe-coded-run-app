export function BetaBadge({ label = "Beta" }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
      {label}
    </span>
  );
}
