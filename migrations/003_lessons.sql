create table lessons (
  id uuid primary key,
  title text not null,
  description text,
  content_type text not null check (content_type in ('pdf','video')),
  url text not null,
  position integer not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lessons_position_idx on lessons(position);
