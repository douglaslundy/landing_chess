create table if not exists orders (
  id uuid primary key,
  public_token text not null unique,
  product_code text not null,
  product_title text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'BRL'),
  buyer_name text not null,
  buyer_email text not null,
  document_type text,
  document_number text,
  status text not null check (status in ('created','pending','processing','paid','rejected','cancelled','expired','refunded','charged_back')),
  payment_confirmed_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_attempts (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  method text not null check (method in ('pix','card')),
  idempotency_key text not null unique,
  mp_payment_id text unique,
  status text not null,
  status_detail text,
  amount_cents integer,
  currency text,
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expires_at timestamptz,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_attempts_order_idx on payment_attempts(order_id, created_at desc);

create table if not exists webhook_events (
  id uuid primary key,
  provider_event_id text not null default '',
  topic text not null,
  resource_id text not null,
  signature_valid boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(topic, resource_id, provider_event_id)
);

create table if not exists outbox_emails (
  id uuid primary key,
  order_id uuid not null unique references orders(id) on delete cascade,
  status text not null check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbox_emails_due_idx on outbox_emails(status, next_attempt_at);

create table if not exists provider_events (
  id uuid primary key,
  order_id uuid references orders(id) on delete set null,
  mp_payment_id text,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists request_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
