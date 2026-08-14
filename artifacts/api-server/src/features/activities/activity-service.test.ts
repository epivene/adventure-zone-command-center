import { describe, expect, it, vi } from "vitest";

import { ActivityService } from "./activity-service";

describe("ActivityService deletion", () => {
  it("validates and soft-deletes an existing activity", async () => {
    const repository = {
      delete: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    const service = new ActivityService(repository as never);

    const result = await service.delete("40000000-0000-4000-8000-000000000001");

    expect(result.ok).toBe(true);
    expect(repository.delete).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001");
  });

  it("rejects an invalid activity ID before reaching the repository", async () => {
    const repository = { delete: vi.fn() };
    const result = await new ActivityService(repository as never).delete("not-a-uuid");

    expect(result.ok).toBe(false);
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
