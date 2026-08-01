import type { TravelLegConfiguration } from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { err, ok, type Result } from "@/lib/result";

export type TravelLegConfigurationError = {
  code: "LEG_CONFIGURATION_CONFLICT";
};

export type TravelLegAddError = {
  code: "LEG_LIMIT_REACHED";
};

export type TravelLegDeleteError = {
  code: "LEG_MINIMUM_REACHED" | "LEG_NOT_FOUND";
};

export type TravelLegAuditChange = {
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export interface TravelLegEditorTransaction {
  listForUpdate(): Promise<TravelLeg[]>;
  update(
    id: string,
    values: { name: string; color: string },
  ): Promise<TravelLeg>;
  /** Atomically reorder all legs in a single SQL statement to avoid unique-constraint conflicts. */
  reorderLegs(orders: { id: string; sortOrder: number }[]): Promise<void>;
  insert(values: {
    name: string;
    color: string;
    sortOrder: number;
  }): Promise<TravelLeg>;
  delete(id: string): Promise<void>;
  audit(change: TravelLegAuditChange): Promise<void>;
}

export interface TravelLegEditorRepository {
  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T>;
}

export class TravelLegService {
  constructor(private readonly repository: TravelLegEditorRepository) {}

  updateConfiguration(
    input: TravelLegConfiguration,
  ): Promise<Result<TravelLeg[], TravelLegConfigurationError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();

      // Must match current count and the same set of IDs (any order is allowed)
      const currentIds = new Set(current.map((l) => l.id));
      if (
        input.legs.length !== current.length ||
        input.legs.some((leg) => !currentIds.has(leg.id))
      ) {
        return err({ code: "LEG_CONFIGURATION_CONFLICT" });
      }

      const currentById = new Map(current.map((l) => [l.id, l]));
      const requestedById = new Map(input.legs.map((l) => [l.id, l]));

      // Atomically reorder if any sort position changed — one SQL statement
      // avoids the unique-constraint conflict that sequential updates would cause.
      const orderChanged = input.legs.some(
        (leg) => currentById.get(leg.id)!.sortOrder !== leg.sortOrder,
      );
      if (orderChanged) {
        await transaction.reorderLegs(
          input.legs.map((leg) => ({ id: leg.id, sortOrder: leg.sortOrder })),
        );
      }

      // Update name/color for each leg that changed
      const updated: TravelLeg[] = [];
      for (const leg of current) {
        const next = requestedById.get(leg.id)!;
        if (leg.name !== next.name || leg.color !== next.color) {
          const saved = await transaction.update(leg.id, {
            name: next.name,
            color: next.color,
          });
          await transaction.audit({
            entityId: leg.id,
            before: { name: leg.name, color: leg.color },
            after: { name: saved.name, color: saved.color },
          });
          updated.push(saved);
        } else {
          // Sort order may have changed; reflect the requested value
          updated.push({ ...leg, sortOrder: next.sortOrder });
        }
      }
      return ok(updated);
    });
  }

  addLeg(): Promise<Result<TravelLeg, TravelLegAddError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      if (current.length >= 9) {
        return err({ code: "LEG_LIMIT_REACHED" });
      }
      const nextSortOrder = current.length + 1;
      const leg = await transaction.insert({
        name: `Leg ${nextSortOrder}`,
        color: "#6B7280",
        sortOrder: nextSortOrder,
      });
      await transaction.audit({
        entityId: leg.id,
        before: {},
        after: { name: leg.name, color: leg.color, sortOrder: leg.sortOrder },
      });
      return ok(leg);
    });
  }

  deleteLeg(id: string): Promise<Result<void, TravelLegDeleteError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const target = current.find((l) => l.id === id);
      if (!target) {
        return err({ code: "LEG_NOT_FOUND" });
      }
      if (current.length <= 1) {
        return err({ code: "LEG_MINIMUM_REACHED" });
      }
      await transaction.audit({
        entityId: id,
        before: { name: target.name, color: target.color, sortOrder: target.sortOrder },
        after: {},
      });
      await transaction.delete(id);
      return ok(undefined);
    });
  }
}
