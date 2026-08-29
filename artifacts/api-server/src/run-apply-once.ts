import { randomUUID } from "node:crypto";
import { createProductionReview } from "./features/act-replacement/production-review";
import { runActReviewMigrationsAtStartup } from "./db/act-review-startup";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const runId = "d5da751d-5651-4a58-abf4-aedb2ef02e98";
const review = createProductionReview({
  sourceDatabaseKey: "V72122203125",
  requestedBy: "owner",
});

const main = async () => {
  const appliedMigrations = await runActReviewMigrationsAtStartup();
  if (appliedMigrations.length > 0) {
    console.log("startup migrations applied:", appliedMigrations.join(", "));
  }

  const rows = await (db as any).execute(
    sql`select summary from act_replacement_runs where id = ${runId}`,
  );
  const row = rows.rows?.[0] ?? rows[0];
  if (!row) {
    console.log("no ACT replacement run found; nothing to apply");
    return;
  }
  const summary = row.summary as { manifestDigest?: string };
  const digest = summary?.manifestDigest;
  if (!digest) throw new Error("no manifest digest on run");
  console.log("digest:", digest);

  const requestKey = process.env.APPROVAL_KEY || randomUUID();
  console.log("approvalRequestKey:", requestKey);
  const approval = await review.commands.approveSafeDefaults({
    runId,
    expectedManifestDigest: digest,
    requestKey,
    requestedBy: "owner",
  });
  console.log("approved ops:", approval.approvedOperationIds.length, "rejected:", approval.rejectedOperationIds.length);

  let batches = 0;
  let lastCursor = -1;
  let stalls = 0;
  for (;;) {
    const status = await review.applyCoordinator.applyNext({
      runId,
      approvalRequestKey: requestKey,
      expectedManifestDigest: digest,
      batchSize: 25,
      requestedBy: "owner",
    });
    batches++;
    const progressed = status.nextCursor > lastCursor;
    lastCursor = status.nextCursor;
    if (batches % 10 === 0 || !status.hasMore || status.requiresReview || !progressed) {
      console.log(new Date().toISOString(), "batch", batches, "cursor", status.nextCursor, "hasMore", status.hasMore, "review", status.requiresReview, "state", status.batch?.state, "failed", status.batch?.failedCount, "blocked", status.batch?.blockedCount);
    }
    if (!status.hasMore || status.requiresReview) break;
    if (!progressed && status.batch?.state === "applying") {
      stalls++;
      if (stalls > 20) { console.log("giving up: stuck applying batch"); break; }
      console.log("stalled on in-flight batch; waiting 130s for lease expiry");
      await new Promise((resolve) => setTimeout(resolve, 130_000));
    } else {
      stalls = 0;
    }
  }
  console.log("apply loop finished after", batches, "batches");
};

main().then(
  () => process.exit(0),
  (err) => { console.error("failed:", err?.code ?? err?.message ?? err, err?.status ?? ""); process.exit(1); },
);
