import {
  getProductionOpportunityEmailRuntime,
} from "./production-opportunity-email-runtime";
import {
  ScheduledEmailDispatcherLoop,
  systemScheduledEmailDispatcherLoopScheduler,
  type ScheduledEmailDispatcherLoopScheduler,
} from "./scheduled-email-dispatcher-loop";

type ProductionRuntime = Awaited<ReturnType<typeof getProductionOpportunityEmailRuntime>>;
type LoadRuntime = () => Promise<Pick<ProductionRuntime, "dispatcher">>;

export async function createOpportunityEmailWorkerLoop(
  loadRuntime: LoadRuntime = getProductionOpportunityEmailRuntime,
  options?: {
    workerId?: string;
    clock?: { now(): Date };
    scheduler?: ScheduledEmailDispatcherLoopScheduler;
  },
): Promise<ScheduledEmailDispatcherLoop> {
  const runtime = await loadRuntime();
  return new ScheduledEmailDispatcherLoop({
    dispatcher: runtime.dispatcher,
    workerId: options?.workerId ?? `opportunity-email-${crypto.randomUUID()}`,
    clock: options?.clock ?? { now: () => new Date() },
    scheduler:
      options?.scheduler ?? systemScheduledEmailDispatcherLoopScheduler,
  });
}
