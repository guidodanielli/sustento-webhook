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

drop policy if exists "Solo service key puede insertar" on purchases;
create policy "Solo service key puede insertar"
  on purchases for insert
  with check (false);


-- ============================================================
-- Tabla de suscriptores (reemplaza Mailchimp)
-- La service key inserta desde /api/suscribir; anon bloqueado.
-- ============================================================
create table if not exists subscribers (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  email       text        not null unique,
  name        text,
  source      text,                       -- formulario-web | quiz-club | quiz-metodo | quiz-recetario | quiz-red
  tags        text[]      default '{}',
  motivo      text,                       -- respuesta abierta del quiz: "¿qué te trajo hasta acá?"
  origen      text                        -- utm_source del link, o el dominio que la refirió, o 'directo'
);

-- Si la tabla ya existía sin estas dos columnas, correr esto una vez:
alter table subscribers add column if not exists motivo text;
alter table subscribers add column if not exists origen text;

-- Desde el 06/10/2026: lo que eligió en el modo regalo ante "qué es lo que más
-- te cuesta hoy?" (ideas | tiempo | proteina | sostener | otra). Si es "otra",
-- lo que escribió va a motivo.
alter table subscribers add column if not exists barrera text;
create index if not exists subscribers_barrera_idx on subscribers (barrera);

create index if not exists subscribers_created_at_idx on subscribers (created_at desc);
create index if not exists subscribers_source_idx on subscribers (source);

alter table subscribers enable row level security;

drop policy if exists "Solo service key puede insertar subs" on subscribers;
create policy "Solo service key puede insertar subs"
  on subscribers for insert
  with check (false);


-- ============================================================
-- Botones del DM a seguidores nuevos (ManyChat, desde el 06/10/2026)
-- /api/dm-boton guarda qué contestó cada seguidor a "qué te trajo a mi
-- cuenta?". Un registro por contacto de ManyChat: vale el primer botón.
-- ============================================================
create table if not exists dm_botones (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  boton       text        not null,       -- recetas | pasarme | ordenar | nutri
  contacto    text        not null unique -- Contact Id de ManyChat, no el usuario de Instagram
);

create index if not exists dm_botones_created_at_idx on dm_botones (created_at desc);

alter table dm_botones enable row level security;
