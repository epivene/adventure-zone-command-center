import type { db as runtimeDb } from "@workspace/db";
import { OutreachAllocation } from "./outreach-allocation";

// Lazy production provider construction: flag-off routes never initialize Google or routing.
export function createProductionOutreachAllocation(db: typeof runtimeDb) {
  return new OutreachAllocation(db, {
    async readClient() {
      const { PostgresGoogleConnectionRepository } =
        await import("../google-workspace/google-connection-repository");
      return new PostgresGoogleConnectionRepository().createReadClient();
    },
    estimator: {
      async estimateMinutes(from, to) {
        const { RouteDriveTimeEstimator } =
          await import("../leg-assignment/drive-time-estimator");
        return new RouteDriveTimeEstimator(db, true).estimateMinutes(from, to);
      },
    },
  });
}
