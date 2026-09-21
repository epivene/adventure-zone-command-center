export type EventDateDisplayStatus = "booked" | "confirmed" | "expected";

export type EffectiveEventDate = {
  startsOn: string;
  endsOn: string | null;
  displayStatus: EventDateDisplayStatus;
  sourceId: string;
};

export type BookingDateInput = {
  id: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string | null;
};

export type EventDateFactInput = {
  id: string;
  startsOn: string;
  endsOn: string | null;
  status: "confirmed" | "expected" | "needs_review";
  active: boolean;
};

type RecurrenceRange = {
  durationDays: number;
};

export type EventRecurrenceRule =
  | (RecurrenceRange & {
      kind: "annual_date";
      month: number;
      day: number;
    })
  | (RecurrenceRange & {
      kind: "ordinal_weekday";
      month: number;
      ordinal: number;
      weekday: number;
    })
  | {
      kind: "unrecognized";
      raw: string;
    };

export type RecurrenceCalculation =
  | {
      status: "expected";
      startsOn: string;
      endsOn: string | null;
      calculationYear: number;
    }
  | {
      status: "needs_review";
      reason: "ambiguous_rule" | "invalid_rule" | "date_not_available";
    };
