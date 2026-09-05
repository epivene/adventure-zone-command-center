import { useCallback, useEffect, useState } from "react";
import { officeGet } from "@/lib/office-auth-context";
import { officePatch } from "@/lib/office-auth-context";
import { OfficeTaskCard, type OfficeTask } from "@/components/office/office-task-card";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";

type BossAssignment = {
  id: string;
  title: string;
  details: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "todo" | "in_progress" | "waiting" | "done";
  dueAt: string | null;
};

function BossAssignmentCard({ assignment, onChanged }: { assignment: BossAssignment; onChanged(): void }) {
  async function patch(status: BossAssignment["status"]) {
    await officePatch(`/office/boss-assignments/${assignment.id}`, { status });
    onChanged();
  }
  return <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-primary">Assigned by Dave</p>
        <h3 className="mt-1 font-bold text-foreground">{assignment.title}</h3>
        {assignment.details ? <p className="mt-1 text-sm text-muted-foreground">{assignment.details}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={assignment.priority === "urgent" ? "destructive" : "outline"} className="capitalize">{assignment.priority}</Badge>
        {assignment.dueAt ? <span className="text-xs font-semibold text-muted-foreground">Due {new Date(assignment.dueAt).toLocaleDateString()}</span> : null}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {assignment.status === "todo" ? <Button size="sm" onClick={() => void patch("in_progress")}>Start</Button> : null}
      {assignment.status !== "waiting" && assignment.status !== "done" ? <Button size="sm" variant="outline" onClick={() => void patch("waiting")}>Waiting</Button> : null}
      {assignment.status !== "done" ? <Button size="sm" variant="outline" onClick={() => void patch("done")}>Done</Button> : null}
      {assignment.status === "waiting" ? <Button size="sm" variant="outline" onClick={() => void patch("in_progress")}>Resume</Button> : null}
    </div>
  </article>;
}

export default function OfficeTasksPage(){
  const [view,setView]=useState<"active"|"done">("active");const [tasks,setTasks]=useState<OfficeTask[]>([]);const [bossAssignments,setBossAssignments]=useState<BossAssignment[]>([]);const [error,setError]=useState("");
  const load=useCallback(()=>officeGet<{tasks:OfficeTask[];bossAssignments:BossAssignment[]}>(`/office/tasks?view=${view}`).then((d)=>{setTasks(d.tasks);setBossAssignments(d.bossAssignments ?? []);setError("")}).catch((e)=>setError(e instanceof Error?e.message:"Could not load tasks.")),[view]);
  useEffect(()=>{void load()},[load]);
  return <div className="grid gap-5"><header><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Booking Workspace</p><h1 className="text-3xl font-bold">Tasks</h1><p className="mt-1 text-slate-600">Office work, notes, and completed items.</p></header>
    <div className="flex gap-2"><button className={view==="active"?"button-primary":"button-secondary"} onClick={()=>setView("active")} type="button">Active</button><button className={view==="done"?"button-primary":"button-secondary"} onClick={()=>setView("done")} type="button">Done</button></div>
    {error?<p className="rounded-xl bg-rose-50 p-4 text-rose-700" role="alert">{error}</p>:null}
    <div className="grid gap-3">{bossAssignments.map((assignment)=><BossAssignmentCard key={assignment.id} assignment={assignment} onChanged={load}/>)}
      {tasks.map((task)=><OfficeTaskCard key={task.id} task={task} onChanged={load}/>)}
      {!tasks.length && !bossAssignments.length ? <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground">No {view} tasks.</p> : null}
    </div>
  </div>;
}
