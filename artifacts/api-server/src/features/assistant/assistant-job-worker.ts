import { AssistantJobRepository } from "./assistant-job-repository";
import { SafeWebsiteAuditHttpClient, type WebsiteAuditHttpClient } from "./website-audit-http";
import { assessWebsiteMatch } from "./website-audit-matcher";
import {
  PostgresWebsiteAuditRecordRepository,
  WEBSITE_AUDIT_BATCH_SIZE,
  type WebsiteAuditRecordRepository,
} from "./website-audit-record-repository";
import {
  SearchWebsiteReplacementProvider,
  type WebsiteReplacementProvider,
} from "./website-audit-replacement-provider";

const LEASE_MS = 60_000;

export class AssistantJobWorker {
  private readonly jobRepository: AssistantJobRepository;
  private readonly recordRepository: WebsiteAuditRecordRepository;
  private readonly http: WebsiteAuditHttpClient;
  private readonly replacement: WebsiteReplacementProvider;

  constructor(input?: {
    jobRepository?: AssistantJobRepository;
    recordRepository?: WebsiteAuditRecordRepository;
    http?: WebsiteAuditHttpClient;
    replacement?: WebsiteReplacementProvider;
  }) {
    this.jobRepository = input?.jobRepository ?? new AssistantJobRepository();
    this.recordRepository = input?.recordRepository ?? new PostgresWebsiteAuditRecordRepository();
    this.http = input?.http ?? new SafeWebsiteAuditHttpClient();
    this.replacement = input?.replacement ?? new SearchWebsiteReplacementProvider();
  }

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "worked" }> {
    const claim = await this.jobRepository.claimRunnable({ workerId: input.workerId, now: input.now, leaseMs: LEASE_MS });
    if (!claim) return { kind: "idle" };

    try {
      if (await this.jobRepository.isCancellationRequested(claim.jobId)) {
        await this.jobRepository.markStopped(claim.jobId);
        return { kind: "worked" };
      }

      const current = await this.jobRepository.getJob({ actorId: claim.actorId, jobId: claim.jobId });
      if (!current) throw new Error("Claimed assistant job disappeared.");
      const total = current.progress.total || await this.recordRepository.countApplicable();
      const afterId = current.progress.cursorAfterId;
      const records = await this.recordRepository.listBatch({ afterId, limit: WEBSITE_AUDIT_BATCH_SIZE });

      if (!records.length) {
        await this.jobRepository.updateProgress(claim.jobId, { total, stage: "complete" });
        await this.jobRepository.markComplete(claim.jobId);
        return { kind: "worked" };
      }

      let verified = current.progress.verified;
      let broken = current.progress.broken;
      let mismatches = current.progress.mismatches;
      let review = current.progress.review;
      let proposedFixes = current.progress.proposedFixes;
      let processed = current.progress.processed;
      let cursorAfterId = afterId;

      for (const record of records) {
        if (await this.jobRepository.isCancellationRequested(claim.jobId)) {
          await this.jobRepository.markStopped(claim.jobId);
          return { kind: "worked" };
        }

        let fetched;
        try {
          fetched = await this.http.inspect(record.website);
        } catch {
          fetched = {
            requestedUrl: record.website,
            finalUrl: record.website,
            statusCode: null,
            reachable: false,
            redirected: false,
            title: null,
            textSample: "",
            failure: "http_error" as const,
          };
        }
        const assessment = assessWebsiteMatch({ record, fetched });
        let suggestedUrl: string | null = null;
        let sourceRefs: string[] = [];
        let findingStatus = assessment.status;
        let findingConfidence = assessment.confidence;
        let reasons = [...assessment.reasons];

        const canonicalRedirect = fetched.redirected
          && fetched.reachable
          && fetched.finalUrl
          && fetched.finalUrl !== record.website
          && assessment.confidence === "high";

        if (assessment.status === "broken" || assessment.status === "likely_mismatch") {
          const replacement = await this.replacement.findOfficialReplacement(record).catch(() => null);
          if (replacement) {
            suggestedUrl = replacement.url;
            sourceRefs = replacement.sourceRefs;
            reasons = [...reasons, ...replacement.reasons];
            if (replacement.confidence === "high") {
              findingStatus = "replacement_found";
              findingConfidence = "high";
            }
          }
        } else if (canonicalRedirect) {
          suggestedUrl = fetched.finalUrl;
        }

        await this.jobRepository.upsertFinding(claim.jobId, {
          recordId: record.recordId,
          recordLabel: record.label,
          savedUrl: record.website,
          finalUrl: fetched.finalUrl,
          status: findingStatus,
          confidence: findingConfidence,
          reasons,
          suggestedUrl,
          sourceRefs,
        });

        if (suggestedUrl && findingConfidence === "high") {
          await this.jobRepository.upsertProposal(claim.jobId, {
            recordId: record.recordId,
            field: "website",
            oldValue: record.website,
            newValue: suggestedUrl,
            confidence: "high",
            reasons,
          });
          proposedFixes += 1;
        }

        if (assessment.status === "verified_match" || assessment.status === "redirected") verified += 1;
        else if (assessment.status === "broken") broken += 1;
        else if (assessment.status === "likely_mismatch") mismatches += 1;
        else review += 1;
        processed += 1;
        cursorAfterId = record.recordId;
      }

      await this.jobRepository.updateProgress(claim.jobId, {
        total,
        processed,
        verified,
        broken,
        mismatches,
        review,
        proposedFixes,
        cursorAfterId,
        stage: "checking_websites",
      });
      return { kind: "worked" };
    } catch (error) {
      await this.jobRepository.markFailed(
        claim.jobId,
        error instanceof Error ? error.message : "Website audit failed.",
      );
      return { kind: "worked" };
    }
  }
}
