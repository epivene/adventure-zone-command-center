import { Download, FileImage, FileText, RefreshCw, X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";

export function ExportSheet({
  exporting,
  onExportPng,
  onExportPdf,
  onClose,
}: {
  exporting: "png" | "pdf" | null;
  onExportPng: () => void;
  onExportPdf: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45" role="dialog" aria-modal="true" aria-label="Export design">
      <div className="w-full rounded-t-3xl border border-border bg-card p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">Take it with you</p>
            <h2 className="text-lg font-black">Export design</h2>
          </div>
          <Button aria-label="Close export" disabled={Boolean(exporting)} onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-2xl border border-border bg-background p-4 text-left transition hover:border-primary hover:shadow-md disabled:opacity-60"
            disabled={Boolean(exporting)}
            onClick={onExportPng}
            type="button"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {exporting === "png" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <FileImage className="h-5 w-5" />}
              </div>
              <div>
                <p className="font-black">PNG image</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Best for social posts, email graphics, and quick sharing.</p>
              </div>
            </div>
          </button>

          <button
            className="rounded-2xl border border-border bg-background p-4 text-left transition hover:border-primary hover:shadow-md disabled:opacity-60"
            disabled={Boolean(exporting)}
            onClick={onExportPdf}
            type="button"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {exporting === "pdf" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
              </div>
              <div>
                <p className="font-black">PDF design</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Best for printing and document sharing.</p>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <Download className="h-4 w-4 shrink-0" />
          Exports use the current Command Center design.
        </div>
      </div>
    </div>
  );
}
