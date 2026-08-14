import { asc, eq, inArray } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { lockOrganizationHierarchyMutationDomain } from "./organization-family-lock";
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

async function lockOrganizations(
  transaction: HierarchyTransaction,
  organizationIds: string[],
): Promise<LockedOrganization[]> {
  const orderedIds = [...new Set(organizationIds)].sort();
  if (!orderedIds.length) return [];

  return transaction
    .select({
      id: organizations.id,
      name: organizations.name,
      parentOrganizationId: organizations.parentOrganizationId,
    })
    .from(organizations)
    .where(inArray(organizations.id, orderedIds))
    .orderBy(asc(organizations.id))
    .for("update");
}

async function lockOrganization(
  transaction: HierarchyTransaction,
  organizationId: string,
): Promise<LockedOrganization> {
  const [organization] = await lockOrganizations(transaction, [organizationId]);
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
    .where(
      inArray(organizations.parentOrganizationId, [...parentIds].sort()),
    )
    .orderBy(asc(organizations.id))
    .for("update");
}

export async function setOrganizationParentsInTransaction(
  transaction: HierarchyTransaction,
  input: { parentId: string; childIds: string[] },
  changedAt: Date,
): Promise<void> {
    const childIds = [...new Set(input.childIds)].sort();
    if (!childIds.length) {
      throw new HierarchyConflictError("Select at least one location profile.");
    }
    if (childIds.includes(input.parentId)) {
      throw new HierarchyConflictError("A profile cannot be its own parent.");
    }

    await lockOrganizationHierarchyMutationDomain(transaction);
    const involvedOrganizations = await lockOrganizations(transaction, [
      input.parentId,
      ...childIds,
    ]);
    const organizationById = new Map(
      involvedOrganizations.map((organization) => [
        organization.id,
        organization,
      ]),
    );
    const parent = organizationById.get(input.parentId);
    const children = childIds.flatMap((childId) => {
      const child = organizationById.get(childId);
      return child ? [child] : [];
    });
    if (!parent || children.length !== childIds.length) {
      throw new HierarchyConflictError(
        "The selected organization profile no longer exists.",
      );
    }
    if (parent.parentOrganizationId) {
      throw new HierarchyConflictError(
        `${parent.name} is already a location and cannot own locations.`,
      );
    }

    const childLocations = await lockOwnedLocations(transaction, childIds);
    const childParentIds = new Set(
      childLocations.flatMap((location) =>
        location.parentOrganizationId ? [location.parentOrganizationId] : [],
      ),
    );
    for (const child of children) {
      if (childParentIds.has(child.id)) {
        throw new HierarchyConflictError(
          `${child.name} already owns locations and cannot become a location.`,
        );
      }
    }

    for (const child of children) {
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
    }
}

export async function setOrganizationParents(
  database: HierarchyDatabase,
  input: { parentId: string; childIds: string[] },
  changedAt: Date,
): Promise<void> {
  await database.transaction((transaction) =>
    setOrganizationParentsInTransaction(transaction, input, changedAt),
  );
}

export async function setOrganizationParent(
  database: HierarchyDatabase,
  input: SetOrganizationParentInput,
  changedAt: Date,
): Promise<void> {
  await setOrganizationParents(
    database,
    { parentId: input.parentId, childIds: [input.childId] },
    changedAt,
  );
}

export async function ungroupOrganization(
  database: HierarchyDatabase,
  input: UngroupOrganizationInput,
  changedAt: Date,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await lockOrganizationHierarchyMutationDomain(transaction);
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

export async function createOrganizationParentInTransaction(
  transaction: HierarchyTransaction,
  input: CreateOrganizationParentInput,
  changedAt: Date,
): Promise<{ parentId: string }> {
    await lockOrganizationHierarchyMutationDomain(transaction);
    const childIds = [...new Set(input.childIds)];
    const children = await transaction
      .select({
        id: organizations.id,
        name: organizations.name,
        parentOrganizationId: organizations.parentOrganizationId,
      })
      .from(organizations)
      .where(inArray(organizations.id, [...childIds].sort()))
      .orderBy(asc(organizations.id))
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
}

export async function createOrganizationParent(
  database: HierarchyDatabase,
  input: CreateOrganizationParentInput,
  changedAt: Date,
): Promise<{ parentId: string }> {
  return database.transaction((transaction) =>
    createOrganizationParentInTransaction(transaction, input, changedAt),
  );
}
