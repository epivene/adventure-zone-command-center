import type { ParsedLeadWorkbook } from "@/features/lead-intake/excel-lead-parser";
import { apiGet, apiPost } from "@/lib/auth-token";

export type LeadImportBatchSummary = {
  id: string;
  originalFilename: string;
  status: "review" | "archived";
  rowCount: number;
  importedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadImportReviewRow = {
  id: string;
  sheetName: string;
  sourceRowNumber: number;
  company: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  industry: string | null;
  warnings: string[];
  state: "needs_review" | "needs_correction" | "verified" | "skipped";
};

export type LeadImportBatch = LeadImportBatchSummary & { rows: LeadImportReviewRow[] };

type Api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
};

export function createLeadIntakeClient(api: Api) {
  return {
    async importWorkbook(workbook: ParsedLeadWorkbook) {
      return api.post<{ batchId: string; reused: boolean; rowCount: number }>("/lead-intake/imports", {
        originalFilename: workbook.fileName,
        fileSha256: workbook.fileSha256,
        rows: workbook.rows,
      });
    },
    async listBatches() {
      return (await api.get<{ batches: LeadImportBatchSummary[] }>("/lead-intake/imports")).batches;
    },
    async getBatch(batchId: string) {
      return (await api.get<{ batch: LeadImportBatch }>(`/lead-intake/imports/${batchId}`)).batch;
    },
  };
}

export const leadIntakeClient = createLeadIntakeClient({ get: apiGet, post: apiPost });
