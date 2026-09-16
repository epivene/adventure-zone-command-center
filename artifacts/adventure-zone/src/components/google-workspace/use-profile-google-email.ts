import { useCallback, useEffect, useState } from "react";

import {
  getGoogleProfileEmails,
  type GoogleProfileEmailConversation,
} from "@/features/google-workspace/google-workspace-client";

function conversationTime(conversation: GoogleProfileEmailConversation) {
  if (
    typeof conversation.internalDateMs === "number" &&
    Number.isFinite(conversation.internalDateMs)
  ) {
    return conversation.internalDateMs;
  }
  const parsed = Date.parse(conversation.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

function conversationYear(conversation: GoogleProfileEmailConversation) {
  const time = conversationTime(conversation);
  return time ? new Date(time).getUTCFullYear() : null;
}

export type ProfileGoogleEmailState = {
  conversations: GoogleProfileEmailConversation[];
  current: GoogleProfileEmailConversation[];
  historical: GoogleProfileEmailConversation[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
};

export function useProfileGoogleEmail(
  organizationId: string,
  currentYear = new Date().getUTCFullYear(),
): ProfileGoogleEmailState {
  const [conversations, setConversations] = useState<
    GoogleProfileEmailConversation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getGoogleProfileEmails(organizationId);
      const historical = Array.isArray((result as any).historicalConversations)
        ? ((result as any)
            .historicalConversations as GoogleProfileEmailConversation[])
        : [];
      const unique = new Map<string, GoogleProfileEmailConversation>();
      for (const row of [...result.conversations, ...historical]) {
        unique.set(row.threadId, row);
      }
      setConversations(
        [...unique.values()].sort(
          (left, right) => conversationTime(right) - conversationTime(left),
        ),
      );
    } catch (caught) {
      setConversations([]);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load Google history.",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    conversations,
    current: conversations.filter(
      (conversation) => conversationYear(conversation) === currentYear,
    ),
    historical: conversations.filter(
      (conversation) => conversationYear(conversation) !== currentYear,
    ),
    loading,
    error,
    reload,
  };
}
