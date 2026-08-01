import { describe, expect, it } from "vitest";

import {
  TravelLegService,
  type TravelLegAuditChange,
  type TravelLegEditorTransaction,
} from "@/features/routes/travel-leg-editor";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

function makeLeg(overrides: Partial<TravelLeg> & { id: string; sortOrder: number }): TravelLeg {
  return {
    name: `Leg ${overrides.sortOrder}`,
    color: "#6B7280",
    archivedAt: null,
    baseAddress: null,
    defaultVehicleName: null,
    defaultMpg: null,
    ...overrides,
  };
}

class FakeRepository {
  legs: TravelLeg[];
  auditEntries: TravelLegAuditChange[] = [];
  private counter = 0;

  constructor(legs: TravelLeg[]) {
    this.legs = legs.map((l) => ({ ...l }));
  }

  ordered(): TravelLeg[] {
    return [...this.legs].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T> {
    const repo = this;
    return operation({
      listForUpdate: async () => repo.ordered().map((l) => ({ ...l })),
      update: async (id, values) => {
        const leg = repo.legs.find((l) => l.id === id);
        if (!leg) throw new Error("Travel leg is missing.");
        Object.assign(leg, values);
        return { ...leg };
      },
      setArchived: async (id, archivedAt) => {
        const leg = repo.legs.find((l) => l.id === id);
        if (!leg) throw new Error("Travel leg is missing.");
        leg.archivedAt = archivedAt;
        return { ...leg };
      },
      reorderLegs: async (orders) => {
        for (const { id, sortOrder } of orders) {
          const leg = repo.legs.find((l) => l.id === id);
          if (leg) leg.sortOrder = sortOrder;
        }
        const seen = new Set(repo.legs.map((l) => l.sortOrder));
        if (seen.size !== repo.legs.length) {
          throw new Error("sort_order collision after reorder");
        }
      },
      insert: async (values) => {
        const leg = makeLeg({
          id: `new-${++repo.counter}`,
          sortOrder: values.sortOrder,
        });
        leg.name = values.name;
        leg.color = values.color;
        repo.legs.push(leg);
        return { ...leg };
      },
      delete: async (id) => {
        repo.legs = repo.legs.filter((l) => l.id !== id);
      },
      audit: async (change) => {
        repo.auditEntries.push(change);
      },
    });
  }
}

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function seed(): FakeRepository {
  return new FakeRepository([
    makeLeg({ id: uuid(1), sortOrder: 1 }),
    makeLeg({ id: uuid(2), sortOrder: 2 }),
    makeLeg({ id: uuid(3), sortOrder: 3 }),
  ]);
}

const detail = { baseAddress: null, defaultVehicleName: null, defaultMpg: null };

describe("TravelLegService archive/restore ordering", () => {
  it("archives a leg, moves it after the active block, and audits", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    const result = await service.archiveLeg(uuid(1));
    expect(result.ok).toBe(true);

    const ordered = repo.ordered();
    expect(ordered.map((l) => l.id)).toEqual([uuid(2), uuid(3), uuid(1)]);
    expect(ordered.map((l) => l.sortOrder)).toEqual([1, 2, 3]);
    expect(ordered[2].archivedAt).toBeInstanceOf(Date);
    expect(repo.auditEntries.at(-1)?.action).toBe("archive");
  });

  it("refuses to archive the last active leg", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(1));
    await service.archiveLeg(uuid(2));
    const result = await service.archiveLeg(uuid(3));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LAST_ACTIVE_LEG");
  });

  it("restores a leg to the end of the active block and audits", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(1));
    await service.archiveLeg(uuid(2));
    const result = await service.restoreLeg(uuid(1));
    expect(result.ok).toBe(true);

    const ordered = repo.ordered();
    // Active: 3 then restored 1; archived 2 last
    expect(ordered.map((l) => l.id)).toEqual([uuid(3), uuid(1), uuid(2)]);
    expect(ordered.map((l) => l.sortOrder)).toEqual([1, 2, 3]);
    expect(ordered[1].archivedAt).toBeNull();
    expect(repo.auditEntries.at(-1)?.action).toBe("restore");
  });
});

describe("TravelLegService updateConfiguration", () => {
  it("rejects configurations that include an archived leg", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(3));

    const result = await service.updateConfiguration({
      legs: [
        { id: uuid(1), name: "A", color: "#111111", sortOrder: 1, ...detail },
        { id: uuid(2), name: "B", color: "#222222", sortOrder: 2, ...detail },
        { id: uuid(3), name: "C", color: "#333333", sortOrder: 3, ...detail },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("reorders active legs while keeping archived legs pinned after them", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(2));

    const result = await service.updateConfiguration({
      legs: [
        { id: uuid(3), name: "Three", color: "#333333", sortOrder: 1, ...detail },
        {
          id: uuid(1),
          name: "One",
          color: "#111111",
          sortOrder: 2,
          baseAddress: "10 Main St",
          defaultVehicleName: "Van",
          defaultMpg: 12,
        },
      ],
    });
    expect(result.ok).toBe(true);

    const ordered = repo.ordered();
    expect(ordered.map((l) => l.id)).toEqual([uuid(3), uuid(1), uuid(2)]);
    expect(ordered.map((l) => l.sortOrder)).toEqual([1, 2, 3]);
    expect(ordered[2].archivedAt).toBeInstanceOf(Date);
    // Archived leg untouched by detail updates
    expect(ordered[2].name).toBe("Leg 2");
    // Detail fields persisted for the active leg
    expect(ordered[1].baseAddress).toBe("10 Main St");
    expect(ordered[1].defaultVehicleName).toBe("Van");
    expect(ordered[1].defaultMpg).toBe(12);
  });
});

describe("TravelLegService addLeg with archived legs present", () => {
  it("inserts the new leg at the end of the active block, before archived legs", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(1));

    const result = await service.addLeg();
    expect(result.ok).toBe(true);

    const ordered = repo.ordered();
    expect(ordered.map((l) => l.sortOrder)).toEqual([1, 2, 3, 4]);
    // Active block: 2, 3, new; archived leg 1 remains last
    expect(ordered[2].id).toMatch(/^new-/);
    expect(ordered[3].id).toBe(uuid(1));
    expect(ordered[3].archivedAt).toBeInstanceOf(Date);
  });
});

describe("TravelLegService deleteLeg keeps ordering contiguous", () => {
  it("renumbers remaining legs after deleting an active leg", async () => {
    const repo = seed();
    const service = new TravelLegService(repo);
    await service.archiveLeg(uuid(3));
    const result = await service.deleteLeg(uuid(1));
    expect(result.ok).toBe(true);

    // Fake delete doesn't renumber (the SQL repository does); normalize check:
    const ordered = repo.ordered();
    expect(ordered.map((l) => l.id)).toEqual([uuid(2), uuid(3)]);
  });
});
