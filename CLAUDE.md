---
Última actualización: 07/08/2026
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
    │   ├── webhook.js           ← MercadoPago: pagos únicos y suscripciones del Club
    │   ├── whop-webhook.js      ← Whop: cobros y bajas del Club
    │   ├── suscribir.js         ← suscribe email a la lista → manda bienvenida
    │   ├── notificar-venta.js   ← avisa a Guido por mail: ventas y bajas
    │   ├── registrar-compra.js  ← deja la compra en Supabase (lo usan los 3 cobros)
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

**Qué incluye el Club, y es fácil escribirlo mal:** recetas nuevas **todas las semanas** y **un seminario en vivo por mes**. La cadencia semanal es el mayor diferencial del producto. Hasta el 26/08/2026 la landing decía "recetas nuevas todos los meses" en tres lugares (la lista de `#club`, la respuesta del FAQ y el JSON-LD del FAQ) y el mail de bienvenida del Club decía lo mismo: estaba subvendiendo el producto. Si se toca ese texto, **son cuatro lugares**, no uno.

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
- **Las cinco variantes entregan el Mini Recetario, y va primero**, apenas después del saludo (constante `REGALO`). La persona dejó el mail por eso: si el material no aparece arriba de todo, el mail incumple lo que prometió el quiz
- **Las cinco cierran pidiendo que respondan el mail** (constante `RESPONDEME`). Ese pedido se sacó a propósito del PDF: adentro de un PDF obliga a cerrarlo y volver a la casilla, y además las respuestas le dicen a Gmail que estos mails son deseados
- Todos los mails llevan link de baja y los headers `List-Unsubscribe` (ayuda a no caer en Promociones de Gmail)

**`notificar-venta.js`** — No es un endpoint, es una función que usan `webhook.js` y `paypal-capture-order.js`
- Manda un mail a `guidosustento.nutri@gmail.com` por cada venta aprobada, con producto, comprador, monto, medio de pago e ID
- Si el producto no es descargable (el Club), el mail recuerda las dos cosas que hay que hacer a mano: dar el acceso y anotar que el cobro por MercadoPago o PayPal es de un mes solo
- Si el aviso falla no corta la entrega del producto: solo queda el error en los logs de Vercel
- Distingue **alta** de **renovación**: en una renovación el comprador no recibe nada (ya está adentro) y el aviso a Guido cambia de asunto. Ni MercadoPago ni Whop exponen un campo confiable para esto, así que se resuelve preguntándole a Supabase si esa persona ya compró el producto (`yaCompro()` en `registrar-compra.js`)
- También manda el **aviso de baja** (`notificarBaja()`) cuando alguien cancela en Whop. Antes una cancelación no llegaba a ningún lado
- **Cada tipo de aviso usa su propio nombre de remitente** (`remitente()`): `Ventas Sustento` para venta o renovación, `Avisos Sustento` para una baja, `Lista Sustento` para un alta a la lista. Hasta el 26/08/2026 los tres salían como "Ventas Sustento" y un alta se leía como si hubiera entrado plata: en la bandeja el nombre del remitente pesa más que el asunto. **Un aviso nuevo elige su remitente según si hubo dinero o no**

**`/api/whop-webhook`** — Suscripciones del Club por Whop (desde el 07/08/2026)
- Verifica la firma con el esquema **Standard Webhooks**: headers `webhook-id`, `webhook-timestamp` y `webhook-signature`, HMAC-SHA256 sobre `"{id}.{timestamp}.{body}"` con el secret en base64. Rechaza con 401 la firma inválida, el body alterado y los eventos de más de 5 minutos
- Necesita el body **sin parsear** (`bodyParser: false`), porque la firma se calcula sobre el texto crudo
- Eventos: `payment.succeeded` (registra la plata y avisa), `membership.deactivated` (avisa la baja), `membership.activated` (solo log: la plata la reporta el evento de pago, duplicar acá inflaría el conteo)
- ✅ **Funcionando desde el 26/08/2026 o antes.** Ese día entró una renovación real por Whop, con su `payment_id`, y el aviso salió bien. O sea que el webhook está creado en el dashboard y `WHOP_WEBHOOK_SECRET` está cargada en Vercel. Los nombres de los campos del payload, que estaban tomados de la documentación y no de un evento real, quedaron confirmados
- El monto que reporta Whop puede ser menor al precio de lista si el socio entró con un precio viejo. Hay al menos un socio de lanzamiento a USD 6,99 contra los USD 10 actuales: **un monto raro no es necesariamente un bug**, conviene preguntar antes de tocar nada

**Suscripciones de MercadoPago en `webhook.js`**
- **MercadoPago avisa en dos formatos y no deja elegir.** El de webhooks manda `type` + `data.id` (en el cuerpo o en la query); el viejo (IPN) manda `topic` + `id` en la query, o un `resource` que a veces es la URL completa del recurso y a veces el id pelado. `extraerTipo()` y `extraerEventId()` miran en los cuatro lugares. Hasta el 26/08/2026 solo se leía `data.id`, así que un IPN moría con 400: el pago no quedaba en `purchases`, no salía aviso, y como `yaCompro()` mira esa tabla, la cuota siguiente de esa persona habría aparecido como venta nueva
- El evento es `subscription_authorized_payment` y su `data.id` **no es el ID del pago**: es el de la factura. Hay que pedir `/authorized_payments/{id}`, sacar `payment.id` de ahí y recién entonces pedir el pago normal, que es el único que trae el mail del pagador
- Toda factura de suscripción se asume del Club: es el único plan recurrente que existe
- ✅ **Verificado el 26/08/2026.** La URL de notificación estaba puesta desde antes. Guido mandó una notificación de prueba desde `Developers → Webhooks → Simular` y el endpoint contestó **200**. Con un id de pago inventado la respuesta correcta es `200` con `{"status":404}`: significa "recibí el aviso, fui a buscar ese pago y no existe". Un 400 o un 500 ahí sí serían un problema

**`/api/baja`** — Baja de la lista de mails
- `GET` con `?email=` cuando la persona hace clic en el pie del mail (devuelve una página de confirmación); `POST` para el botón nativo de Gmail
- No borra la fila: le pone el tag `baja` en `subscribers`. **Cualquier envío masivo futuro tiene que filtrar por ese tag**

**`/api/club-miembros`** — Banner de urgencia en la landing
- Suma `BASE_MIEMBROS` + los miembros del Club registrados en Supabase
- Cuenta **personas, no pagos**: deduplica por mail, porque una suscripción mensual deja una fila por mes y sin eso un miembro de seis meses figuraría como seis
- `BASE_MIEMBROS` (12) son los que entraron antes de que existieran los webhooks. Es un número histórico: **ya no hay que tocarlo**, los nuevos se suman solos

---

## Tablas en Supabase

**`subscribers`**
```
email    TEXT  UNIQUE   (la PK es un uuid `id`, no el email)
name     TEXT
source   TEXT   (ej: "formulario-web", "quiz-club")
tags     JSONB
motivo   TEXT   (respuesta abierta del quiz, opcional)
origen   TEXT   (utm_source o dominio referidor, opcional)
```

`motivo` y `origen` se agregaron el 24/08/2026. Que el email sea UNIQUE y **no**
PK importa: por eso toda inserción que quiera ignorar duplicados necesita
`?on_conflict=email` en la URL, y `purchases` lo mismo con `payment_id`. Sin ese
parámetro PostgREST resuelve el choque contra la PK (un uuid nuevo cada vez),
nunca lo detecta, y el duplicado vuelve como 409. Está explicado en detalle en el
`CLAUDE.md` de la carpeta de arriba.

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
| `WHOP_WEBHOOK_SECRET` | Firma del webhook de Whop — ⚠️ **falta cargarla** |

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
