import {
  changeBookingPlaceSchema,
  replaceBookingPeopleSchema,
  type BookingPersonSelection,
  type ChangeBookingPlaceInput,
  type ReplaceBookingPeopleInput,
} from "@/features/bookings/booking-relationship-input";
import type {
  BookingRelationshipRepository,
  BookingRelationshipWriteResult,
  ChangeBookingPlaceResult,
} from "@/features/bookings/booking-relationship-repository";
import { err, ok, type Result } from "@/lib/result";

export type BookingRelationshipError =
  | { code: "INVALID_BOOKING_RELATIONSHIP_INPUT"; message: string }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "PLACE_NOT_FOUND" }
  | { code: "PERSON_NOT_ASSOCIATED_WITH_PLACE"; contactIds: string[] };

function invalidInput(
  message: string,
): Result<never, BookingRelationshipError> {
  return err({
    code: "INVALID_BOOKING_RELATIONSHIP_INPUT",
    message,
  });
}

function mapWriteResult<T>(
  result: BookingRelationshipWriteResult<T>,
): Result<T, BookingRelationshipError> {
  switch (result.kind) {
    case "ok":
      return ok(result.value);
    case "booking_not_found":
      return err({ code: "BOOKING_NOT_FOUND" });
    case "place_not_found":
      return err({ code: "PLACE_NOT_FOUND" });
    case "people_outside_place":
      return err({
        code: "PERSON_NOT_ASSOCIATED_WITH_PLACE",
        contactIds: result.contactIds,
      });
  }
}

export class BookingRelationshipService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: BookingRelationshipRepository,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async changePlace(
    input: ChangeBookingPlaceInput,
  ): Promise<Result<ChangeBookingPlaceResult, BookingRelationshipError>> {
    const parsed = changeBookingPlaceSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the Booking Place.",
      );
    }
    return mapWriteResult(
      await this.repository.changePlace(parsed.data, this.now()),
    );
  }

  async replacePeople(
    input: ReplaceBookingPeopleInput,
  ): Promise<Result<BookingPersonSelection[], BookingRelationshipError>> {
    const parsed = replaceBookingPeopleSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the Booking People.",
      );
    }
    return mapWriteResult(
      await this.repository.replacePeople(parsed.data, this.now()),
    );
  }
}
