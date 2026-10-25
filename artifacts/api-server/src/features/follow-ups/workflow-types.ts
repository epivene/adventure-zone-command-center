export const queueBuckets = [
  "needsNextStep",
  "overdue",
  "today",
  "upcoming",
] as const;
export type QueueBucket = (typeof queueBuckets)[number];
export type WorkSource =
  "followup" | "booking" | "opportunity" | "conversation";
export type NextAction = { kind: string; dueAt: string };
export type QueueItem = {
  id: string;
  source: WorkSource;
  revision: string;
  bucket: QueueBucket;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  eventYear: number | null;
  opportunityId: string | null;
  name: string;
  nextAction: string;
  dueAt: string | null;
  status: string | null;
};
export type QueuePage = {
  items: QueueItem[];
  total: number;
  counts: Record<QueueBucket, number>;
  offset: number;
  limit: number;
  timeZone: string;
  checkedAt: string;
};
export interface WorkflowSql {
  query(sql: string, values?: any[]): Promise<{ rows: any[] }>;
}
export interface WorkflowDatabase extends WorkflowSql {
  transaction<T>(work: (sql: WorkflowSql) => Promise<T>): Promise<T>;
}
export class WorkflowError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
