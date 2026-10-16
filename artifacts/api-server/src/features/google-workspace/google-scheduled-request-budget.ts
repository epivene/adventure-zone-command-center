import { AsyncLocalStorage } from "node:async_hooks";
import { SyncFailure } from "./google-mailbox-sync-client";
type Budget = { active: number; waiting: (() => void)[] };
const context = new AsyncLocalStorage<Budget>();
export function withScheduledGoogleBudget<T>(
  work: () => Promise<T>,
): Promise<T> {
  return context.run({ active: 0, waiting: [] }, work);
}
export function scheduledGoogleFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const budget = context.getStore();
    if (!budget) return fetcher(input, init);
    const deadline = AbortSignal.timeout(20000);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadline])
      : deadline;
    if (budget.active < 2) budget.active++;
    else await new Promise<void>((resolve) => budget.waiting.push(resolve));
    try {
      signal.throwIfAborted();
      const response = await fetcher(input, { ...init, signal });
      if (!response.body) return response;
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 8 * 1024 * 1024)
            throw new SyncFailure("invalid", "SYNC_RESPONSE_TOO_LARGE");
          chunks.push(part.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const headers = new Headers(response.headers);
      headers.set("content-length", String(size));
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      const next = budget.waiting.shift();
      if (next) next();
      else budget.active--;
    }
  };
}
