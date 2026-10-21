import type { WorkActivity, WorkPage } from "./client";

export type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export const releasable = (a: WorkActivity) =>
  a.assignedTo?.kind === "connection" && !["completed", "cancelled"].includes(a.status);

export async function previewRelease(query: string, request: Request) {
  const params = new URLSearchParams(query);
  params.delete("cursor");
  params.set("limit", "50");
  const cards = new Map<string, WorkActivity>();
  const seen = new Set<string>();
  while (true) {
    const page = await request<WorkPage>("?" + params);
    for (const card of page.items) if (releasable(card)) cards.set(card.id, card);
    if (!page.nextCursor) return [...cards.values()];
    if (seen.has(page.nextCursor)) throw new Error("The queue changed while loading. Preview again.");
    seen.add(page.nextCursor);
    params.set("cursor", page.nextCursor);
  }
}

export async function releaseBatch(
  cards: WorkActivity[],
  request: Request,
  progress: (released: number, skipped: number) => void,
  stopped: () => boolean = () => false,
) {
  let released = 0;
  const skipped: WorkActivity[] = [];
  for (const card of cards) {
    if (stopped()) break;
    try {
      // Keep the preview revision: never silently take over a changed card.
      await request("/" + encodeURIComponent(card.id) + "/reassign", "POST", {
        revision: card.revision, actor: null,
      });
      released++;
    } catch (error) {
      if ((error as { status?: number }).status !== 409) throw error;
      skipped.push(card);
    }
    progress(released, skipped.length);
  }
  return { released, skipped };
}
