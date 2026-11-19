create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null,
  lesson_no integer not null,
  tags text[] not null default '{}',
  payload jsonb not null,
  variants jsonb not null default '[]',
  created_at timestamptz not null
);
alter table recipes enable row level security;

alter table tasks
  add column score smallint not null default 0,
  add column due_at timestamptz,
  add column recipe_id uuid references recipes (id),
  add column variant_key text;
create unique index tasks_recipe_variant_idx on tasks (recipe_id, variant_key) where recipe_id is not null;
create index tasks_due_idx on tasks (due_at);
