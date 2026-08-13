import { describe, expect, it, vi } from "vitest";

import {
  buildTelHref,
  launchIndividualVoicemail,
} from "./phone-launcher";

describe("phone launcher", () => {
  it("builds a tel URL from the raw number without appending an office extension", () => {
    expect(buildTelHref({ number: "701-555-0100", extension: "12" })).toBe(
      "tel:7015550100",
    );
  });

  it("copies before launching individually initiated voicemail and never reports delivery", async () => {
    const events: string[] = [];
    const clipboard = {
      writeText: vi.fn(async (value: string) => {
        events.push(`copy:${value}`);
      }),
    };
    const open = vi.fn(() => {
      events.push("open");
      return null;
    });

    await expect(
      launchIndividualVoicemail({
        number: "701-555-0199",
        launcherUrl: "https://launcher.example.test/voicemail",
        clipboard,
        open,
      }),
    ).resolves.toEqual({ launched: true, delivery: "unknown" });
    expect(events).toEqual(["copy:701-555-0199", "open"]);
  });

  it("does not claim a launch when no external target is configured", async () => {
    const clipboard = { writeText: vi.fn() };
    await expect(
      launchIndividualVoicemail({
        number: "701-555-0199",
        launcherUrl: null,
        clipboard,
        open: vi.fn(),
      }),
    ).resolves.toEqual({ launched: false, delivery: "unknown" });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});
