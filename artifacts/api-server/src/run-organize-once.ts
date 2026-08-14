import { createProductionReview } from "./features/act-replacement/production-review";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const runId = "d5da751d-5651-4a58-abf4-aedb2ef02e98";
const review = createProductionReview({
  sourceDatabaseKey: "V72122203125",
  requestedBy: "owner",
});

const phase = async () => {
  const rows = await (db as any).execute(
    sql`select phase, last_error_code from act_replacement_runs where id = ${runId}`,
  );
  return (rows.rows?.[0] ?? rows[0]) as { phase: string; last_error_code: string | null };
};

const main = async () => {
  const result = await review.commands.startOrganize(runId);
  console.log("startOrganize:", JSON.stringify(result));
  for (let i = 0; i < 300; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const now = await phase();
    if (i % 6 === 0) console.log("phase:", JSON.stringify(now));
    if (now.phase !== "organizing") {
      console.log("final:", JSON.stringify(now));
      return;
    }
  }
  console.log("timed out waiting; organize continues in-process only if this stayed alive");
};

main().then(
  () => process.exit(0),
  (err) => { console.error("failed:", err?.code ?? err?.message ?? err); process.exit(1); },
);
