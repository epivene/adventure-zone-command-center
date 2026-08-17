import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { Link } from "wouter";

export type ResponsiveDetailSheetProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
  fullPageHref?: string;
};

export function ResponsiveDetailSheet({
  open,
  onOpenChange,
  title,
  children,
  fullPageHref,
}: ResponsiveDetailSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-white shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right md:inset-y-0 md:left-auto md:right-0 md:w-[min(45vw,44rem)] md:min-w-[28rem] md:border-l md:border-slate-200"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 sm:px-4">
            <Dialog.Close asChild>
              <button
                aria-label="Back"
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 md:hidden"
                type="button"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            </Dialog.Close>
            <Dialog.Title className="min-w-0 flex-1 truncate text-lg font-bold text-slate-950">
              {title}
            </Dialog.Title>
            {fullPageHref ? (
              <Link
                className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-orange-700 hover:bg-orange-50"
                data-open-full-profile="true"
                href={fullPageHref}
                onClick={() => onOpenChange(false)}
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open full</span>
              </Link>
            ) : null}
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="hidden min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:inline-flex"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-5">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
