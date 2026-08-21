// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { OfficeAuthProvider,useOfficeAuth } from "@/lib/office-auth-context";
function Harness(){const auth=useOfficeAuth();return <button onClick={()=>void auth.signIn("amy","office-password")}>Office sign in</button>;}
beforeEach(()=>{localStorage.clear();localStorage.setItem("az_owner_token","owner-stays");localStorage.setItem("az_manager_token","manager-stays");vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({token:"office-token",expiresAt:"2099-01-01T00:00:00Z",office:{id:"10000000-0000-4000-8000-000000000001",displayName:"Amy",role:"office_coordinator"}}),{status:200,headers:{"Content-Type":"application/json"}})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Office Coordinator authentication",()=>{it("stores only the Office token without changing owner or manager sessions",async()=>{render(<OfficeAuthProvider><Harness/></OfficeAuthProvider>);fireEvent.click(screen.getByRole("button",{name:"Office sign in"}));await waitFor(()=>expect(localStorage.getItem("az_office_token")).toBe("office-token"));expect(localStorage.getItem("az_owner_token")).toBe("owner-stays");expect(localStorage.getItem("az_manager_token")).toBe("manager-stays");});});
