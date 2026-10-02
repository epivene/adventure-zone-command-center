import { useEffect, useMemo, useState } from "react";
import { ApprovalQueue } from '@/components/leg-planning/approval-review';
import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/avz-crm/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/avz-crm/components/ui/alert-dialog";
import { bossGet, bossPost, bossPatch, bossDelete } from "@/lib/boss-auth-context";
import type { Assignment } from "@/lib/boss-types";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const STATUSES = ["todo", "in_progress", "waiting", "done", "cancelled"] as const;

function priorityVariant(p: string): "destructive" | "default" | "secondary" | "outline" {
  switch (p) {
    case "urgent": return "destructive";
    case "high": return "default";
    case "normal": return "secondary";
    default: return "outline";
  }
}

type FormFields = {
  title: string;
  details: string;
  assigneeKind: "office" | "owner";
  officeAccountId: string;
  priority: typeof PRIORITIES[number];
  dueAt: string;
  status: typeof STATUSES[number];
};

const DEFAULT_FIELDS: FormFields = {
  title: "",
  details: "",
  assigneeKind: "office",
  officeAccountId: "",
  priority: "normal",
  dueAt: "",
  status: "todo",
};

function AssignmentDialog({
  initial,
  onClose,
  onSaved,
  officeAccounts,
}: {
  initial?: Assignment;
  onClose(): void;
  onSaved(): void;
  officeAccounts: Array<{ id: string; displayName: string }>;
}) {
  const isEdit = !!initial;
  const [fields, setFields] = useState<FormFields>(
    initial
      ? {
          title: initial.title,
          details: initial.details ?? "",
          assigneeKind: initial.assigneeKind,
          officeAccountId: initial.officeAccountId ?? officeAccounts[0]?.id ?? "",
          priority: initial.priority,
          dueAt: initial.dueAt ? initial.dueAt.slice(0, 10) : "",
          status: initial.status,
        }
      : { ...DEFAULT_FIELDS, officeAccountId: officeAccounts[0]?.id ?? "" }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: fields.title.trim(),
        details: fields.details.trim() || null,
        assigneeKind: fields.assigneeKind,
        officeAccountId: fields.assigneeKind === "office" ? fields.officeAccountId : null,
        priority: fields.priority,
        dueAt: fields.dueAt ? new Date(`${fields.dueAt}T12:00:00`).toISOString() : null,
        status: fields.status,
      };
      if (isEdit && initial) {
        await bossPatch(`/boss/assignments/${initial.id}`, payload);
      } else {
        await bossPost("/boss/assignments", payload);
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save assignment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Assignment" : "New Assignment"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          <label className="grid gap-1 text-sm font-semibold">
            Title
            <Input
              value={fields.title}
              onChange={(e) => patch("title", e.target.value)}
              placeholder="Assignment title"
              data-testid="input-assignment-title"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Details
            <textarea
              className="resize-none"
              rows={3}
              value={fields.details}
              onChange={(e) => patch("details", e.target.value)}
              placeholder="Optional details or instructions"
              data-testid="input-assignment-details"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Assign to
              <select
                value={fields.assigneeKind}
                onChange={(e) => patch("assigneeKind", e.target.value as "office" | "owner")}
                data-testid="select-assignment-assignee"
              >
                <option value="office">Amy</option>
                <option value="owner">Desie</option>
              </select>
            </label>
            {fields.assigneeKind === "office" ? (
              <label className="grid gap-1 text-sm font-semibold">
                Office account
                <select value={fields.officeAccountId} onChange={(e) => patch("officeAccountId", e.target.value)}>
                  {officeAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
                </select>
              </label>
            ) : null}
            <label className="grid gap-1 text-sm font-semibold">
              Priority
              <select
                value={fields.priority}
                onChange={(e) => patch("priority", e.target.value as typeof PRIORITIES[number])}
                data-testid="select-assignment-priority"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Due date
              <Input
                type="date"
                value={fields.dueAt}
                onChange={(e) => patch("dueAt", e.target.value)}
                data-testid="input-assignment-due"
              />
            </label>
            {isEdit ? (
              <label className="grid gap-1 text-sm font-semibold">
                Status
                <select
                  value={fields.status}
                  onChange={(e) => patch("status", e.target.value as typeof STATUSES[number])}
                  data-testid="select-assignment-status"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !fields.title.trim() || (fields.assigneeKind === "office" && !fields.officeAccountId)}
            data-testid="button-save-assignment"
          >
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BossAssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [officeAccounts, setOfficeAccounts] = useState<Array<{ id: string; displayName: string }>>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, targets] = await Promise.all([
        bossGet<{ assignments: Assignment[] } | Assignment[]>("/boss/assignments"),
        bossGet<{ officeAccounts: Array<{ id: string; displayName: string }> }>("/boss/assignment-targets"),
      ]);
      setAssignments(Array.isArray(data) ? data : (data.assignments ?? []));
      setOfficeAccounts(targets.officeAccounts ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load assignments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const displayed = useMemo(() => {
    if (statusFilter === "active") {
      return assignments.filter((a) => !["done", "cancelled"].includes(a.status));
    }
    if (statusFilter === "done") {
      return assignments.filter((a) => a.status === "done");
    }
    return assignments;
  }, [assignments, statusFilter]);

  async function remove(id: string) {
    try {
      await bossDelete(`/boss/assignments/${id}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete assignment.");
    }
  }

  return (
    <div className="grid gap-5" data-testid="boss-assignments-page">
      <ApprovalQueue role="boss"/>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Assignments</h1>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-new-assignment">
          <Plus className="mr-2 h-4 w-4" /> New Assignment
        </Button>
      </header>

      <div className="flex gap-2" role="tablist">
        {[["active", "Active"], ["all", "All"], ["done", "Done"]].map(([val, label]) => (
          <Button
            key={val}
            role="tab"
            aria-selected={statusFilter === val}
            variant={statusFilter === val ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(val)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="assignments-empty">
          <p className="font-semibold text-foreground">No assignments.</p>
          <p className="mt-1 text-sm text-muted-foreground">Create an assignment to delegate work to Amy or the owner.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {displayed.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid={`assignment-item-${a.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.assigneeKind === "office" ? "Amy" : "Desie"}
                    {" · "}
                    {a.status.replace("_", " ")}
                    {a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                  </p>
                  {a.details ? (
                    <p className="mt-2 text-sm text-muted-foreground">{a.details}</p>
                  ) : null}
                </div>
                <Badge variant={priorityVariant(a.priority)} className="shrink-0">
                  {a.priority}
                </Badge>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(a)}
                  data-testid={`button-edit-assignment-${a.id}`}
                >
                  Edit
                </Button>
                {!["done", "cancelled"].includes(a.status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await bossPatch(`/boss/assignments/${a.id}`, { status: "done" });
                      await load();
                    }}
                    data-testid={`button-done-assignment-${a.id}`}
                  >
                    Mark done
                  </Button>
                ) : null}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto" data-testid={`button-delete-assignment-${a.id}`}>
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete assignment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete "{a.title}". This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void remove(a.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate ? (
        <AssignmentDialog
          onClose={() => setShowCreate(false)}
          onSaved={() => void load()}
          officeAccounts={officeAccounts}
        />
      ) : null}
      {editing ? (
        <AssignmentDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
          officeAccounts={officeAccounts}
        />
      ) : null}
    </div>
  );
}
