import type {
  TravelLegConfiguration,
  TravelLegDetails,
  TravelLegOrder,
} from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { err, ok, type Result } from "@/lib/result";

export type TravelLegConfigurationError = {
  code: "LEG_CONFIGURATION_CONFLICT";
};

export type TravelLegDetailsError = {
  code: "LEG_NOT_FOUND" | "LEG_ARCHIVED";
};

export type TravelLegDeleteError = {
  code: "LEG_MINIMUM_REACHED" | "LEG_NOT_FOUND";
};

export type TravelLegArchiveError = {
  code: "LEG_NOT_FOUND" | "LAST_ACTIVE_LEG";
};

export type TravelLegAuditChange = {
  entityId: string;
  action?: "update" | "archive" | "restore";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type TravelLegDetailValues = {
  name: string;
  color: string;
  baseAddress: string | null;
  defaultVehicleName: string | null;
  defaultMpg: number | null;
};

export interface TravelLegEditorTransaction {
  listForUpdate(): Promise<TravelLeg[]>;
  update(id: string, values: TravelLegDetailValues): Promise<TravelLeg>;
  setArchived(id: string, archivedAt: Date | null): Promise<TravelLeg>;
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

function detailValues(leg: {
  name: string;
  color: string;
  baseAddress: string | null;
  defaultVehicleName: string | null;
  defaultMpg: number | null;
}): TravelLegDetailValues {
  return {
    name: leg.name,
    color: leg.color,
    baseAddress: leg.baseAddress,
    defaultVehicleName: leg.defaultVehicleName,
    defaultMpg: leg.defaultMpg,
  };
}

function detailChanged(
  current: TravelLegDetailValues,
  next: TravelLegDetailValues,
): boolean {
  return (
    current.name !== next.name ||
    current.color !== next.color ||
    current.baseAddress !== next.baseAddress ||
    current.defaultVehicleName !== next.defaultVehicleName ||
    current.defaultMpg !== next.defaultMpg
  );
}

function normalizedOrders(
  activeInOrder: { id: string }[],
  archivedInOrder: { id: string }[],
): { id: string; sortOrder: number }[] {
  return [...activeInOrder, ...archivedInOrder].map((leg, index) => ({
    id: leg.id,
    sortOrder: index + 1,
  }));
}

async function applyOrders(
  transaction: TravelLegEditorTransaction,
  current: TravelLeg[],
  orders: { id: string; sortOrder: number }[],
): Promise<void> {
  const currentById = new Map(current.map((l) => [l.id, l]));
  const changed = orders.some(
    (order) => currentById.get(order.id)?.sortOrder !== order.sortOrder,
  );
  if (changed) {
    await transaction.reorderLegs(orders);
  }
}

export class TravelLegService {
  constructor(private readonly repository: TravelLegEditorRepository) {}

  updateLegDetails(
    id: string,
    input: TravelLegDetails,
  ): Promise<Result<TravelLeg, TravelLegDetailsError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const target = current.find((leg) => leg.id === id);
      if (!target) return err({ code: "LEG_NOT_FOUND" });
      if (target.archivedAt) return err({ code: "LEG_ARCHIVED" });

      const before = detailValues(target);
      const next = detailValues(input);
      if (!detailChanged(before, next)) return ok(target);

      const saved = await transaction.update(id, next);
      await transaction.audit({
        entityId: id,
        before: { ...before },
        after: { ...detailValues(saved) },
      });
      return ok(saved);
    });
  }

  reorderActiveLegs(
    input: TravelLegOrder,
  ): Promise<Result<TravelLeg[], TravelLegConfigurationError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const active = current.filter((leg) => !leg.archivedAt);
      const archived = current.filter((leg) => leg.archivedAt);
      const activeIds = new Set(active.map((leg) => leg.id));

      if (
        input.legs.length !== active.length ||
        input.legs.some((leg) => !activeIds.has(leg.id))
      ) {
        return err({ code: "LEG_CONFIGURATION_CONFLICT" });
      }

      const requestedActive = [...input.legs].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      );
      const orders = normalizedOrders(requestedActive, archived);
      await applyOrders(transaction, current, orders);
      const orderById = new Map(orders.map((order) => [order.id, order.sortOrder]));

      return ok(
        current
          .map((leg) => ({ ...leg, sortOrder: orderById.get(leg.id)! }))
          .sort((left, right) => left.sortOrder - right.sortOrder),
      );
    });
  }

  updateConfiguration(
    input: TravelLegConfiguration,
  ): Promise<Result<TravelLeg[], TravelLegConfigurationError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const active = current.filter((leg) => !leg.archivedAt);
      const archived = current.filter((leg) => leg.archivedAt);
      const activeIds = new Set(active.map((l) => l.id));
      if (
        input.legs.length !== active.length ||
        input.legs.some((leg) => !activeIds.has(leg.id))
      ) {
        return err({ code: "LEG_CONFIGURATION_CONFLICT" });
      }

      const requestedById = new Map(input.legs.map((l) => [l.id, l]));
      const requestedActive = [...input.legs].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const orders = normalizedOrders(requestedActive, archived);
      await applyOrders(transaction, current, orders);
      const orderById = new Map(orders.map((o) => [o.id, o.sortOrder]));

      const updated: TravelLeg[] = [];
      for (const leg of active) {
        const next = requestedById.get(leg.id)!;
        const currentDetail = detailValues(leg);
        const nextDetail = detailValues(next);
        const sortOrder = orderById.get(leg.id)!;
        if (detailChanged(currentDetail, nextDetail)) {
          const saved = await transaction.update(leg.id, nextDetail);
          await transaction.audit({
            entityId: leg.id,
            before: { ...currentDetail },
            after: { ...detailValues(saved) },
          });
          updated.push({ ...saved, sortOrder });
        } else {
          updated.push({ ...leg, sortOrder });
        }
      }
      for (const leg of archived) {
        updated.push({ ...leg, sortOrder: orderById.get(leg.id)! });
      }
      updated.sort((a, b) => a.sortOrder - b.sortOrder);
      return ok(updated);
    });
  }

  addLeg(): Promise<Result<TravelLeg, never>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const active = current.filter((l) => !l.archivedAt);
      const archived = current.filter((l) => l.archivedAt);
      const leg = await transaction.insert({
        name: `Leg ${active.length + 1}`,
        color: "#6B7280",
        sortOrder: current.length + 1,
      });
      const orders = normalizedOrders([...active, leg], archived);
      await applyOrders(transaction, [...current, leg], orders);
      const sortOrder = orders.find((o) => o.id === leg.id)!.sortOrder;
      await transaction.audit({
        entityId: leg.id,
        before: {},
        after: { name: leg.name, color: leg.color, sortOrder },
      });
      return ok({ ...leg, sortOrder });
    });
  }

  archiveLeg(id: string): Promise<Result<TravelLeg, TravelLegArchiveError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const target = current.find((l) => l.id === id);
      if (!target) return err({ code: "LEG_NOT_FOUND" });
      if (target.archivedAt) return ok(target);
      const active = current.filter((l) => !l.archivedAt);
      if (active.length <= 1) return err({ code: "LAST_ACTIVE_LEG" });
      const saved = await transaction.setArchived(id, new Date());
      const archived = current.filter((l) => l.archivedAt);
      const orders = normalizedOrders(
        active.filter((l) => l.id !== id),
        [saved, ...archived],
      );
      await applyOrders(transaction, current, orders);
      await transaction.audit({
        entityId: id,
        action: "archive",
        before: { archivedAt: null, name: target.name },
        after: { archivedAt: saved.archivedAt, name: saved.name },
      });
      return ok({ ...saved, sortOrder: orders.find((o) => o.id === id)!.sortOrder });
    });
  }

  restoreLeg(id: string): Promise<Result<TravelLeg, TravelLegArchiveError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const target = current.find((l) => l.id === id);
      if (!target) return err({ code: "LEG_NOT_FOUND" });
      if (!target.archivedAt) return ok(target);
      const saved = await transaction.setArchived(id, null);
      const active = current.filter((l) => !l.archivedAt);
      const archived = current.filter((l) => l.archivedAt && l.id !== id);
      const orders = normalizedOrders([...active, saved], archived);
      await applyOrders(transaction, current, orders);
      await transaction.audit({
        entityId: id,
        action: "restore",
        before: { archivedAt: target.archivedAt, name: target.name },
        after: { archivedAt: null, name: saved.name },
      });
      return ok({ ...saved, sortOrder: orders.find((o) => o.id === id)!.sortOrder });
    });
  }

  deleteLeg(id: string): Promise<Result<void, TravelLegDeleteError>> {
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.listForUpdate();
      const target = current.find((l) => l.id === id);
      if (!target) return err({ code: "LEG_NOT_FOUND" });
      if (current.length <= 1) return err({ code: "LEG_MINIMUM_REACHED" });
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
