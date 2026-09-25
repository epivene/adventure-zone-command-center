import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** A single mounted panel: a modal sheet when compact, an inline rail when wide. */
export function WorkspacePanel({
  title,
  open,
  onOpenChange,
  minWidth,
  side = "right",
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  minWidth: number;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const query = `(min-width: ${minWidth}px)`;
  const [inline, setInline] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setInline(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (inline) {
      // Leave the modal top layer before showing the same children in the grid.
      if (node.open) node.close();
      node.setAttribute("open", "");
    } else {
      // An inline dialog's open attribute does not make it modal.
      if (node.open) node.close();
      if (open) node.showModal();
    }
  }, [inline, open]);

  return (
    <dialog
      ref={dialog}
      role={inline ? "complementary" : "dialog"}
      aria-label={inline ? title : undefined}
      aria-labelledby={inline ? undefined : titleId}
      aria-modal={inline ? undefined : true}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (inline || event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onOpenChange(false);
      }}
      className={
        inline
          ? "relative inset-auto m-0 min-w-0 w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground"
          : `fixed inset-y-0 m-0 h-[100dvh] max-h-none w-full max-w-[42rem] overflow-y-auto overscroll-contain border-0 bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-2xl backdrop:bg-slate-950/40 ${side === "left" ? "left-0 right-auto" : "left-auto right-0"}`
      }
    >
      <div
        className={
          inline ? "hidden" : "mb-4 flex items-center justify-between gap-3"
        }
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={`Close ${title.toLowerCase()}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border bg-white"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
