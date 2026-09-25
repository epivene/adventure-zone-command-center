export function ConversationContext({ summary }: { summary: unknown }) {
  if (!summary || typeof summary !== "object") return null;
  const s = summary as {
    schemaVersion?: number;
    totalMessageCount?: number;
    recentMessageCount?: number;
    omittedMessageCount?: number;
    entries?: {
      messageId: string;
      excerpt: string;
      role: string;
      truncated: boolean;
    }[];
  };
  if (
    s.schemaVersion !== 1 ||
    !Array.isArray(s.entries) ||
    !s.entries.length ||
    ![s.totalMessageCount, s.recentMessageCount, s.omittedMessageCount].every(
      (n) => Number.isSafeInteger(n) && Number(n) >= 0,
    )
  )
    return null;
  return (
    <details className="border-b bg-slate-50 p-4 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium">
        Earlier conversation context
      </summary>
      <p className="my-2">
        The latest run used {s.recentMessageCount} recent messages and{" "}
        {s.entries.length} earlier excerpts. {s.omittedMessageCount} older
        messages were outside that overview. Excerpts may leave out details; the
        assistant can retrieve the originals.
      </p>
      <ul className="space-y-3">
        {s.entries.map((e) => (
          <li key={e.messageId}>
            <a className="underline" href={`#message-${e.messageId}`}>
              Open original{" "}
              {e.role === "user" ? "message" : "assistant response"}
            </a>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {e.excerpt}
              {e.truncated ? "…" : ""}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
