import type { db as database } from "@/db/client";
import {
  DrizzleRoutingCacheStore,
  OsrmRoutingProvider,
  RoutingEstimator,
} from "@/features/trips/routing";
import type { DrivePoint, DriveTimeEstimator } from "./leg-feasibility";

type DrizzleDatabase = typeof database;

export class RouteDriveTimeEstimator implements DriveTimeEstimator {
  private readonly estimator: RoutingEstimator;

  constructor(database: DrizzleDatabase) {
    this.estimator = new RoutingEstimator(
      new OsrmRoutingProvider(),
      new DrizzleRoutingCacheStore(database),
    );
  }

  async estimateMinutes(from: DrivePoint, to: DrivePoint): Promise<number | null> {
    const estimate = await this.estimator.estimate(from, to, { preferLive: false });
    return estimate ? Math.round(estimate.minutes) : null;
  }
}
