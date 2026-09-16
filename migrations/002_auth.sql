create table admin_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table client_credentials (
  email text primary key,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  subject_type text not null check (subject_type in ('admin','client')),
  subject_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_expires_idx on sessions(expires_at);

create table magic_links (
  token text primary key,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index magic_links_email_idx on magic_links(email, created_at desc);

create table access_log (
  id uuid primary key,
  subject_type text not null check (subject_type in ('admin','client')),
  subject_id text,
  event text not null check (event in ('login_success','login_failure','logout','admin_action')),
  detail text,
  ip text,
  created_at timestamptz not null default now()
);
create index access_log_created_idx on access_log(created_at desc);
