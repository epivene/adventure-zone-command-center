import type { TravelLegConfiguration } from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { err, ok, type Result } from "@/lib/result";

export type TravelLegConfigurationError = {
  code: "LEG_CONFIGURATION_CONFLICT";
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
  audit(change: TravelLegAuditChange): Promise<void>;
}

export interface TravelLegEditorRepository {
  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T>;
}

function isFixedFour(legs: readonly TravelLeg[]) {
  return (
    legs.length === 4 &&
    legs.every((leg, index) => leg.sortOrder === index + 1)
  );
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
      if (
        !isFixedFour(current) ||
        !isFixedFour(requested) ||
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
}
