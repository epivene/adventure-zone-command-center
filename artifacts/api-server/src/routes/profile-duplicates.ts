import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  DuplicateError,
  ProfileDuplicatesService,
} from "../features/profile-duplicates/service";

const pair = z.object({
  ids: z
    .array(z.string().uuid())
    .length(2)
    .refine((a) => a[0] !== a[1]),
});
export function createProfileDuplicatesRouter(
  service = new ProfileDuplicatesService(pool),
) {
  const router = Router();
  router.use("/profile-duplicates", requireOwnerMiddleware);
  const run =
    (fn: (req: any) => Promise<unknown>) => async (req: any, res: any) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        if (e instanceof z.ZodError) {
          res.status(400).json({ error: "Invalid duplicate-review input." });
          return;
        }
        if (e instanceof DuplicateError) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        req.log?.error({ err: e }, "Profile duplicate review failed");
        res.status(500).json({
          error: "Duplicate review failed. No partial merge was saved.",
        });
      }
    };
  router.get(
    "/profile-duplicates",
    run(async (req) => {
      const started = Date.now();
      req.log?.info("Profile duplicate scan started");
      const result = await service.scan();
      req.log?.info(
        {
          scanned: result.scanned,
          suggestions: result.pairs.length,
          durationMs: Date.now() - started,
        },
        "Profile duplicate scan completed",
      );
      return result;
    }),
  );
  router.get(
    "/profile-duplicates/history",
    run(() => service.history()),
  );
  router.post(
    "/profile-duplicates/check",
    run((req) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(500),
          city: z.string().max(200).nullable().optional(),
          region: z.string().max(100).nullable().optional(),
        })
        .parse(req.body);
      return service.check({ ...input, id: "new" });
    }),
  );
  router.post(
    "/profile-duplicates/compare",
    run((req) => service.preview(pair.parse(req.body).ids)),
  );
  router.post(
    "/profile-duplicates/dismiss",
    run((req) => service.dismiss(pair.parse(req.body).ids)),
  );
  router.post(
    "/profile-duplicates/merge",
    run((req) => {
      const input = z
        .object({
          survivorId: z.string().uuid(),
          sourceId: z.string().uuid(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          choices: z.record(
            z.enum([
              "name",
              "city",
              "region",
              "phone",
              "website",
              "address_1",
              "address_2",
              "postal_code",
              "place_type",
              "contacts",
            ]),
            z.string().uuid(),
          ),
          confirmed: z.literal(true),
        })
        .refine((v) => v.survivorId !== v.sourceId)
        .parse(req.body);
      return service.merge(input);
    }),
  );
  router.post(
    "/profile-duplicates/undo",
    run((req) =>
      service.undo(z.object({ id: z.string().uuid() }).parse(req.body).id),
    ),
  );
  return router;
}
