import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProfileEventDateReview } from "./profile-event-date-review";

const old = { id:"old", startsOn:"2027-08-18", endsOn:"2027-08-21", status:"confirmed", active:true, rationale:"Original contract", sourceTitle:"Original email", sourceUrl:"https://mail.google.com/#all/old", sourceRecordType:null, sourceRecordId:null };
const corrected = { ...old, id:"corrected", startsOn:"2027-08-25", endsOn:"2027-08-28", status:"needs_review", active:false, rationale:"Corrected contract. Access August 23–29.", sourceTitle:"Corrected email", sourceUrl:"https://mail.google.com/#all/corrected" };
let facts: typeof old[], failLoad:boolean, failSave:boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  facts = [old,corrected]; failLoad = false; failSave = false;
  fetchMock = vi.fn(async (url:string, init?:RequestInit) => {
    if(init?.method === "POST") {
      if(failSave) return new Response(JSON.stringify({error:"Date review unavailable"}),{status:409});
      facts = [{...old,active:false},{...corrected,active:true,status:"confirmed"}];
      return new Response(JSON.stringify(facts[1]));
    }
    return failLoad ? new Response("Unavailable",{status:503}) : new Response(JSON.stringify({organizationId:"miles-city",facts}));
  });
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const open = async () => {
  fireEvent.click(screen.getByRole("button",{name:"Review event dates"}));
  await screen.findByText("Corrected contract. Access August 23–29.");
};

it("shows the existing conflict with its evidence before allowing confirmation",async()=>{
  render(<ProfileEventDateReview profileId="miles-city" />);
  expect(fetchMock).not.toHaveBeenCalled();
  await open();
  expect(screen.getByText("Aug 18, 2027 – Aug 21, 2027")).toBeInTheDocument();
  expect(screen.getByText("Aug 25, 2027 – Aug 28, 2027")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Corrected email"})).toHaveAttribute("href",corrected.sourceUrl);
  fireEvent.click(screen.getByRole("button",{name:"Use as confirmed"}));
  expect(screen.getByRole("group",{name:"Confirm date correction"})).toHaveTextContent("Aug 25, 2027 – Aug 28, 2027");
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Cancel correction"}));
  expect(screen.queryByRole("group",{name:"Confirm date correction"})).not.toBeInTheDocument();
});

it("reviews the existing candidate once, refreshes the profile and shows the newly active dates",async()=>{
  const onApplied = vi.fn();
  render(<ProfileEventDateReview profileId="miles-city" onApplied={onApplied} />);
  await open();
  fireEvent.click(screen.getByRole("button",{name:"Use as confirmed"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm date correction"}));
  await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("Event dates updated"));
  const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain("/event-date-coverage/facts/corrected/review");
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({decision:"approve_confirmed"});
  expect(onApplied).toHaveBeenCalledOnce();
  expect(within(screen.getByRole("region",{name:"Current event dates"})).getByText("Aug 25, 2027 – Aug 28, 2027")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Use as confirmed"})).not.toBeInTheDocument();
});

it("retains the correction and reports an unsuccessful save without claiming success",async()=>{
  failSave=true; const onApplied=vi.fn();
  render(<ProfileEventDateReview profileId="miles-city" onApplied={onApplied} />);
  await open(); fireEvent.click(screen.getByRole("button",{name:"Use as confirmed"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm date correction"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Date review unavailable");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(onApplied).not.toHaveBeenCalled();
  expect(screen.getByText("Aug 18, 2027 – Aug 21, 2027")).toBeInTheDocument();
});

it("supports retry after a loading error and has a clear empty state",async()=>{
  failLoad=true;
  render(<ProfileEventDateReview profileId="miles-city" />);
  fireEvent.click(screen.getByRole("button",{name:"Review event dates"}));
  await screen.findByRole("alert");
  failLoad=false; facts=[];
  fireEvent.click(screen.getByRole("button",{name:"Reload dates"}));
  expect(await screen.findByText("No saved event dates to review.")).toBeInTheDocument();
});

it("does not report a correction as complete unless the reread shows the candidate active",async()=>{
  fetchMock.mockImplementation(async (_url:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==="POST" ? {...corrected,active:true,status:"confirmed"} : {organizationId:"miles-city",facts:[old,corrected]})));
  const onApplied=vi.fn();
  render(<ProfileEventDateReview profileId="miles-city" onApplied={onApplied} />);
  await open(); fireEvent.click(screen.getByRole("button",{name:"Use as confirmed"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm date correction"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not verify");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(onApplied).not.toHaveBeenCalled();
});

it("keeps the saved result distinct from a failed parent refresh",async()=>{
  render(<ProfileEventDateReview profileId="miles-city" onApplied={async()=>{throw Error("Network unavailable");}} />);
  await open(); fireEvent.click(screen.getByRole("button",{name:"Use as confirmed"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm date correction"}));
  await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("Event dates updated"));
  expect(await screen.findByRole("alert")).toHaveTextContent("saved, but the profile could not refresh");
});
