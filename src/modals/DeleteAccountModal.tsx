import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "../supabase";

type DeleteAccountModalProps = { onSignOut: () => void; onClose: () => void };

export function DeleteAccountModal({ onSignOut, onClose }: DeleteAccountModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("delete_my_account");
    if (rpcError) {
      setError("Something went wrong. Please try again or email theo.camboulive.dev@gmail.com.");
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    onSignOut();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-500/20 rounded-full p-2 shrink-0">
            <AlertTriangle size={20} className="text-red-400"/>
          </div>
          <p className="text-base font-semibold text-slate-100">Delete account</p>
        </div>

        <p className="text-sm text-slate-300">
          This permanently deletes your account and all associated data — runs,
          GPS routes, training plan, and settings. <strong className="text-slate-100">This cannot be undone.</strong>
        </p>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
          >
            {busy ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"/>
            ) : (
              <><Trash2 size={14}/>Delete</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
