import { describe, expect, it } from "vitest";

import type {
  BookingRelationshipRepository,
  BookingRelationshipWriteResult,
} from "@/features/bookings/booking-relationship-repository";
import { BookingRelationshipService } from "@/features/bookings/booking-relationship-service";
import type {
  BookingPersonSelection,
  ChangeBookingPlaceInput,
  ReplaceBookingPeopleInput,
} from "@/features/bookings/booking-relationship-input";

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  place: "22222222-2222-4222-8222-222222222222",
  personOne: "33333333-3333-4333-8333-333333333333",
  personTwo: "44444444-4444-4444-8444-444444444444",
};
const now = new Date("2026-07-29T12:00:00.000Z");

class RecordingBookingRelationshipRepository
implements BookingRelationshipRepository {
  changePlaceCalls: { input: ChangeBookingPlaceInput; now: Date }[] = [];
  replacePeopleCalls: { input: ReplaceBookingPeopleInput; now: Date }[] = [];
  changePlaceResult: BookingRelationshipWriteResult<{
    bookingId: string;
    organizationId: string;
    primaryContactId: string | null;
    removedContactIds: string[];
  }> = {
    kind: "ok",
    value: {
      bookingId: ids.booking,
      organizationId: ids.place,
      primaryContactId: ids.personOne,
      removedContactIds: [],
    },
  };
  replacePeopleResult: BookingRelationshipWriteResult<BookingPersonSelection[]> = {
    kind: "ok",
    value: [{ contactId: ids.personOne, role: null, isPrimary: true }],
  };

  async changePlace(input: ChangeBookingPlaceInput, currentTime: Date) {
    this.changePlaceCalls.push({ input, now: currentTime });
    return this.changePlaceResult;
  }

  async replacePeople(input: ReplaceBookingPeopleInput, currentTime: Date) {
    this.replacePeopleCalls.push({ input, now: currentTime });
    return this.replacePeopleResult;
  }
}

function createService() {
  const repository = new RecordingBookingRelationshipRepository();
  return {
    repository,
    service: new BookingRelationshipService(repository, { now: () => now }),
  };
}

describe("BookingRelationshipService", () => {
  it("validates input before calling the repository", async () => {
    const { repository, service } = createService();

    await expect(service.changePlace({
      bookingId: "not-a-booking",
      organizationId: ids.place,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_BOOKING_RELATIONSHIP_INPUT" },
    });
    expect(repository.changePlaceCalls).toEqual([]);
  });

  it("uses normalized People and the injected time", async () => {
    const { repository, service } = createService();

    await service.replacePeople({
      bookingId: ids.booking,
      people: [{
        contactId: ids.personOne,
        role: "  Event Director  ",
        isPrimary: true,
      }],
    });

    expect(repository.replacePeopleCalls).toEqual([{
      input: {
        bookingId: ids.booking,
        people: [{
          contactId: ids.personOne,
          role: "Event Director",
          isPrimary: true,
        }],
      },
      now,
    }]);
  });

  it("maps a missing Booking", async () => {
    const { repository, service } = createService();
    repository.changePlaceResult = { kind: "booking_not_found" };

    await expect(service.changePlace({
      bookingId: ids.booking,
      organizationId: ids.place,
    })).resolves.toEqual({
      ok: false,
      error: { code: "BOOKING_NOT_FOUND" },
    });
  });

  it("maps a missing Place", async () => {
    const { repository, service } = createService();
    repository.changePlaceResult = { kind: "place_not_found" };

    await expect(service.changePlace({
      bookingId: ids.booking,
      organizationId: ids.place,
    })).resolves.toEqual({
      ok: false,
      error: { code: "PLACE_NOT_FOUND" },
    });
  });

  it("rejects replacement People without active Place relationships", async () => {
    const { repository, service } = createService();
    repository.replacePeopleResult = {
      kind: "people_outside_place",
      contactIds: [ids.personTwo],
    };

    await expect(service.replacePeople({
      bookingId: ids.booking,
      people: [{
        contactId: ids.personTwo,
        role: null,
        isPrimary: false,
      }],
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "PERSON_NOT_ASSOCIATED_WITH_PLACE",
        contactIds: [ids.personTwo],
      },
    });
  });
});
