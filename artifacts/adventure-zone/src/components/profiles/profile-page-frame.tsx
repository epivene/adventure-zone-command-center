import type { ReactNode } from "react";

export function ProfilePageFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="-mx-4 -my-5 min-h-dvh overflow-x-clip bg-background px-4 py-5 text-foreground md:-mx-8 md:-my-7 md:px-8 md:py-7 lg:px-10" data-testid={testId}>
      <div className="mx-auto grid min-w-0 w-full max-w-[1420px] grid-cols-1 gap-5">{children}</div>
    </div>
  );
}
