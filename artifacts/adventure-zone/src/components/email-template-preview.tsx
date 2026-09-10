import { useEffect, useMemo, useRef, useState } from "react";
import { buildEmailPreview } from "@/lib/email-preview";

/** Scale the preview canvas, never the saved or sent email. */
export function EmailTemplatePreview({ html, title }: { html: string; title: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [fit, setFit] = useState(true);
  const document = useMemo(() => buildEmailPreview(html), [html]);
  const canvasWidth = 760;
  const scale = fit && availableWidth > 0 ? Math.min(1, availableWidth / canvasWidth) : 1;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted p-2">
        <button type="button" aria-pressed={fit} onClick={() => setFit(true)}
          className={`min-h-11 rounded-md px-3 text-sm font-semibold ${fit ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}>
          Fit to screen
        </button>
        <button type="button" aria-pressed={!fit} onClick={() => setFit(false)}
          className={`min-h-11 rounded-md px-3 text-sm font-semibold ${!fit ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}>
          Full size
        </button>
        {!fit && availableWidth < canvasWidth ? <span className="text-xs text-muted-foreground">Swipe sideways to see the rest.</span> : null}
      </div>
      <div ref={viewport} className="h-[min(65dvh,38rem)] min-h-72 min-w-0 max-w-full overflow-auto overscroll-contain bg-muted">
        <div className="relative mx-auto h-full overflow-hidden bg-white" style={{ width: canvasWidth * scale }}>
          <iframe
            title={title}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={document}
            className="absolute left-0 top-0 border-0 bg-white"
            style={{ width: canvasWidth, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "top left" }}
          />
        </div>
      </div>
    </div>
  );
}
