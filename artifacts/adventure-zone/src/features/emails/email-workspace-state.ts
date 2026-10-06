export type EmailWorkspaceView = "inbox" | "sent" | "drafts" | "review" | "needs_reply" | "waiting";
export type EmailWorkspaceState = { view: EmailWorkspaceView; query: string; folder: "inbox" | "sent" | "drafts" | "search"; threadId?: string; draftId?: string; profileId?: string; attentionMessage?: string; reviewMessageId?: string; accountId?: string };
export function readEmailWorkspaceState(search: string): EmailWorkspaceState {
  const params = new URLSearchParams(search);
  const candidate = params.get("view") || params.get("folder") || "inbox";
  const views = ["inbox","sent","drafts","review","needs_reply","waiting"];
  const view = (views.includes(candidate) ? candidate : "inbox") as EmailWorkspaceView;
  const query = params.get("q") || "";
  return { view, query, folder: candidate === "search" ? "search" : view === "sent" || view === "drafts" ? view : "inbox",
    threadId: params.get("threadId") || undefined, draftId: params.get("draftId") || undefined, profileId: params.get("profileId") || undefined,
    attentionMessage: params.get("attentionMessage") || undefined, reviewMessageId: params.get("reviewMessageId") || undefined, accountId: params.get("accountId") || undefined };
}
export function legacyReviewUrl(search: string): string {
  const params = new URLSearchParams(search); params.set("view", "review");
  return "/emails?" + params;
}
