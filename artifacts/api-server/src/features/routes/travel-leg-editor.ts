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
      const requested = [...input.legs].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      );

      // Must match current count and same IDs in same sort positions
      const currentIds = new Set(current.map((l) => l.id));
      if (
        requested.length !== current.length ||
        requested.some((leg) => !currentIds.has(leg.id)) ||
        current.some(
          (leg, index) =>
            requested[index]?.id !== leg.id ||
            requested[index]?.sortOrder !== leg.sortOrder,
        )
      ) {
        return err({ code: "LEG_CONFIGURATION_CONFLICT" });
      }

      const updated: TravelLeg[] = [];
      for (const [index, leg] of current.entries()) {
        const next = requested[index]!;
        if (leg.name === next.name && leg.color === next.color) {
          updated.push(leg);
          continue;
        }
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
