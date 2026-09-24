import {
  createFollowUpInputSchema,
  deleteFollowUpInputSchema,
  editFollowUpInputSchema,
} from "@/features/follow-ups/follow-up-input";
import type { FollowUpRepository, FollowUpCreateOptions } from "@/features/follow-ups/follow-up-repository";
import type {
  CreateFollowUpInput,
  EditFollowUpInput,
  FollowUpError,
  FollowUpRecord,
} from "@/features/follow-ups/follow-up-types";
import { err, type Result } from "@/lib/result";

export class FollowUpService {
  constructor(private readonly repository: FollowUpRepository) {}

  async create(
    input: CreateFollowUpInput,
    options?: FollowUpCreateOptions,
  ): Promise<Result<FollowUpRecord, FollowUpError>> {
    const parsed = createFollowUpInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_FOLLOW_UP_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the follow-up.",
      });
    }
    return this.repository.create(parsed.data, options);
  }

  async edit(
    input: EditFollowUpInput,
  ): Promise<Result<FollowUpRecord, FollowUpError>> {
    const parsed = editFollowUpInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_FOLLOW_UP_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the follow-up.",
      });
    }
    return this.repository.edit(parsed.data);
  }

  async delete(followUpId: string): Promise<Result<void, FollowUpError>> {
    const parsed = deleteFollowUpInputSchema.safeParse({ followUpId });
    if (!parsed.success) {
      return err({
        code: "INVALID_FOLLOW_UP_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the follow-up.",
      });
    }
    return this.repository.delete(parsed.data.followUpId);
  }
}
