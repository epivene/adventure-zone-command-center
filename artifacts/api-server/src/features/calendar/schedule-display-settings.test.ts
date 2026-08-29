import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULE_DISPLAY_SETTINGS,
  scheduleDisplaySettingsInputSchema,
} from "./schedule-display-settings";

describe("schedule display settings", () => {
  it("uses hot pink event days and gray travel days by default", () => {
    expect(DEFAULT_SCHEDULE_DISPLAY_SETTINGS).toEqual({
      eventColor: "#ec4899",
      travelColor: "#94a3b8",
    });
  });

  it("accepts six-digit hex colors and rejects invalid CSS values", () => {
    expect(scheduleDisplaySettingsInputSchema.parse({ eventColor: "#ff1493", travelColor: "#808080" })).toEqual({
      eventColor: "#ff1493",
      travelColor: "#808080",
    });
    expect(() => scheduleDisplaySettingsInputSchema.parse({ eventColor: "hotpink", travelColor: "#808080" })).toThrow();
    expect(() => scheduleDisplaySettingsInputSchema.parse({ eventColor: "#fff", travelColor: "#808080" })).toThrow();
  });
});
