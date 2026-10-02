import { useMemo } from "react";
import {
  planningReadSchema,
  planningCatalogSchema,
  legSeasonPlanSchema,
  approvalRequestSchema,
  planningApprovalReviewSchema,
  type PlanningRead,
  type PlanDraft,
  type EventPlan,
  type MutationResult,
  type RevisionWrite,
  type PlanningCatalog,
  type LegSeasonPlan,
  type ApprovalRequest,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/auth-token";
import { bossFetch } from "@/lib/boss-auth-context";
import { useOptionalManagerAuth } from "@/lib/manager-auth-context";
import { notifyLegPlanningChanged } from "@/features/bookings/booking-operations-changes";
export type PlanningRole = "owner" | "boss" | "manager";
export type ApprovalReviewData = {
  canDecide: boolean;
  request: ApprovalRequest;
  plans: PlanningRead[];
};
export type PlanningClient = {
  read(id: string): Promise<PlanningRead>;
  catalog(): Promise<PlanningCatalog>;
  season(legId: string, year: number): Promise<LegSeasonPlan | null>;
  save(
    draft: PlanDraft,
    revision: number | null,
    key?: string,
  ): Promise<MutationResult<EventPlan>>;
  write<T>(
    path: string,
    input: RevisionWrite<unknown> | unknown,
    method?: "POST" | "PATCH",
  ): Promise<MutationResult<T>>;
  get<T>(path: string): Promise<T>;
  approvals(requestId?: string): Promise<ApprovalReviewData[]>;
};
export function requestKey() {
  return crypto.randomUUID();
}
export function createPlanningClient(
  request: <T>(path: string, options?: RequestInit) => Promise<T>,
  role: PlanningRole,
): PlanningClient {
  const prefix = role === "owner" ? "" : `/${role}`;
  const get = <T>(path: string) => request<T>(`${prefix}${path}`);
  const unfinished = new Map<string, string>();
  const write = async <T>(
    path: string,
    input: unknown,
    method: "POST" | "PATCH" = "POST",
  ) => {
    const body =
      input && typeof input === "object" && "requestKey" in input
        ? (input as Record<string, unknown>)
        : null;
    const intent = body
      ? JSON.stringify({
          path,
          method,
          input: { ...body, requestKey: undefined },
        })
      : null;
    if (intent && body) {
      const key = unfinished.get(intent) ?? String(body.requestKey);
      unfinished.set(intent, key);
      input = { ...body, requestKey: key };
    }
    const result = await request<MutationResult<T>>(`${prefix}${path}`, {
      method,
      body: JSON.stringify(input),
    });
    if (intent) unfinished.delete(intent);
    notifyLegPlanningChanged(result);
    return result;
  };
  return {
    get,
    write,
    read: async (id) =>
      planningReadSchema.parse(
        await get(`/bookings/${encodeURIComponent(id)}/operating-plan`),
      ),
    catalog: async () =>
      planningCatalogSchema.parse(await get("/leg-planning/catalog")),
    season: async (leg, year) =>
      legSeasonPlanSchema
        .nullable()
        .parse(await get(`/leg-seasons/${encodeURIComponent(leg)}/${year}`)),
    save: (draft, revision, key = requestKey()) =>
      write<EventPlan>(
        `/bookings/${draft.bookingId}/operating-plan`,
        { payload: draft, expectedRevision: revision, requestKey: key },
        "PATCH",
      ),
    approvals: async (id) =>
      planningApprovalReviewSchema
        .array()
        .parse(
          await get(
            `/leg-approvals${id ? `?requestId=${encodeURIComponent(id)}` : ""}`,
          ),
        ),
  };
}
function responseClient(fetcher: typeof apiFetch) {
  return async <T>(path: string, options?: RequestInit) => {
    const response = await fetcher(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(
        new Error(data.error ?? `Planning unavailable (${response.status})`),
        { status: response.status, code: data.code },
      );
    return data as T;
  };
}
const owner = createPlanningClient(responseClient(apiFetch), "owner"),
  boss = createPlanningClient(responseClient(bossFetch), "boss");
export function usePlanningClient(
  role: PlanningRole,
  override?: PlanningClient,
) {
  const manager = useOptionalManagerAuth();
  return useMemo(
    () =>
      override ??
      (role === "owner"
        ? owner
        : role === "boss"
          ? boss
          : createPlanningClient(
              manager?.managerApi ??
                (async () => {
                  throw new Error("Manager session required");
                }),
              "manager",
            )),
    [override, role, manager?.managerApi],
  );
}
