import type { LeadProfileEvidence } from "./act-profile-evidence-repository";

type EvidenceRepository = {
  load(organizationId: string): Promise<LeadProfileEvidence | null>;
};

type RequestLike = { params: { organizationId?: string | string[] } };
type ResponseLike = {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
};

function organizationId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createLeadProfileEvidenceHandler(repository: EvidenceRepository) {
  return async (req: RequestLike, res: ResponseLike): Promise<void> => {
    const id = organizationId(req.params.organizationId);
    if (!isUuid(id)) {
      res.status(400).json({ error: "Invalid profile." });
      return;
    }
    const evidence = await repository.load(id);
    if (!evidence) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ evidence });
  };
}
