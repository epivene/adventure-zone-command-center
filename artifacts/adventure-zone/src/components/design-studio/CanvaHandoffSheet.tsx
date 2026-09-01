import { ExternalLink, RefreshCw, X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";

export function CanvaHandoffSheet({
  busy,
  onClose,
  onCreateNewCopy,
  onOpenExisting,
}: {
  busy: boolean;
  onClose: () => void;
  onCreateNewCopy: () => void;
  onOpenExisting: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="canva-handoff-title">
      <div className="w-full rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Canva handoff</p>
            <h2 className="mt-1 text-xl font-black" id="canva-handoff-title">Command Center has newer changes.</h2>
          </div>
          <Button aria-label="Close Canva options" disabled={busy} onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your existing Canva design is still there, but it represents an older saved version. Open that copy as-is, or make a new Canva copy from the current Command Center design.
        </p>
        <div className="mt-5 grid gap-2">
          <Button className="gap-2" disabled={busy} onClick={onCreateNewCopy}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Create new Canva copy
          </Button>
          <Button className="gap-2" disabled={busy} onClick={onOpenExisting} variant="outline">
            <ExternalLink className="h-4 w-4" />Open existing Canva design
          </Button>
        </div>
      </div>
    </div>
  );
}
