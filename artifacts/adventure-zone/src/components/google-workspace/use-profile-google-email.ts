import { useCallback, useEffect, useRef, useState } from "react";

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
  const requestVersion = useRef(0);
  const [loadedFor, setLoadedFor] = useState(organizationId);
  const [conversations, setConversations] = useState<
    GoogleProfileEmailConversation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadedFor(organizationId);
    setConversations([]);
    setLoading(true);
    setError(null);
    try {
      const result = await getGoogleProfileEmails(organizationId);
      if (version !== requestVersion.current) return;
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
      if (version !== requestVersion.current) return;
      setConversations([]);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load Google history.",
      );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
    return () => { requestVersion.current++; };
  }, [reload]);

  const visible = loadedFor === organizationId ? conversations : [];
  return {
    conversations: visible,
    current: visible.filter(
      (conversation) => conversationYear(conversation) === currentYear,
    ),
    historical: visible.filter(
      (conversation) => conversationYear(conversation) !== currentYear,
    ),
    loading: loadedFor !== organizationId || loading,
    error: loadedFor === organizationId ? error : null,
    reload,
  };
}
