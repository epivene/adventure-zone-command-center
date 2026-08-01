ALTER TABLE "travel_legs" DROP CONSTRAINT IF EXISTS "travel_legs_sort_order_between_1_and_4";
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_sort_order_between_1_and_9" CHECK ("travel_legs"."sort_order" between 1 and 9);
INSERT INTO "travel_legs" ("name", "color", "sort_order") VALUES
  ('Leg 5', '#C77700', 5),
  ('Leg 6', '#008B8B', 6),
  ('Leg 7', '#B23A8A', 7),
  ('Leg 8', '#4B6584', 8),
  ('Leg 9', '#6B8E23', 9)
ON CONFLICT ("sort_order") DO NOTHING;
