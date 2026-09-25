import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { Screenshot } from "@/features/assistant-workspace/types";
import { readScreenshot } from "@/features/assistant-workspace/screenshots";
export type PendingScreenshot = {
  id: string;
  file: File;
  url: string;
  uploadedTo?: string;
};
export function ScreenshotPicker({
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  files: PendingScreenshot[];
  disabled: boolean;
  onAdd(files: File[]): void;
  onRemove(id: string): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      {!!files.length && (
        <ul
          className="flex max-h-32 flex-wrap gap-2 overflow-y-auto"
          aria-label="Attached screenshots"
        >
          {files.map((f) => (
            <li
              key={f.id}
              className="relative w-28 rounded-lg border bg-slate-50 p-1"
            >
              <img
                src={f.url}
                alt={`Preview: ${f.file.name}`}
                className="h-20 w-full rounded object-contain"
              />
              <p className="truncate px-1 text-xs">{f.file.name}</p>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${f.file.name}`}
                onClick={() => onRemove(f.id)}
                className="absolute right-0 top-0 rounded-full border bg-white p-1 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label="Attach screenshots"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || files.length >= 4}
        onClick={() => picker.current?.click()}
        className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        <ImagePlus className="mr-2 inline h-4 w-4" />
        Attach screenshots
      </button>
      <p className="text-xs text-slate-500">
        Paste or drop images here. Up to 4 PNG, JPEG or WebP images, 5 MB each.
      </p>
    </div>
  );
}
export function SavedScreenshot({
  conversationId,
  attachment,
}: {
  conversationId: string;
  attachment: Screenshot;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl = "";
    setFailed(false);
    setUrl("");
    void readScreenshot(conversationId, attachment.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, attachment.id, visible, retry]);
  return (
    <div ref={element} className="mt-2 w-40 rounded-lg border bg-white p-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${attachment.filename}`}
        >
          <img
            src={url}
            alt={attachment.filename}
            className="h-28 w-full object-contain"
          />
        </a>
      ) : (
        <div className="flex h-28 items-center justify-center text-xs text-slate-500">
          {failed ? (
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Retry image
            </button>
          ) : (
            "Loading screenshot…"
          )}
        </div>
      )}
      <p className="mt-1 truncate text-xs" title={attachment.filename}>
        {attachment.filename}
      </p>
    </div>
  );
}
