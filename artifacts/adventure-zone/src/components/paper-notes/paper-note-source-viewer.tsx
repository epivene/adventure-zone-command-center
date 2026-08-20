import { useRef, useState } from "react";
import { FileImage, Upload, X } from "lucide-react";

export function PaperNoteSourceViewer({
  label,
  loadSource,
  restoreSource,
}: {
  label: string;
  loadSource(): Promise<{ url: string; kind: "original" | "analysis" }>;
  restoreSource?(file: File): Promise<void>;
}) {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    setUrl(null);
    try {
      const source = await loadSource();
      setUrl(source.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the source paper.");
    } finally {
      setLoading(false);
    }
  }

  async function show() {
    setOpen(true);
    await load();
  }

  async function restore(file: File) {
    if (!restoreSource || restoring) return;
    setRestoring(true);
    setError("");
    try {
      await restoreSource(file);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The original paper photo could not be restored.");
    } finally {
      setRestoring(false);
    }
  }

  function close() {
    setOpen(false);
    setUrl(null);
    setError("");
    queueMicrotask(() => openerRef.current?.focus());
  }

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
        onClick={() => void show()}
        ref={openerRef}
        type="button"
      >
        <FileImage className="h-4 w-4" /> View paper
      </button>

      {open ? (
        <div
          aria-label={`${label} source paper`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          role="dialog"
          tabIndex={-1}
        >
          <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3 sm:p-4">
              <div>
                <p className="text-sm font-bold text-slate-900">{label}</p>
                <p className="text-xs text-slate-500">Original private paper photo</p>
              </div>
              <button
                aria-label="Close source paper"
                className="min-h-11 min-w-11 rounded-lg border border-slate-200"
                onClick={close}
                type="button"
              >
                <X className="mx-auto h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 text-center sm:p-5">
              {loading ? <p className="py-12 text-sm font-semibold text-slate-600">Opening private source…</p> : null}
              {error ? (
                <div className="mx-auto max-w-lg rounded-xl bg-rose-50 p-4 text-left text-sm text-rose-900" role="alert">
                  <p>{error}</p>
                  {restoreSource ? (
                    <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 font-bold text-rose-900">
                      <Upload className="h-4 w-4" />
                      {restoring ? "Restoring…" : "Restore original photo"}
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        aria-label="Restore original photo"
                        className="sr-only"
                        disabled={restoring}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void restore(file);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                  ) : null}
                  {restoreSource ? (
                    <p className="mt-2 text-xs text-rose-800">Choose the exact same photo that was originally uploaded. A different image will be rejected.</p>
                  ) : null}
                </div>
              ) : null}
              {url ? (
                <img
                  alt={`Original paper photo for ${label}`}
                  className="mx-auto h-auto max-w-full rounded-lg bg-white shadow-sm"
                  src={url}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
