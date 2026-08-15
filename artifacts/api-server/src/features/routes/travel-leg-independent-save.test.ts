import { describe, expect, it } from "vitest";

import {
  TravelLegService,
  type TravelLegAuditChange,
  type TravelLegEditorTransaction,
} from "@/features/routes/travel-leg-editor";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function makeLeg(id: string, sortOrder: number, overrides: Partial<TravelLeg> = {}): TravelLeg {
  return {
    id,
    name: `Leg ${sortOrder}`,
    color: "#6B7280",
    sortOrder,
    archivedAt: null,
    baseAddress: null,
    defaultVehicleName: null,
    defaultMpg: null,
    ...overrides,
  };
}

class FakeRepository {
  legs: TravelLeg[];
  audits: TravelLegAuditChange[] = [];

  constructor(legs: TravelLeg[]) {
    this.legs = legs.map((leg) => ({ ...leg }));
  }

  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T> {
    return operation({
      listForUpdate: async () =>
        [...this.legs]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((leg) => ({ ...leg })),
      update: async (id, values) => {
        const leg = this.legs.find((item) => item.id === id);
        if (!leg) throw new Error("missing");
        Object.assign(leg, values);
        return { ...leg };
      },
      setArchived: async (id, archivedAt) => {
        const leg = this.legs.find((item) => item.id === id);
        if (!leg) throw new Error("missing");
        leg.archivedAt = archivedAt;
        return { ...leg };
      },
      reorderLegs: async (orders) => {
        for (const order of orders) {
          const leg = this.legs.find((item) => item.id === order.id);
          if (leg) leg.sortOrder = order.sortOrder;
        }
      },
      insert: async () => {
        throw new Error("not used");
      },
      delete: async () => {
        throw new Error("not used");
      },
      audit: async (change) => {
        this.audits.push(change);
      },
    });
  }
}

describe("TravelLegService independent saves", () => {
  it("updates only the requested leg details and leaves order untouched", async () => {
    const repo = new FakeRepository([
      makeLeg(uuid(1), 1, { name: "One" }),
      makeLeg(uuid(2), 2, { name: "Two" }),
      makeLeg(uuid(3), 3, { name: "Three" }),
    ]);

    const result = await new TravelLegService(repo).updateLegDetails(uuid(2), {
      name: "Kristy",
      color: "#123456",
      baseAddress: null,
      defaultVehicleName: "Box truck",
      defaultMpg: 9.5,
    });

    expect(result.ok).toBe(true);
    expect(repo.legs.map((leg) => leg.sortOrder)).toEqual([1, 2, 3]);
    expect(repo.legs.find((leg) => leg.id === uuid(1))?.name).toBe("One");
    expect(repo.legs.find((leg) => leg.id === uuid(2))?.name).toBe("Kristy");
    expect(repo.legs.find((leg) => leg.id === uuid(3))?.name).toBe("Three");
    expect(repo.audits).toHaveLength(1);
  });

  it("rejects detail edits for archived legs", async () => {
    const repo = new FakeRepository([
      makeLeg(uuid(1), 1, { archivedAt: new Date() }),
      makeLeg(uuid(2), 2),
    ]);

    const result = await new TravelLegService(repo).updateLegDetails(uuid(1), {
      name: "Archived edit",
      color: "#123456",
      baseAddress: null,
      defaultVehicleName: null,
      defaultMpg: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LEG_ARCHIVED");
  });

  it("reorders active legs without changing any detail fields", async () => {
    const repo = new FakeRepository([
      makeLeg(uuid(1), 1, { name: "One", defaultVehicleName: "Van" }),
      makeLeg(uuid(2), 2, { name: "Two", defaultVehicleName: "Truck" }),
      makeLeg(uuid(3), 3, { name: "Archived", archivedAt: new Date() }),
    ]);

    const result = await new TravelLegService(repo).reorderActiveLegs({
      legs: [
        { id: uuid(2), sortOrder: 1 },
        { id: uuid(1), sortOrder: 2 },
      ],
    });

    expect(result.ok).toBe(true);
    const ordered = [...repo.legs].sort((left, right) => left.sortOrder - right.sortOrder);
    expect(ordered.map((leg) => leg.id)).toEqual([uuid(2), uuid(1), uuid(3)]);
    expect(ordered.find((leg) => leg.id === uuid(1))?.defaultVehicleName).toBe("Van");
    expect(ordered.find((leg) => leg.id === uuid(2))?.defaultVehicleName).toBe("Truck");
  });
});
