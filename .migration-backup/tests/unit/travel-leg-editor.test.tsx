// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { TravelLegEditor } from "@/components/routes/travel-leg-editor";
import {
  TravelLegService,
  type TravelLegEditorRepository,
  type TravelLegEditorTransaction,
} from "@/features/routes/travel-leg-editor";
import { travelLegConfigurationSchema } from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

const legs: TravelLeg[] = [1, 2, 3, 4].map((sortOrder) => ({
  id: `${sortOrder}1111111-1111-4111-8111-111111111111`,
  name: `Leg ${sortOrder}`,
  color: ["#DC3B3B", "#2F73D9", "#7B4DDB", "#15956B"][sortOrder - 1]!,
  sortOrder,
}));

class MemoryTravelLegRepository implements TravelLegEditorRepository {
  readonly records = new Map(legs.map((leg) => [leg.id, { ...leg }]));
  readonly audits: {
    entityId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[] = [];

  async transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ) {
    return operation({
      listForUpdate: async () =>
        [...this.records.values()]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((leg) => ({ ...leg })),
      update: async (id, values) => {
        const current = this.records.get(id);
        if (!current) throw new Error("Missing travel leg.");
        const updated = { ...current, ...values };
        this.records.set(id, updated);
        return { ...updated };
      },
      audit: async (change) => {
        this.audits.push(structuredClone(change));
      },
    });
  }
}

afterEach(cleanup);

describe("travel-leg configuration", () => {
  it("rejects a fifth leg before any write can occur", () => {
    const result = travelLegConfigurationSchema.safeParse({
      legs: [
        ...legs,
        {
          id: "51111111-1111-4111-8111-111111111111",
          name: "Leg 5",
          color: "#000000",
          sortOrder: 5,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("updates the fixed four rows and audits only changed configuration", async () => {
    const repository = new MemoryTravelLegRepository();
    const service = new TravelLegService(repository);
    const result = await service.updateConfiguration({
      legs: legs.map((leg) =>
        leg.sortOrder === 2
          ? { ...leg, name: "Central crew", color: "#112233" }
          : leg,
      ),
    });

    expect(result.ok).toBe(true);
    expect(repository.records).toHaveLength(4);
    expect(repository.records.get(legs[1]!.id)).toMatchObject({
      name: "Central crew",
      color: "#112233",
      sortOrder: 2,
    });
    expect(repository.audits).toEqual([
      {
        entityId: legs[1]!.id,
        before: { name: "Leg 2", color: "#2F73D9" },
        after: { name: "Central crew", color: "#112233" },
      },
    ]);
  });

  it("renders exactly four editable rows and sends their stable IDs/order", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<TravelLegEditor legs={legs} onSubmit={onSubmit} />);

    expect(screen.getAllByRole("group", { name: /Travel leg \d/ })).toHaveLength(
      4,
    );
    expect(
      screen.queryByRole("button", { name: /add.*leg/i }),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Travel leg 1 name"));
    await user.type(screen.getByLabelText("Travel leg 1 name"), "North crew");
    await user.click(
      screen.getByRole("button", { name: "Save travel legs" }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      legs: [
        { ...legs[0], name: "North crew" },
        legs[1],
        legs[2],
        legs[3],
      ],
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Travel legs saved.",
    );
  });
});
