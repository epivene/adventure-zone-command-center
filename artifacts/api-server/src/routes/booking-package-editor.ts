import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import type { PackageCountCategory } from "@/features/resources/resource-input";

const router: IRouter = Router();

type PackageGuidelineRow = {
  id: string;
  minimum_attraction_count: number;
  maximum_attraction_count: number;
};
type ResourceCategoryRow = {
  id: string;
  package_count_category: PackageCountCategory;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

router.get("/bookings/:id/package-editor", async (req, res): Promise<void> => {
  const bookingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const model = await new DrizzleBookingRepository(db)
      .getPackageResourceEditorModel(bookingId);
    if (!model) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const [guidelineResult, categoryResult] = await Promise.all([
      db.execute(sql`
        select id, minimum_attraction_count, maximum_attraction_count
        from package_templates
      `),
      db.execute(sql`
        select id, package_count_category
        from resources
      `),
    ]);
    const guidelineById = new Map(
      rowsOf<PackageGuidelineRow>(guidelineResult).map((row) => [row.id, row]),
    );
    const categoryById = new Map(
      rowsOf<ResourceCategoryRow>(categoryResult).map((row) => [
        row.id,
        row.package_count_category,
      ]),
    );

    res.json({
      ...model,
      packageOptions: model.packageOptions.map((pkg) => ({
        ...pkg,
        minimumAttractionCount:
          guidelineById.get(pkg.id)?.minimum_attraction_count ?? pkg.baseAttractionCount,
        maximumAttractionCount:
          guidelineById.get(pkg.id)?.maximum_attraction_count ?? pkg.baseAttractionCount,
      })),
      resourceOptions: model.resourceOptions.map((resource) => ({
        ...resource,
        packageCountCategory: categoryById.get(resource.id) ?? "main_attraction",
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load package editor model");
    res.status(500).json({ error: "Failed to load package setup" });
  }
});

export default router;
