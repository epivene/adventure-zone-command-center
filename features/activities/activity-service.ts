import {
  createActivityInputSchema,
  editActivityInputSchema,
} from "@/features/activities/activity-input";
import type {
  ActivityRepository,
  ActivityRevisionReader,
} from "@/features/activities/activity-repository";
import type {
  ActivityError,
  ActivityParent,
  ActivityRevision,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";
import { err, type Result } from "@/lib/result";

export class ActivityService {
  constructor(
    private readonly repository: ActivityRepository & ActivityRevisionReader,
  ) {}

  listTimeline(parent: ActivityParent): Promise<ActivityTimelineItem[]> {
    return this.repository.listTimeline(parent);
  }

  listRevisions(activityId: string): Promise<ActivityRevision[]> {
    return this.repository.listRevisions(activityId);
  }

  async create(input: CreateActivityInput): Promise<ActivityTimelineItem> {
    const parsed = createActivityInputSchema.parse(input);
    return this.repository.create(parsed);
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
}
