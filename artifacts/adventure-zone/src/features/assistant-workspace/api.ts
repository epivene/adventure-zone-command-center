import { apiFetch } from "@/lib/auth-token";
export async function workspaceApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch(`/assistant/workspace${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.code ?? "ASSISTANT_REQUEST_UNAVAILABLE");
  return data as T;
}
export const lastConversationKey = "az-assistant-workspace-conversation";
export function workspaceHref() {
  const id = localStorage.getItem(lastConversationKey);
  return `/assistant/workspace${id && /^[\da-f-]{36}$/i.test(id) ? `/${id}` : ""}`;
}
