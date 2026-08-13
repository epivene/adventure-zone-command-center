import { eq, inArray } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type {
  CreateOrganizationParentInput,
  SetOrganizationParentInput,
  UngroupOrganizationInput,
} from "./organization-hierarchy-input";

type HierarchyDatabase = Pick<typeof applicationDatabase, "transaction">;
type HierarchyTransaction = Parameters<
  Parameters<HierarchyDatabase["transaction"]>[0]
>[0];

type LockedOrganization = {
  id: string;
  name: string;
  parentOrganizationId: string | null;
};

export class HierarchyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HierarchyConflictError";
  }
}

async function lockOrganization(
  transaction: HierarchyTransaction,
  organizationId: string,
): Promise<LockedOrganization> {
  const [organization] = await transaction
    .select({
      id: organizations.id,
      name: organizations.name,
      parentOrganizationId: organizations.parentOrganizationId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
    .for("update");

  if (!organization) {
    throw new HierarchyConflictError(
      "The selected organization profile no longer exists.",
    );
  }
  return organization;
}

async function lockOwnedLocations(
  transaction: HierarchyTransaction,
  parentIds: string[],
) {
  if (!parentIds.length) return [];

  return transaction
    .select({ parentOrganizationId: organizations.parentOrganizationId })
    .from(organizations)
    .where(inArray(organizations.parentOrganizationId, parentIds))
    .for("update");
}

export async function setOrganizationParent(
  database: HierarchyDatabase,
  input: SetOrganizationParentInput,
  changedAt: Date,
): Promise<void> {
  await database.transaction(async (transaction) => {
    if (input.childId === input.parentId) {
      throw new HierarchyConflictError("A profile cannot be its own parent.");
    }

    const parent = await lockOrganization(transaction, input.parentId);
    const child = await lockOrganization(transaction, input.childId);

    if (parent.parentOrganizationId) {
      throw new HierarchyConflictError(
        `${parent.name} is already a location and cannot own locations.`,
      );
    }

    const childLocations = await lockOwnedLocations(transaction, [child.id]);
    if (childLocations.length) {
      throw new HierarchyConflictError(
        `${child.name} already owns locations and cannot become a location.`,
      );
    }

    await transaction
      .update(organizations)
      .set({
        parentOrganizationId: parent.id,
        updatedAt: changedAt,
      })
      .where(eq(organizations.id, child.id));

    await recordAuditEntry(transaction, {
      entityType: "organization",
      entityId: child.id,
      action: "organization_parent_set",
      before: { parentOrganizationId: child.parentOrganizationId },
      after: { parentOrganizationId: parent.id },
    });
  });
}

export async function ungroupOrganization(
  database: HierarchyDatabase,
  input: UngroupOrganizationInput,
  changedAt: Date,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const child = await lockOrganization(transaction, input.childId);

    await transaction
      .update(organizations)
      .set({
        parentOrganizationId: null,
        updatedAt: changedAt,
      })
      .where(eq(organizations.id, child.id));

    await recordAuditEntry(transaction, {
      entityType: "organization",
      entityId: child.id,
      action: "organization_parent_cleared",
      before: { parentOrganizationId: child.parentOrganizationId },
      after: { parentOrganizationId: null },
    });
  });
}

export async function createOrganizationParent(
  database: HierarchyDatabase,
  input: CreateOrganizationParentInput,
  changedAt: Date,
): Promise<{ parentId: string }> {
  return database.transaction(async (transaction) => {
    const childIds = [...new Set(input.childIds)];
    const children = await transaction
      .select({
        id: organizations.id,
        name: organizations.name,
        parentOrganizationId: organizations.parentOrganizationId,
      })
      .from(organizations)
      .where(inArray(organizations.id, childIds))
      .for("update");

    if (children.length !== childIds.length) {
      throw new HierarchyConflictError(
        "A selected location profile no longer exists.",
      );
    }

    const childLocations = await lockOwnedLocations(transaction, childIds);
    const parentIds = new Set(
      childLocations.flatMap((location) =>
        location.parentOrganizationId ? [location.parentOrganizationId] : [],
      ),
    );
    for (const child of children) {
      if (parentIds.has(child.id)) {
        throw new HierarchyConflictError(
          `${child.name} already owns locations and cannot become a location.`,
        );
      }
    }

    const [parent] = await transaction
      .insert(organizations)
      .values({
        name: input.name,
        website: input.website ?? null,
        phone: input.phone ?? null,
        createdAt: changedAt,
        updatedAt: changedAt,
      })
      .returning({ id: organizations.id });
    if (!parent) {
      throw new Error("Could not create the organization parent.");
    }

    for (const child of children) {
      await transaction
        .update(organizations)
        .set({
          parentOrganizationId: parent.id,
          updatedAt: changedAt,
        })
        .where(eq(organizations.id, child.id));
    }

    await recordAuditEntry(transaction, {
      entityType: "organization",
      entityId: parent.id,
      action: "organization_parent_created",
      before: null,
      after: {
        name: input.name,
        website: input.website ?? null,
        phone: input.phone ?? null,
        childIds,
      },
    });

    return { parentId: parent.id };
  });
}
