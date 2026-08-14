import { createProductionReview } from "./features/act-replacement/production-review";

const runId = "d5da751d-5651-4a58-abf4-aedb2ef02e98";
const review = createProductionReview({ sourceDatabaseKey: "V72122203125", requestedBy: "owner" });

const main = async () => {
  const key = process.env.APPROVAL_KEY!;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const status = await review.applyCoordinator.applyNext({
      runId,
      approvalRequestKey: key,
      expectedManifestDigest: "d6862625b2442f66d47cf13bb7be9e3c1676e114b5e8732fc83e4513fdd3db35",
      batchSize: 25,
      requestedBy: "owner",
    });
    console.log("applyNext took", Date.now() - t0, "ms; cursor", status.nextCursor, "hasMore", status.hasMore, "state", status.batch?.state);
    if (!status.hasMore || status.requiresReview) break;
  }
};
main().then(() => process.exit(0), (e) => { console.error(e?.code ?? e); process.exit(1); });
