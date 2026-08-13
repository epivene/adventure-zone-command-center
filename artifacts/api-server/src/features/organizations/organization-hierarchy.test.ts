import { describe, expect, it } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import { auditEntries, organizations } from "@/db/schema";
import {
  createOrganizationParent,
  HierarchyConflictError,
  setOrganizationParent,
  ungroupOrganization,
} from "./organization-hierarchy";

type Organization = {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  parentOrganizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RelatedRow = {
  id: string;
  organizationId?: string | null;
  entityId?: string;
};

type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type TestState = {
  organizations: Organization[];
  contacts: RelatedRow[];
  activities: RelatedRow[];
  bookings: RelatedRow[];
  followUps: RelatedRow[];
  callSessions: RelatedRow[];
  actExternalLinks: RelatedRow[];
  auditEntries: AuditEntry[];
  nextOrganizationId: string;
};

const parentId = "10000000-0000-4000-8000-000000000001";
const otherParentId = "10000000-0000-4000-8000-000000000002";
const childId = "20000000-0000-4000-8000-000000000001";
const secondChildId = "20000000-0000-4000-8000-000000000002";
const grandchildId = "30000000-0000-4000-8000-000000000001";
const createdParentId = "40000000-0000-4000-8000-000000000001";
const initialDate = new Date("2026-08-12T10:00:00.000Z");
const changedAt = new Date("2026-08-13T12:00:00.000Z");

function organization(
  id: string,
  name: string,
  parentOrganizationId: string | null = null,
): Organization {
  return {
    id,
    name,
    website: null,
    phone: null,
    parentOrganizationId,
    createdAt: initialDate,
    updatedAt: initialDate,
  };
}

function cloneState(state: TestState): TestState {
  return {
    ...state,
    organizations: state.organizations.map((row) => ({ ...row })),
    contacts: state.contacts.map((row) => ({ ...row })),
    activities: state.activities.map((row) => ({ ...row })),
    bookings: state.bookings.map((row) => ({ ...row })),
    followUps: state.followUps.map((row) => ({ ...row })),
    callSessions: state.callSessions.map((row) => ({ ...row })),
    actExternalLinks: state.actExternalLinks.map((row) => ({ ...row })),
    auditEntries: state.auditEntries.map((row) => ({
      ...row,
      before: row.before ? { ...row.before } : null,
      after: row.after ? { ...row.after } : null,
    })),
  };
}

function sqlParameters(value: unknown, seen = new Set<unknown>()): unknown[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (
    "value" in value &&
    value.constructor?.name === "Param"
  ) {
    return [(value as { value: unknown }).value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => sqlParameters(item, seen));
  }

  if ("queryChunks" in value) {
    return sqlParameters(
      (value as { queryChunks: unknown[] }).queryChunks,
      seen,
    );
  }

  return [];
}

class SelectBuilder {
  private condition: unknown;

  constructor(
    private readonly state: TestState,
    private readonly selection: Record<string, unknown> | undefined,
  ) {}

  from() {
    return this;
  }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  limit() {
    return this;
  }

  for(lock: string) {
    expect(lock).toBe("update");
    const ids = sqlParameters(this.condition).filter(
      (value): value is string => typeof value === "string",
    );
    if (this.selection && !("name" in this.selection)) {
      return Promise.resolve(
        this.state.organizations.filter(
          (row) =>
            row.parentOrganizationId !== null &&
            ids.includes(row.parentOrganizationId),
        ),
      );
    }
    return Promise.resolve(
      this.state.organizations.filter((row) => ids.includes(row.id)),
    );
  }
}

class UpdateBuilder {
  private values: Partial<Organization> = {};

  constructor(private readonly state: TestState) {}

  set(values: Partial<Organization>) {
    this.values = values;
    return this;
  }

  async where(condition: unknown) {
    const ids = sqlParameters(condition).filter(
      (value): value is string => typeof value === "string",
    );
    for (const row of this.state.organizations) {
      if (ids.includes(row.id)) Object.assign(row, this.values);
    }
  }
}

class InsertBuilder {
  private executed = false;
  private insertedOrganization: Organization | null = null;

  constructor(
    private readonly state: TestState,
    private readonly table: unknown,
    private readonly value: Record<string, unknown>,
  ) {}

  private execute() {
    if (this.executed) return;
    this.executed = true;

    if (this.table === organizations) {
      this.insertedOrganization = {
        id: this.state.nextOrganizationId,
        name: this.value.name as string,
        website: (this.value.website as string | null | undefined) ?? null,
        phone: (this.value.phone as string | null | undefined) ?? null,
        parentOrganizationId: null,
        createdAt: this.value.createdAt as Date,
        updatedAt: this.value.updatedAt as Date,
      };
      this.state.organizations.push(this.insertedOrganization);
      return;
    }

    if (this.table === auditEntries) {
      this.state.auditEntries.push(this.value as AuditEntry);
    }
  }

  returning() {
    this.execute();
    return Promise.resolve(
      this.insertedOrganization ? [{ id: this.insertedOrganization.id }] : [],
    );
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    try {
      this.execute();
      return Promise.resolve().then(onfulfilled, onrejected);
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
  }
}

class TestDatabase {
  state: TestState;

  constructor(organizationRows: Organization[]) {
    this.state = {
      organizations: organizationRows,
      contacts: [],
      activities: [],
      bookings: [],
      followUps: [],
      callSessions: [],
      actExternalLinks: [],
      auditEntries: [],
      nextOrganizationId: createdParentId,
    };
  }

  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    const draft = cloneState(this.state);
    const transaction = {
      select: (selection?: Record<string, unknown>) =>
        new SelectBuilder(draft, selection),
      update: () => new UpdateBuilder(draft),
      insert: (table: unknown) => ({
        values: (value: Record<string, unknown>) =>
          new InsertBuilder(draft, table, value),
      }),
    };

    const result = await work(transaction);
    this.state = draft;
    return result;
  }

  asApplicationDatabase() {
    return this as unknown as typeof ApplicationDatabase;
  }
}

function organizationById(database: TestDatabase, id: string) {
  return database.state.organizations.find((row) => row.id === id);
}

function seedPreservedRows(database: TestDatabase, id: string) {
  database.state.contacts.push({ id: "contact-1", organizationId: id });
  database.state.activities.push({ id: "activity-1", organizationId: id });
  database.state.bookings.push({ id: "booking-1", organizationId: id });
  database.state.followUps.push({ id: "follow-up-1", organizationId: id });
  database.state.callSessions.push({ id: "call-session-1", organizationId: id });
  database.state.actExternalLinks.push({ id: "act-link-1", entityId: id });
}

function preservedRows(database: TestDatabase) {
  return {
    contacts: database.state.contacts,
    activities: database.state.activities,
    bookings: database.state.bookings,
    followUps: database.state.followUps,
    callSessions: database.state.callSessions,
    actExternalLinks: database.state.actExternalLinks,
  };
}

describe("organization hierarchy operations", () => {
  it("attaches an existing location without moving its related rows", async () => {
    const database = new TestDatabase([
      organization(parentId, "Adventure Zone"),
      organization(childId, "Adventure Zone - Austin"),
    ]);
    seedPreservedRows(database, childId);
    const beforeRelationships = cloneState(database.state);

    await setOrganizationParent(
      database.asApplicationDatabase(),
      { childId, parentId },
      changedAt,
    );

    expect(organizationById(database, childId)).toMatchObject({
      id: childId,
      name: "Adventure Zone - Austin",
      parentOrganizationId: parentId,
      createdAt: initialDate,
      updatedAt: changedAt,
    });
    expect(preservedRows(database)).toEqual(preservedRows({ state: beforeRelationships } as TestDatabase));
    expect(database.state.auditEntries).toEqual([
      expect.objectContaining({
        entityType: "organization",
        entityId: childId,
        action: "organization_parent_set",
      }),
    ]);
  });

  it("creates a new organization-wide parent and attaches every selected location", async () => {
    const database = new TestDatabase([
      organization(childId, "Adventure Zone - Austin"),
      organization(secondChildId, "Adventure Zone - Denver"),
    ]);

    const result = await createOrganizationParent(
      database.asApplicationDatabase(),
      {
        name: "Adventure Zone",
        website: "https://example.com",
        phone: "555-0100",
        childIds: [childId, secondChildId],
      },
      changedAt,
    );

    expect(result).toEqual({ parentId: createdParentId });
    expect(organizationById(database, createdParentId)).toMatchObject({
      name: "Adventure Zone",
      website: "https://example.com",
      phone: "555-0100",
      parentOrganizationId: null,
      createdAt: changedAt,
      updatedAt: changedAt,
    });
    expect(organizationById(database, childId)?.parentOrganizationId).toBe(createdParentId);
    expect(organizationById(database, secondChildId)?.parentOrganizationId).toBe(createdParentId);
    expect(database.state.auditEntries).toEqual([
      expect.objectContaining({
        entityId: createdParentId,
        action: "organization_parent_created",
      }),
    ]);
  });

  it("moves a child from one parent to another", async () => {
    const database = new TestDatabase([
      organization(parentId, "Adventure Zone"),
      organization(otherParentId, "Adventure Zone International"),
      organization(childId, "Adventure Zone - Austin", parentId),
    ]);

    await setOrganizationParent(
      database.asApplicationDatabase(),
      { childId, parentId: otherParentId },
      changedAt,
    );

    expect(organizationById(database, childId)?.parentOrganizationId).toBe(otherParentId);
  });

  it("ungroups by clearing only parentOrganizationId", async () => {
    const database = new TestDatabase([
      organization(parentId, "Adventure Zone"),
      organization(childId, "Adventure Zone - Austin", parentId),
    ]);
    seedPreservedRows(database, childId);
    const beforeRelationships = cloneState(database.state);

    await ungroupOrganization(
      database.asApplicationDatabase(),
      { childId },
      changedAt,
    );

    expect(organizationById(database, childId)).toMatchObject({
      id: childId,
      name: "Adventure Zone - Austin",
      parentOrganizationId: null,
      createdAt: initialDate,
      updatedAt: changedAt,
    });
    expect(preservedRows(database)).toEqual(preservedRows({ state: beforeRelationships } as TestDatabase));
    expect(database.state.auditEntries).toEqual([
      expect.objectContaining({
        entityId: childId,
        action: "organization_parent_cleared",
      }),
    ]);
  });

  it("rejects self-parenting", async () => {
    const database = new TestDatabase([
      organization(childId, "Adventure Zone - Austin"),
    ]);

    await expect(
      setOrganizationParent(
        database.asApplicationDatabase(),
        { childId, parentId: childId },
        changedAt,
      ),
    ).rejects.toEqual(
      new HierarchyConflictError("A profile cannot be its own parent."),
    );
  });

  it("rejects assigning a child as a parent", async () => {
    const database = new TestDatabase([
      organization(parentId, "Adventure Zone"),
      organization(otherParentId, "Adventure Zone International"),
      organization(childId, "Adventure Zone - Austin", parentId),
    ]);

    await expect(
      setOrganizationParent(
        database.asApplicationDatabase(),
        { childId: otherParentId, parentId: childId },
        changedAt,
      ),
    ).rejects.toEqual(
      new HierarchyConflictError(
        "Adventure Zone - Austin is already a location and cannot own locations.",
      ),
    );
  });

  it("rejects assigning a parent-with-children beneath another parent", async () => {
    const database = new TestDatabase([
      organization(parentId, "Adventure Zone"),
      organization(otherParentId, "Adventure Zone International"),
      organization(childId, "Adventure Zone - Austin", parentId),
    ]);

    await expect(
      setOrganizationParent(
        database.asApplicationDatabase(),
        { childId: parentId, parentId: otherParentId },
        changedAt,
      ),
    ).rejects.toEqual(
      new HierarchyConflictError(
        "Adventure Zone already owns locations and cannot become a location.",
      ),
    );
  });

  it("rolls back all child assignments when one selected child is invalid", async () => {
    const database = new TestDatabase([
      organization(childId, "Adventure Zone - Austin"),
      organization(secondChildId, "Adventure Zone - Denver"),
      organization(grandchildId, "Adventure Zone - Downtown", secondChildId),
    ]);
    const before = cloneState(database.state);

    await expect(
      createOrganizationParent(
        database.asApplicationDatabase(),
        {
          name: "Adventure Zone",
          website: null,
          phone: null,
          childIds: [childId, secondChildId],
        },
        changedAt,
      ),
    ).rejects.toEqual(
      new HierarchyConflictError(
        "Adventure Zone - Denver already owns locations and cannot become a location.",
      ),
    );

    expect(database.state).toEqual(before);
  });
});
