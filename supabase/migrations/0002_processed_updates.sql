-- Telegram update ids handled by the webhook (dedupe of retries; ids are not monotonic).
create table processed_updates (
  update_id bigint primary key,
  at timestamptz not null default now()
);
alter table processed_updates enable row level security;
