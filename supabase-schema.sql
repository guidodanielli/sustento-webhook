-- Ejecutar este SQL en el SQL Editor de tu proyecto Supabase
-- https://app.supabase.com → tu proyecto → SQL Editor

create table if not exists purchases (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now(),
  product_id      text        not null,
  product_name    text        not null,
  buyer_email     text        not null,
  buyer_name      text,
  amount          numeric     not null,
  currency        text        not null,
  payment_method  text        not null, -- 'mercadopago' | 'paypal'
  payment_id      text        not null unique,
  status          text        not null default 'approved'
);

-- Índices para filtrar rápido en el dashboard
create index if not exists purchases_created_at_idx on purchases (created_at desc);
create index if not exists purchases_product_id_idx on purchases (product_id);
create index if not exists purchases_payment_method_idx on purchases (payment_method);

-- Desactivar acceso público anónimo (solo la service key puede escribir)
alter table purchases enable row level security;

create policy "Solo service key puede insertar"
  on purchases for insert
  using (false)
  with check (false);
