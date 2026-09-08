import { and, eq } from "drizzle-orm";

import { db } from "@workspace/db";
import { contractTemplates } from "@/db/schema";
import { GoogleCloudSourceDocumentObjectStorage } from "@/features/business-sources/source-document-storage";
import { ContractDraftService } from "@/features/contracts/contract-draft-service";
import { ContractFileService, DrizzleContractFileMetadataStore } from "@/features/contracts/contract-file-service";
import { generateContractPdf } from "@/features/contracts/contract-pdf-service";
import { DrizzleContractQueryRepository } from "@/features/contracts/contract-query-repository";
import { ContractLifecycleService, DrizzleContractLifecycleRepository } from "@/features/contracts/contract-lifecycle-service";
import { DrizzleContractRepository } from "@/features/contracts/contract-repository";
import { DrizzleContractSourceRepository } from "@/features/contracts/contract-source-repository";
import { contractTemplateV1 } from "@/features/contracts/contract-template-v1";
import { createContractsRouter, type ContractRouteServices } from "./contracts";
import { CoiDraftService, DrizzleCoiDraftPersistence, GoogleCoiGmailDraftProvider } from "@/features/contracts/coi-draft-service";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { DrizzleContractSettingsService } from "@/features/contracts/contract-settings-service";

export function createDefaultContractRouteServices(): ContractRouteServices {
  const repository = new DrizzleContractRepository(db);
  const fileService = new ContractFileService(
    new DrizzleContractFileMetadataStore(db),
    new GoogleCloudSourceDocumentObjectStorage(),
  );
  const drafts = new ContractDraftService({
    repository,
    sources: new DrizzleContractSourceRepository(db),
    templates: {
      active: async () => {
        const [row] = await db.select().from(contractTemplates).where(and(
          eq(contractTemplates.stableKey, contractTemplateV1.stableKey),
          eq(contractTemplates.state, "active"),
        )).limit(1);
        if (!row || row.version !== contractTemplateV1.version) throw new Error("CONTRACT_TEMPLATE_ACTIVE_NOT_FOUND");
        return { ...contractTemplateV1, id: row.id, state: "active" as const };
      },
    },
    generatePdf: generateContractPdf,
    files: fileService,
  });
  const coi = new CoiDraftService({
    persistence: new DrizzleCoiDraftPersistence(db),
    provider: new GoogleCoiGmailDraftProvider(new PostgresGoogleConnectionRepository()),
  });
  return {
    drafts,
    queries: new DrizzleContractQueryRepository(db),
    files: fileService,
    lifecycle: new ContractLifecycleService(new DrizzleContractLifecycleRepository(db)),
    coi,
    settings: new DrizzleContractSettingsService(db),
  };
}

export default createContractsRouter({ services: createDefaultContractRouteServices() });
