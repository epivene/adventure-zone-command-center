ALTER TABLE "travel_legs" DROP CONSTRAINT IF EXISTS "travel_legs_sort_order_between_1_and_4";
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_sort_order_between_1_and_9" CHECK ("travel_legs"."sort_order" between 1 and 9);
