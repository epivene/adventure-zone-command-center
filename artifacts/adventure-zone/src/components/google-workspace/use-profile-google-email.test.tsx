// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleProfileEmails: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

import { useProfileGoogleEmail } from "./use-profile-google-email";

function conversation(threadId: string, internalDateMs: number) {
  return {
    threadId,
    subject: threadId,
    from: "gm@example.com",
    to: "zone@example.com",
    date: new Date(internalDateMs).toUTCString(),
    internalDateMs,
    hasAttachments: false,
    contactId: "contact-1",
    evidenceCodes: ["exact_contact_email"],
    originalGmailUrl: `https://mail.google.com/${threadId}`,
  };
}

beforeEach(() => {
  client.getGoogleProfileEmails.mockReset();
});

describe("useProfileGoogleEmail", () => {
  it("loads matched conversations once and orders all history newest first", async () => {
    client.getGoogleProfileEmails.mockResolvedValue({
      conversations: [
        conversation("older", Date.UTC(2025, 1, 1)),
        conversation("newest", Date.UTC(2026, 8, 12)),
      ],
      historicalConversations: [conversation("middle", Date.UTC(2026, 2, 1))],
    });

    const { result } = renderHook(() => useProfileGoogleEmail("org-1", 2026));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversations.map((row) => row.threadId)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
    expect(result.current.current.map((row) => row.threadId)).toEqual([
      "newest",
      "middle",
    ]);
    expect(result.current.historical.map((row) => row.threadId)).toEqual([
      "older",
    ]);
    expect(client.getGoogleProfileEmails).toHaveBeenCalledTimes(1);
  });

  it("keeps an isolated error and can retry", async () => {
    client.getGoogleProfileEmails
      .mockRejectedValueOnce(new Error("Gmail unavailable"))
      .mockResolvedValueOnce({
        conversations: [conversation("recovered", Date.UTC(2026, 8, 12))],
      });

    const { result } = renderHook(() => useProfileGoogleEmail("org-1", 2026));
    await waitFor(() => expect(result.current.error).toBe("Gmail unavailable"));

    await act(async () => result.current.reload());

    expect(result.current.error).toBeNull();
    expect(result.current.conversations[0]?.threadId).toBe("recovered");
  });
});
