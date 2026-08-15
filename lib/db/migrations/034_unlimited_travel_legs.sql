-- Release 1: travel legs are no longer capped at nine.
alter table travel_legs
  drop constraint if exists travel_legs_sort_order_between_1_and_9;
