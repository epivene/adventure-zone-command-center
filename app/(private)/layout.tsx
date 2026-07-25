import type { ReactNode } from "react";
import { AppShell } from "@/components/navigation/app-shell";
import { requireOwner } from "@/lib/auth/require-owner";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  await requireOwner();

  return <AppShell>{children}</AppShell>;
}
