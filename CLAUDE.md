---
Última actualización: 06/08/2026
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
    │   ├── notificar-venta.js   ← avisa a Guido por mail cuando entra una venta
    │   ├── baja.js              ← baja de la lista de mails (link del pie)
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

| ID | Nombre | ARS | USD | Cómo se cobra |
|---|---|---|---|---|
| `recetario` | Recetario Digital Sustento | $40.000 | $40 | Pago único por MercadoPago o PayPal, entrega automática (Drive) |
| `club` | Club Sustento | $15.000/mes | $10/mes | **Suscripción, con links propios fuera de `products.js`** |

Para agregar o modificar un **producto de pago único**: editar `api/products.js`. El webhook, PayPal y la landing lo leen desde ahí.

**El Club es la excepción y conviene tenerlo claro.** Desde el 06/08/2026 no se cobra por `products.js` ni por `crear-preferencia.js`: esa ruta generaba un pago de un mes suelto, sin renovación ni acceso automático. Ahora la sección `#club` de la landing y el mail de bienvenida del Club linkean directo a dos suscripciones mensuales reales:

| Moneda | Plataforma | Link | Acceso |
|---|---|---|---|
| USD 10/mes | Whop | `https://whop.com/checkout/plan_5cUpzEWpFAjF7` | Whop manda solo la invitación a la comunidad |
| $15.000 ARS/mes | MercadoPago | `https://mpago.la/1U4znwx` | **Manual.** MercadoPago sí le avisa del pago a Guido, pero no manda ninguna invitación. Por eso se pide el comprobante por WhatsApp: confirma el pago y le da el número para mandar la invitación a la comunidad |

La entrada `club` de `products.js` sigue existiendo porque el webhook la necesita para los pagos únicos viejos (hay uno del 06/08/2026). Para cambiar precios del Club hay que editar los dos links **y** los textos de la landing y de `suscribir.js`, no `products.js`.

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

**`/api/suscribir`** — Formulario de la landing y quiz (captura de email)
- Guarda en Supabase `subscribers` con deduplicación silenciosa
- Si el email es nuevo, envía el email de bienvenida
- El mail de bienvenida **cambia según el `source`**: quien pidió el Club recibe el del Club, quien pidió el Método recibe la invitación a la llamada, etc. Los textos están en la constante `VARIANTES` del mismo archivo
- Todos los mails llevan link de baja y los headers `List-Unsubscribe` (ayuda a no caer en Promociones de Gmail)

**`notificar-venta.js`** — No es un endpoint, es una función que usan `webhook.js` y `paypal-capture-order.js`
- Manda un mail a `guidosustento.nutri@gmail.com` por cada venta aprobada, con producto, comprador, monto, medio de pago e ID
- Si el producto no es descargable (el Club), el mail recuerda las dos cosas que hay que hacer a mano: dar el acceso y anotar que el cobro por MercadoPago o PayPal es de un mes solo
- Si el aviso falla no corta la entrega del producto: solo queda el error en los logs de Vercel
- ⚠️ **Qué NO avisa:** solo se dispara desde el webhook de MercadoPago (`type: payment`) y desde la captura de PayPal. Las suscripciones al Club por **Whop** y por el **link de suscripción de MercadoPago** no pasan por acá, así que no generan aviso. De esas Guido se entera por Whop y por el comprobante que le mandan por WhatsApp. Para automatizarlas hacen falta el webhook de Whop y manejar el evento `subscription_authorized_payment` de MP (que además exige configurar la URL de notificación en el plan)

**`/api/baja`** — Baja de la lista de mails
- `GET` con `?email=` cuando la persona hace clic en el pie del mail (devuelve una página de confirmación); `POST` para el botón nativo de Gmail
- No borra la fila: le pone el tag `baja` en `subscribers`. **Cualquier envío masivo futuro tiene que filtrar por ese tag**

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
