import type {
  OrganizationRepository,
} from "@/features/organizations/organization-repository";
import {
  setLastResortInputSchema,
  type SetLastResortInput,
} from "@/features/organizations/last-resort-input";
import { err, ok, type Result } from "@/lib/result";

export type LastResortError =
  | { code: "INVALID_LAST_RESORT_INPUT"; message: string }
  | { code: "ORGANIZATION_NOT_FOUND" };

type OrganizationServiceOptions = {
  now?: () => Date;
};

export class OrganizationService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: OrganizationRepository,
    options: OrganizationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async setLastResort(
    input: SetLastResortInput,
  ): Promise<Result<void, LastResortError>> {
    const parsed = setLastResortInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_LAST_RESORT_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the Last Resort details.",
      });
    }

    const updated = await this.repository.setLastResort(parsed.data, this.now());
    if (!updated) return err({ code: "ORGANIZATION_NOT_FOUND" });
    return ok(undefined);
  }
}
