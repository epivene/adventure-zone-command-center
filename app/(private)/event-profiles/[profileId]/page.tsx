import { notFound } from "next/navigation";

import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";
import { organizationIdSchema } from "@/features/organizations/last-resort-input";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EventProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ contactId?: string | string[] }>;
}) {
  await requireOwner();
  const { profileId } = await params;
  if (!organizationIdSchema.safeParse(profileId).success) notFound();
  const query = await searchParams;
  const { db } = await import("@/db/client");
  const profile = await new DrizzleEventProfileRepository(db).getEventProfile(
    profileId,
    firstValue(query.contactId),
  );
  if (!profile) notFound();

  return <EventProfileWorkspace profile={profile} />;
}
