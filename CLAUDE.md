---
Última actualización: 30/07/2026
---

# CLAUDE.md — Landing Page

Landing page de Guido Sustento y las funciones serverless que procesan pagos, suscripciones y entregas de productos digitales.

---

## URLs

| Qué | URL |
|---|---|
| Landing page pública | `https://www.haceloconsustento.com` |
| API (Vercel) | `https://sustento-webhook.vercel.app` |
| Repo en GitHub | `github.com/guidodanielli/sustento-webhook` |

---

## Stack

| Capa | Tecnología |
|---|---|
| Hosting / deploy | Vercel (auto-deploy en cada push a `main`) |
| Frontend | HTML/CSS/JS vanilla — un solo `index.html` |
| API | Funciones serverless de Vercel (`api/*.js`) |
| Pagos | MercadoPago (principal) + PayPal |
| Email | Resend (`hola@haceloconsustento.com`) |
| Base de datos | Supabase (subscribers + purchases) |
| Dependencia | `resend` (instalada con npm) |

**No hay bundler, no hay framework, no hay build step.** El `index.html` se sirve estático; las funciones de `api/` las ejecuta Vercel en el servidor.

---

## Estructura de carpetas

```
Landing Page/
├── CLAUDE.md                    ← este archivo
├── api supabase.txt             ← ⚠️ credenciales sueltas (ver abajo)
├── contenido-GEO-borradores.md  ← borradores SEO que no van al repo
└── sustento-webhook/            ← el repo git (todo el código vive acá)
    ├── index.html               ← landing page principal
    ├── og-image.jpg             ← imagen para Open Graph / WhatsApp
    ├── robots.txt · sitemap.xml
    ├── package.json             ← dep: resend
    ├── supabase-schema.sql      ← schema de las tablas en Supabase
    ├── api/                     ← funciones serverless
    │   ├── products.js          ← catálogo de productos (precios y links)
    │   ├── crear-preferencia.js ← crea preferencia de pago en MercadoPago
    │   ├── webhook.js           ← recibe notificación → envía email → loguea compra
    │   ├── suscribir.js         ← suscribe email a la lista → manda bienvenida
    │   ├── club-miembros.js     ← devuelve el count de miembros del Club
    │   ├── paypal-create-order.js
    │   ├── paypal-capture-order.js
    │   └── package.json
    ├── blog/                    ← artículos SEO (cada uno en su carpeta)
    │   ├── index.html           ← índice del blog
    │   ├── style.css
    │   └── [nombre-del-articulo]/index.html
    └── img/                     ← imágenes del sitio (.webp)
```

---

## Productos (`api/products.js`)

| ID | Nombre | ARS | USD | Tipo |
|---|---|---|---|---|
| `recetario` | Recetario Digital Sustento | $40.000 | $40 | Descargable (Drive) |
| `club` | Club Sustento — Suscripción mensual | $15.000 | $10 | Acceso (sin descarga) |

Para agregar o modificar un producto: editar `api/products.js`. El webhook y la landing page lo leen desde ahí.

---

## Flujo de pago (MercadoPago)

1. Usuario hace clic en "Comprar" → la landing llama a `/api/crear-preferencia` con el `productId`
2. `crear-preferencia.js` crea la preferencia en MP y devuelve el `init_point`
3. La landing redirige al checkout de MP
4. Usuario paga → MP llama al webhook en `https://sustento-webhook.vercel.app/api/webhook`
5. `webhook.js` verifica el pago con la API de MP, luego en paralelo:
   - Envía el email al comprador (Resend): link de descarga si es descargable, bienvenida si es el Club
   - Loguea la compra en Supabase (`purchases`)

---

## Funciones API

**`/api/suscribir`** — Formulario de la landing (captura de email)
- Guarda en Supabase `subscribers` con deduplicación silenciosa
- Si el email es nuevo, envía el email de bienvenida al ecosistema

**`/api/club-miembros`** — Banner de urgencia en la landing
- Suma `BASE_MIEMBROS` (hardcodeado) + compras del Club en Supabase
- `BASE_MIEMBROS` hay que actualizarlo a mano cuando entran miembros por Whop o manualmente (los que no pasan por MercadoPago)
- Cuando se integre el webhook de Whop, esto pasa a ser 100% automático

---

## Tablas en Supabase

**`subscribers`**
```
email    TEXT  PK
name     TEXT
source   TEXT   (ej: "formulario-web")
tags     JSONB
```

**`purchases`**
```
product_id      TEXT
product_name    TEXT
buyer_email     TEXT
buyer_name      TEXT
amount          NUMERIC
currency        TEXT
payment_method  TEXT   ("mercadopago" | "paypal")
payment_id      TEXT
status          TEXT   ("approved")
```

El schema completo está en `supabase-schema.sql`.

---

## Variables de entorno (Vercel)

Todas las credenciales viven en el panel de Vercel, nunca en el código.

| Variable | Para qué |
|---|---|
| `MP_ACCESS_TOKEN` | API de MercadoPago |
| `RESEND_API_KEY` | Envío de emails |
| `RESEND_FROM_EMAIL` | Dirección de origen del email |
| `SUPABASE_URL` | Endpoint de Supabase |
| `SUPABASE_SERVICE_KEY` | Clave de servicio de Supabase |
| `PAYPAL_CLIENT_ID` | API de PayPal |
| `PAYPAL_CLIENT_SECRET` | API de PayPal |

---

## Cómo deployar

Guido no usa terminal. El flujo es:

1. Editar el archivo en GitHub web (o GitHub Desktop)
2. Hacer commit a `main`
3. Vercel detecta el push y deploya automáticamente en ~1 minuto

No hay que tocar nada más. Si un deploy falla, revisar el panel de Vercel para ver el error de build.

---

## Advertencia: credenciales sueltas

`api supabase.txt` en la raíz de esta carpeta contiene la URL y la service key de Supabase en texto plano. Ese archivo **no debe entrar al repo** (ya está fuera del `sustento-webhook/` así que git no lo ve, pero tampoco conviene tenerlo ahí indefinidamente). Las credenciales reales viven en Vercel; este archivo es un recordatorio que quedó. Cuando ya no lo necesites, borrarlo.

---

## SEO y blog

Los artículos del blog viven en `blog/[slug]/index.html`. Cada uno es un HTML estático independiente. Los borradores de contenido GEO están en `contenido-GEO-borradores.md` (raíz de `Landing Page/`, fuera del repo).
