import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { groupAttentionNotices, AttentionView, attentionDay } from "./attention-view";
const n=(id:string,dueOn:string|null,deadlineKind:string|null,triggerType="deadline_passed")=>({id,organizationId:id,profileName:id,title:"Reminder",dueOn,deadlineKind,triggerType});
it("partitions every notice without discarding old tasks or confusing event dates with work",()=>{
 const notices=[n("due","2026-10-16","next_action"),n("old-task","2025-01-01","next_action"),n("future","2026-10-17","event"),n("old-event","2026-10-15","event"),n("dormant",null,null,"inactive"),n("unknown",null,null)];
 const groups=groupAttentionNotices(notices,"2026-10-16");
 expect(groups.due.map(n=>n.id)).toEqual(["old-task","due"]);
 expect(groups.upcoming.map(n=>n.id)).toEqual(["future"]);
 expect(groups.pastEvents.map(n=>n.id)).toEqual(["old-event"]);
 expect(groups.dormant.map(n=>n.id)).toEqual(["dormant"]);
 expect(groups.other.map(n=>n.id)).toEqual(["unknown"]);
 expect(Object.values(groups).flat()).toHaveLength(notices.length);
 expect(notices[0].id).toBe("due");
});
it("separates explicitly reviewed waiting tasks without hiding other work for that customer",()=>{
 const waiting={...n("waiting","2026-10-01","next_action"),attentionState:"waiting_reply" as const};
 const decision={...n("owner-decision","2026-10-01","next_action"),organizationId:waiting.organizationId};
 const event={...n("event","2026-10-16","event"),attentionState:"waiting_reply" as const};
 const future={...n("future-waiting","2026-10-20","next_action"),attentionState:"waiting_reply" as const};
 const notices=[waiting,decision,event,future];
 const groups=groupAttentionNotices(notices,"2026-10-16");
 expect(groups.waiting.map(n=>n.id)).toEqual(["waiting","future-waiting"]);
 expect(groups.due.map(n=>n.id)).toEqual(["owner-decision","event"]);
 expect(Object.values(groups).flat()).toHaveLength(4);
 const dismiss=vi.fn();
 render(<AttentionView notices={notices} today="2026-10-16" onDismiss={dismiss}/>);
 expect(screen.getByRole("heading",{name:"Waiting on replies (2)"})).toBeTruthy();
 expect(screen.getByRole("link",{name:"waiting"})).toBeTruthy();
 expect(dismiss).not.toHaveBeenCalled();
});
it("uses Mountain time at the date boundary",()=>{
 expect(attentionDay(new Date("2026-10-17T01:00:00Z"))).toBe("2026-10-16");
});
it("keeps secondary sections collapsed, pages long lists, and never writes when browsing",()=>{
 const dismiss=vi.fn();
 render(<AttentionView today="2026-10-16" notices={[...Array.from({length:55},(_,i)=>n(`Task ${i}`,"2026-10-16","next_action")),n("Dormant customer",null,null,"inactive"),n("Old event customer","2025-01-01","event")]} onDismiss={dismiss}/>);
 expect(screen.getByRole("heading",{name:"Due now (55)"})).toBeTruthy();
 expect(screen.getAllByRole("link")).toHaveLength(50);
 expect(screen.queryByText("Dormant customer")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Show more due now"}));
 expect(screen.getAllByRole("link")).toHaveLength(55);
 fireEvent.click(screen.getByText("Dormant prospects (1)"));
 // Native details toggle is dispatched explicitly in jsdom.
 const section=screen.getByText("Dormant prospects (1)").parentElement as HTMLDetailsElement;
 section.open=true;
 fireEvent(section,new Event("toggle"));
 expect(screen.getByRole("link",{name:"Dormant customer"})).toBeTruthy();
 expect(dismiss).not.toHaveBeenCalled();
});
