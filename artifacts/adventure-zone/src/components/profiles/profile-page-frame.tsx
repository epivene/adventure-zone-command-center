import type { ReactNode } from "react";

export function ProfilePageFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="profile-modern -mx-4 -my-5 min-h-[100dvh] bg-[#f3f5f0] px-4 py-5 text-[#173b48] md:-mx-8 md:-my-7 md:px-8 md:py-7 lg:px-10" data-testid={testId}>
      <div className="mx-auto grid w-full max-w-[1420px] gap-5">{children}</div>
    </div>
  );
}
