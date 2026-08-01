import { eq } from "drizzle-orm";

import { contacts, organizationContacts } from "@/db/schema";
import type {
  RelationshipSource,
  RelationshipWriter,
} from "@/features/relationships/relationship-types";

export async function ensurePlacePersonRelationship(
  writer: RelationshipWriter,
  input: {
    organizationId: string;
    contactId: string;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  await writer
    .insert(organizationContacts)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      active: true,
      source: input.source,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        organizationContacts.organizationId,
        organizationContacts.contactId,
      ],
      set: {
        active: true,
        source: input.source,
        updatedAt: input.now,
      },
    });
}

export async function setContactPrimaryOrganization(
  writer: RelationshipWriter,
  input: {
    contactId: string;
    organizationId: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  const [contact] = await writer
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, input.contactId))
    .limit(1)
    .for("update");
  if (!contact) throw new Error("Cannot set a primary Place for a missing Person.");

  if (input.organizationId) {
    await ensurePlacePersonRelationship(writer, {
      organizationId: input.organizationId,
      contactId: input.contactId,
      source: input.source,
      now: input.now,
    });
  }

  await writer
    .update(contacts)
    .set({ organizationId: input.organizationId, updatedAt: input.now })
    .where(eq(contacts.id, input.contactId));
}
