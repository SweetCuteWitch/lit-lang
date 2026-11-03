create extension if not exists pgcrypto;

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table lessons (
  no integer primary key,
  title text not null,
  grammar text not null,
  topic text not null,
  skill text not null,
  words text[] not null default '{}'
);

create table portions (
  id uuid primary key default gen_random_uuid(),
  lesson_no integer not null,
  seq integer not null,
  theory text not null,
  words jsonb not null default '[]',
  status text not null default 'ready' check (status in ('ready', 'served')),
  served_at timestamptz,
  unique (lesson_no, seq)
);

create table words (
  id uuid primary key default gen_random_uuid(),
  lemma text not null unique,
  translation text not null,
  pos text not null,
  gender text check (gender in ('m', 'f')),
  key_forms text[] not null default '{}',
  example text,
  verified boolean not null default false,
  lesson_no integer not null,
  box smallint not null default 0,
  due_at timestamptz not null,
  added_at timestamptz not null
);
create index words_due_idx on words (due_at);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  kind text not null check (kind in ('choice', 'input', 'translate', 'order', 'reading', 'writing')),
  lesson_no integer not null,
  portion_id uuid references portions (id),
  slot text not null check (slot in ('new', 'review')),
  payload jsonb not null,
  tags text[] not null default '{}',
  status text not null default 'ready' check (status in ('ready', 'served', 'retired')),
  created_at timestamptz not null
);
create index tasks_status_idx on tasks (status, slot, seq);
create index tasks_portion_idx on tasks (portion_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('new', 'review')),
  portion_id uuid references portions (id),
  started_at timestamptz not null,
  finished_at timestamptz,
  items jsonb not null default '[]',
  cursor integer not null default 0,
  message_ids bigint[] not null default '{}',
  last_update_id bigint,
  state jsonb not null default '{}',
  correct integer not null default 0,
  total integer not null default 0
);
create index sessions_started_idx on sessions (started_at);

create table answers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task', 'word', 'writing')),
  task_id uuid references tasks (id),
  word_id uuid references words (id),
  session_id uuid references sessions (id),
  answer text not null,
  correct boolean,
  exact boolean not null default false,
  tags text[] not null default '{}',
  lesson_no integer,
  disputed boolean not null default false,
  dispute_note text,
  review text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index answers_created_idx on answers (created_at desc);
create index answers_lesson_idx on answers (lesson_no, created_at desc);

-- Only the service role key (server/CLI) accesses these tables; no public policies.
alter table settings enable row level security;
alter table lessons enable row level security;
alter table portions enable row level security;
alter table words enable row level security;
alter table tasks enable row level security;
alter table sessions enable row level security;
alter table answers enable row level security;
