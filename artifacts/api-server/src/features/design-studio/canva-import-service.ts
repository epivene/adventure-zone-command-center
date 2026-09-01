import { canvaApiFetch, type CanvaDesignSummary } from "./canva-client";
import {
  markProjectCanvaLinkFailed,
  upsertProjectCanvaLink,
} from "./canva-metadata-repository";

export type CanvaImportJob = {
  id: string;
  status: "failed" | "in_progress" | "success";
  result?: {
    designs?: CanvaDesignSummary[];
  };
  error?: {
    code?: string;
    message?: string;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function importTitle(title: string) {
  const trimmed = title.trim() || "Adventure Zone Design";
  return Array.from(trimmed).slice(0, 50).join("");
}

async function createImportJob(input: {
  officeAccountId: string;
  title: string;
  pdfBytes: Uint8Array;
}) {
  const metadata = {
    title_base64: Buffer.from(importTitle(input.title), "utf8").toString("base64"),
    mime_type: "application/pdf",
  };

  return canvaApiFetch<{ job: CanvaImportJob }>(
    input.officeAccountId,
    "/imports",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Import-Metadata": JSON.stringify(metadata),
      },
      body: Buffer.from(input.pdfBytes),
    },
  );
}

async function getImportJob(officeAccountId: string, jobId: string) {
  return canvaApiFetch<{ job: CanvaImportJob }>(
    officeAccountId,
    `/imports/${encodeURIComponent(jobId)}`,
    { method: "GET" },
  );
}

async function waitForImport(officeAccountId: string, initial: CanvaImportJob) {
  let job = initial;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (job.status === "success" || job.status === "failed") return job;
    await sleep(Math.min(2_000, 400 + attempt * 150));
    job = (await getImportJob(officeAccountId, job.id)).job;
  }
  throw new Error("CANVA_IMPORT_TIMEOUT");
}

export async function importPdfToCanva(input: {
  officeAccountId: string;
  projectId: string;
  versionId: string;
  title: string;
  pdfBytes: Uint8Array;
}) {
  try {
    const created = await createImportJob({
      officeAccountId: input.officeAccountId,
      title: input.title,
      pdfBytes: input.pdfBytes,
    });
    const completed = await waitForImport(input.officeAccountId, created.job);

    if (completed.status === "failed") {
      const message = completed.error?.message || completed.error?.code || "Canva could not import this PDF.";
      await markProjectCanvaLinkFailed(input.projectId, message).catch(() => undefined);
      throw new Error(`CANVA_IMPORT_FAILED: ${message}`);
    }

    const design = completed.result?.designs?.[0];
    if (!design?.id) throw new Error("CANVA_IMPORT_MISSING_DESIGN");
    const editUrl = design.urls?.edit_url;
    if (!editUrl) throw new Error("CANVA_IMPORT_MISSING_EDIT_URL");

    await upsertProjectCanvaLink({
      projectId: input.projectId,
      designId: design.id,
      importedVersionId: input.versionId,
      status: "ready",
      lastImportAt: new Date(),
      lastError: null,
    });

    return {
      designId: design.id,
      editUrl,
      importedVersionId: input.versionId,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("CANVA_IMPORT_FAILED")) {
      await markProjectCanvaLinkFailed(input.projectId, error.message).catch(() => undefined);
    }
    throw error;
  }
}
