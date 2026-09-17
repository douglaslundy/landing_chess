create table settings (
  key text primary key,
  value text not null,
  encrypted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table orders add column product_description text;

insert into settings (key, value, encrypted) values
  ('product_title', 'Xadrez Essencial', false),
  ('product_description', 'Livro digital Xadrez Essencial, 10 volumes em PDF', false),
  ('product_amount_cents', '3990', false),
  ('product_currency', 'BRL', false);
