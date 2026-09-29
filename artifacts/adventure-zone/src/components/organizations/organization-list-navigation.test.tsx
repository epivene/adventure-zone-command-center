import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { OrganizationList } from "./organization-list";
it("opens the full profile instead of intercepting the link for a preview", () => {
  const route = memoryLocation({ path: "/profiles?q=fair", record: true });
  render(<Router hook={route.hook}><OrganizationList query={{search:"fair",lastResort:"all",filler:"all",page:1,pageSize:50,sort:"recently_updated"} as any} travelLegs={[]} organizations={{records:[{id:"p1",name:"County Fair",contactCount:0,bookingCount:0}],total:1,page:1,pageSize:50,pageCount:1} as any} /></Router>);
  fireEvent.click(screen.getByRole("link", {name:"Open County Fair profile"}));
  expect(route.history.at(-1)).toMatch(/^\/profiles\/p1/);
});

