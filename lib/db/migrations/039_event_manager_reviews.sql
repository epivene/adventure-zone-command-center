create table if not exists event_manager_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete restrict,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  rating integer not null,
  feedback text,
  organizer_site_notes text,
  crew_notes text,
  recommend_return text,
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_manager_reviews_rating_valid check (rating between 0 and 5),
  constraint event_manager_reviews_recommend_return_valid
    check (recommend_return is null or recommend_return in ('yes','no','unsure')),
  constraint event_manager_reviews_leg_mutation_unique unique (leg_id, client_mutation_id)
);

create index if not exists event_manager_reviews_booking_created_idx
  on event_manager_reviews(booking_id, created_at desc);
create index if not exists event_manager_reviews_leg_created_idx
  on event_manager_reviews(leg_id, created_at desc);
