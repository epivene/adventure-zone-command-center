import {
  createActivityInputSchema,
  deleteActivityInputSchema,
  editActivityInputSchema,
} from "@/features/activities/activity-input";
import {
  ActivityParentValidationError,
  type ActivityRepository,
  type ActivityRevisionReader,
} from "@/features/activities/activity-repository";
import type {
  ActivityError,
  ActivityParent,
  ActivityRevisionPage,
  ActivityTimelineItem,
  ActivityTimelinePage,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";
import { err, type Result } from "@/lib/result";

export class ActivityService {
  constructor(
    private readonly repository: ActivityRepository & ActivityRevisionReader,
  ) {}

  listTimeline(parent: ActivityParent, page = 1): Promise<ActivityTimelinePage> {
    return this.repository.listTimeline(parent, page);
  }

  listRevisions(
    activityId: string,
    page = 1,
  ): Promise<ActivityRevisionPage> {
    return this.repository.listRevisions(activityId, page);
  }

  async create(
    input: CreateActivityInput,
  ): Promise<Result<ActivityTimelineItem, ActivityError>> {
    const parsed = createActivityInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_ACTIVITY_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the activity details.",
      });
    }
    try {
      return { ok: true, value: await this.repository.create(parsed.data) };
    } catch (error) {
      if (error instanceof ActivityParentValidationError) {
        return err({
          code: "INVALID_ACTIVITY_INPUT",
          message: error.message,
        });
      }
      throw error;
    }
  }

  async edit(
    input: EditActivityInput,
  ): Promise<Result<ActivityTimelineItem, ActivityError>> {
    const parsed = editActivityInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_ACTIVITY_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the activity details.",
      });
    }
    return this.repository.edit(parsed.data);
  }

  async delete(activityId: string): Promise<Result<void, ActivityError>> {
    const parsed = deleteActivityInputSchema.safeParse({ activityId });
    if (!parsed.success) {
      return err({
        code: "INVALID_ACTIVITY_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the activity.",
      });
    }
    return this.repository.delete(parsed.data.activityId);
  }
}
