import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({path:"/profiles", get:vi.fn(), post:vi.fn()}));
vi.mock("wouter",()=>({useLocation:()=>[f.path],Link:({children,...props}:any)=><a {...props}>{children}</a>}));
vi.mock("@/lib/auth-token",()=>({apiGet:f.get,apiPost:f.post,apiPut:vi.fn()}));
import { RemindersProvider, ReminderBell, RemindersPage } from "./reminders";
beforeEach(()=>{f.path="/profiles";f.get.mockReset();f.post.mockReset();f.get.mockImplementation(async(path:string)=>path==="/deadline-rules"?{rules:[],email:{enabled:false,providerConfigured:false}}:{count:7,lastEvaluatedAt:null,notifications:[],upcoming:[]});});
afterEach(cleanup);
it("dismisses a notice and updates the list and badge without running the evaluator",async()=>{
  f.path="/settings/reminders";
  let dismissed=false;
  const notice={id:"old",organizationId:"p",profileName:"Reviewed customer",title:"Old reminder",dueOn:"2026-10-01",deadlineKind:"next_action",triggerType:"deadline_passed"};
  f.get.mockImplementation(async(path:string)=>path==="/deadline-rules"?{rules:[],email:{enabled:false,providerConfigured:false}}:{count:dismissed?0:1,lastEvaluatedAt:null,notifications:dismissed?[]:[notice],upcoming:[]});
  f.post.mockImplementation(async(path:string)=>{
    if(path==="/deadline-rules/notifications/old/dismiss")dismissed=true;
    // A slow evaluation must not hold up a saved dismissal.
    if(path==="/deadline-rules/evaluate")return new Promise(()=>{});
    return {ok:true};
  });
  render(<RemindersProvider><ReminderBell/><RemindersPage/></RemindersProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Dismiss Reviewed customer: Old reminder"}));
  await screen.findByLabelText("Reminders, 0 active");
  expect(screen.queryByRole("button",{name:"Dismiss Reviewed customer: Old reminder"})).toBeNull();
  expect(f.post.mock.calls.map(c=>c[0])).toEqual(["/deadline-rules/notifications/old/dismiss"]);
});
it("keeps a reminder visible and reports a failed dismissal without evaluating",async()=>{
  f.path="/settings/reminders";
  f.get.mockImplementation(async(path:string)=>path==="/deadline-rules"?{rules:[],email:{enabled:false,providerConfigured:false}}:{count:1,lastEvaluatedAt:null,notifications:[{id:"old",organizationId:"p",profileName:"Reviewed customer",title:"Old reminder",dueOn:"2026-10-01",deadlineKind:"next_action",triggerType:"deadline_passed"}],upcoming:[]});
  f.post.mockRejectedValue(new Error("Unavailable"));
  render(<RemindersProvider><ReminderBell/><RemindersPage/></RemindersProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Dismiss Reviewed customer: Old reminder"}));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Reminders, 1 active")).toBeTruthy();
  expect(screen.getByRole("button",{name:"Dismiss Reviewed customer: Old reminder"})).toBeTruthy();
  expect(f.post.mock.calls.map(c=>c[0])).toEqual(["/deadline-rules/notifications/old/dismiss"]);
});
it("opens search with a small read-only badge request and loads full details only when needed",async()=>{
  const view=render(<RemindersProvider><ReminderBell/></RemindersProvider>);
  await screen.findByLabelText("Reminders, 7 active");
  expect(f.get.mock.calls.map(c=>c[0])).toEqual(["/deadline-rules/badge"]);
  expect(f.post).not.toHaveBeenCalled();
  f.path="/settings/reminders";
  view.rerender(<RemindersProvider><RemindersPage/></RemindersProvider>);
  await waitFor(()=>expect(f.get).toHaveBeenCalledWith("/deadline-rules/summary"));
  expect(f.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Check reminders"}));
  await waitFor(()=>expect(f.post).toHaveBeenCalledWith("/deadline-rules/evaluate",{}));
});
it("does not replace full reminder details with an old badge refresh after navigation",async()=>{
  let finish!:()=>void;
  f.post.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(<RemindersProvider><RemindersPage/></RemindersProvider>);
  await waitFor(()=>expect(f.get).toHaveBeenCalledWith("/deadline-rules/badge"));
  fireEvent.click(screen.getByRole("button",{name:"Check reminders"}));
  f.path="/settings/reminders";
  view.rerender(<RemindersProvider><RemindersPage/></RemindersProvider>);
  await waitFor(()=>expect(f.get).toHaveBeenCalledWith("/deadline-rules/summary"));
  await act(async()=>finish());
  expect(f.get.mock.calls.filter(c=>c[0]==="/deadline-rules/badge")).toHaveLength(1);
});
