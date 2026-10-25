/** Shared by the board and the brief: a centred message with an optional action. */
import { Loader2, RefreshCw } from 'lucide-react';

export function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
      <span className="opacity-40">{icon}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

export function RetryButton({ onClick, busy, disabled }: { onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="mt-1 inline-flex h-control min-h-11 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      Try again
    </button>
  );
}
