import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect }));

import NewBookingPage from "@/app/(private)/bookings/new/page";
import QuickAddPage from "@/app/(private)/quick-add/page";

describe("legacy creation routes", () => {
  it("redirects New booking to the event profile creator with its query context", async () => {
    await NewBookingPage({
      searchParams: Promise.resolve({ campaign: "summer", contactId: "contact-1" }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/event-profiles/new?campaign=summer&contactId=contact-1&legacy=booking",
    );
  });

  it("redirects Quick add to the event profile creator with its caller phone", async () => {
    await QuickAddPage({
      searchParams: Promise.resolve({ phone: "406-555-0199", source: "dialer" }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/event-profiles/new?phone=406-555-0199&source=dialer&legacy=quick-add",
    );
  });
});
