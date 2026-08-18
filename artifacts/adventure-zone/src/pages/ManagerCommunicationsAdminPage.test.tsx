// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerCommunicationsAdminPage from "./ManagerCommunicationsAdminPage";

const mocks=vi.hoisted(()=>({
  get:vi.fn(async(path:string)=>{
    if(path==="/manager-admin/messages/conversations") return {conversations:[{id:"conv-1",kind:"leg_admin",title:"Kristy + Admin",unreadCount:0}]};
    if(path==="/manager-admin/messages/conversations/conv-1") return {messages:[{id:"msg-1",actorKind:"manager",actorName:"Kristy",body:"Here is the fuel receipt",attachments:[{id:"att-1",fileName:"fuel.jpg",downloadUrl:"https://signed.example/file"}]}]};
    if(path==="/manager-admin/meetup-requests?status=pending_admin") return {requests:[{id:"request-1",requestingLegId:"leg-a",otherLegIds:["leg-b"],resourceId:"res-1",meetupLabel:"Bismarck",preferredStartsAt:"2026-08-20T18:00:00Z",preferredEndsAt:"2026-08-20T20:00:00Z",notes:"Swap trailer",linkedConversationId:"conv-1"}]};
    if(path==="/manager-admin/acknowledgments") return {acknowledgments:[{id:"ack-1",title:"Route changed",managerComment:"Please double-check this stop.",items:[{id:"i1",label:"Stop",beforeValue:"Mandan",afterValue:"Bismarck"}]}]};
    if(path==="/manager-admin/legs/access") return {legs:[{legId:"leg-a",legName:"Kristy",enabled:true},{legId:"leg-b",legName:"Hulk",enabled:true}]};
    if(path==="/manager-admin/meetup-options") return {resources:[]};
    return {};
  }),
  post:vi.fn(async(path:string,body:any)=>{
    if(path==="/manager-admin/messages/conversations") return {conversation:{id:"conv-new",kind:body.kind,title:body.title,unreadCount:0}};
    if(path==="/manager-admin/messages/conversations/conv-new") return {message:{id:"msg-new"},acknowledgments:body.requireAcknowledgment?[{id:"ack-a"},{id:"ack-b"}]:[]};
    return {};
  }),
}));
vi.mock("@/lib/auth-token",()=>({apiGet:mocks.get,apiPost:mocks.post,apiFetch:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

describe("ManagerCommunicationsAdminPage",()=>{
  it("keeps messages, requests, and review work in one communications destination",async()=>{
    render(<ManagerCommunicationsAdminPage/>);
    expect(await screen.findByText("Manager communications")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Messages"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Requests/})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Needs review/})).toBeInTheDocument();
    expect(await screen.findByText("Kristy + Admin")).toBeInTheDocument();
  });

  it("opens a chat and offers Add to leg for manager attachments",async()=>{
    render(<ManagerCommunicationsAdminPage/>);
    fireEvent.click(await screen.findByRole("button",{name:"Kristy + Admin"}));
    expect(await screen.findByText("Here is the fuel receipt")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Add to leg…"})).toBeInTheDocument();
  });

  it("shows meetup requests and acknowledgment reviews as tabs, not separate pages",async()=>{
    render(<ManagerCommunicationsAdminPage/>);
    fireEvent.click(await screen.findByRole("button",{name:/Requests/}));
    expect(await screen.findByDisplayValue("Bismarck")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Needs review/}));
    expect(await screen.findByText("Route changed")).toBeInTheDocument();
    expect(screen.getByText(/Please double-check this stop/)).toBeInTheDocument();
  });

  it("lets admin create a message and require acknowledgments",async()=>{
    render(<ManagerCommunicationsAdminPage/>);
    fireEvent.click(await screen.findByRole("button",{name:/New message/i}));
    fireEvent.click(screen.getByLabelText("Kristy"));
    fireEvent.click(screen.getByLabelText("Hulk"));
    fireEvent.change(screen.getByLabelText("Subject"),{target:{value:"Load-in update"}});
    fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Please arrive at 8 AM."}});
    fireEvent.click(screen.getByLabelText(/Require acknowledgment/i));
    fireEvent.click(screen.getByRole("button",{name:/Send message/i}));

    await waitFor(()=>expect(mocks.post).toHaveBeenCalledWith("/manager-admin/messages/conversations/conv-new",expect.objectContaining({
      body:"Please arrive at 8 AM.",
      requireAcknowledgment:true,
      acknowledgmentTitle:"Load-in update",
    })));
    expect(await screen.findByText(/2 managers need to acknowledge/i)).toBeInTheDocument();
  });
});
