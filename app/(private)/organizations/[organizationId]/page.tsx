import { notFound, redirect } from "next/navigation";

import { organizationIdSchema } from "@/features/organizations/last-resort-input";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

/** Legacy place detail URLs now open the unified event profile workspace. */
export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireOwner();
  const { organizationId } = await params;
  if (!organizationIdSchema.safeParse(organizationId).success) notFound();
  redirect(`/event-profiles/${organizationId}`);
}
