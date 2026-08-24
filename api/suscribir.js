import { Resend } from 'resend';
import { notificarSuscriptor } from './notificar-venta.js';

const resend = new Resend(process.env.RESEND_API_KEY);

async function insertarFila(fila) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      // Si el email ya existe, ignorar silenciosamente (no es un error).
      // return=representation nos deja saber si realmente se insertó una fila.
      'Prefer': 'resolution=ignore-duplicates,return=representation'
    },
    body: JSON.stringify(fila)
  });
}

async function agregarASupabase({ email, name, source, tags, motivo, origen }) {
  const base = {
    email,
    name: name || '',
    source: source || 'formulario-web',
    tags: tags || []
  };

  // motivo y origen viven en columnas que se agregaron después. Si el SQL de la
  // migración todavía no corrió, Supabase rechaza la fila entera por columna
  // desconocida. Antes que perder el alta, reintentamos sin esos dos campos:
  // el alta importa, el dato extra no. Cuando la migración esté, no reintenta.
  const extras = {};
  if (motivo) extras.motivo = String(motivo).slice(0, 500);
  if (origen) extras.origen = String(origen).slice(0, 120);

  let response = await insertarFila({ ...base, ...extras });

  if (!response.ok && Object.keys(extras).length > 0) {
    const detalle = await response.text().catch(() => '');
    console.error('Alta con columnas nuevas falló, reintento sin ellas:', response.status, detalle);
    response = await insertarFila(base);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error('Supabase subscribers error:', response.status, data);
    return { ok: false, isNew: false };
  }

  // Array con la fila insertada si es nuevo; array vacío si era duplicado ignorado.
  const rows = await response.json().catch(() => []);
  const isNew = Array.isArray(rows) && rows.length > 0;
  return { ok: true, isNew };
}

// Cuántos hay en total, solo para que el aviso diga "van N en la lista".
// Es un HEAD: pide cero filas y lee el total del header Content-Range.
// Si falla devuelve null y el aviso omite esa línea; nunca frena el alta.
async function contarSuscriptores() {
  try {
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers?select=id`, {
      method: 'HEAD',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });
    // Content-Range viene como "0-20/21": el total está después de la barra.
    const total = Number(String(response.headers.get('content-range') || '').split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch (err) {
    console.error('No se pudo contar los suscriptores:', err);
    return null;
  }
}

const SITIO = 'https://www.haceloconsustento.com';
const BAJA_URL = 'https://sustento-webhook.vercel.app/api/baja';
const CALENDLY = 'https://calendly.com/guidosustento-nutri/30min';
const WHATSAPP = 'https://wa.me/541171417177?text=Hola%20Guido%2C%20quiero%20unirme%20a%20Red%20Sustento';

// Las dos formas de suscribirse al Club. Son suscripciones mensuales reales.
// Whop da el acceso automático; MercadoPago no, ahí el ingreso es manual.
const WHOP_CLUB = 'https://whop.com/checkout/plan_5cUpzEWpFAjF7';
const MPAGO_CLUB = 'https://mpago.la/1U4znwx';
const WHATSAPP_CLUB = 'https://wa.me/541171417177?text=Hola%20Guido%2C%20me%20suscrib%C3%AD%20al%20Club%20por%20MercadoPago.%20Te%20paso%20el%20comprobante.';

// El mail de bienvenida cambia según lo que la persona pidió. El quiz manda
// source = quiz-club | quiz-metodo | quiz-recetario | quiz-red; el formulario
// del pie manda formulario-web. Si mañana aparece otro source, cae en general.
const VARIANTES = {
  club: {
    subject: 'Te cuento cómo es el Club 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y el resultado te llevó al Club Sustento, así que te cuento en dos líneas qué es.',
      'Es un espacio para aprender de forma continua: cada mes hay recetas nuevas con plantas, un encuentro en vivo de una hora y media sobre un tema puntual, y un entregable para que te quede algo aplicable y no solo un rato de charla.',
      'Si querés sumarte, elegí la moneda que te convenga. Es la misma membresía mensual en los dos casos y la cancelás cuando quieras.'
    ],
    ctas: [
      { texto: 'Suscribirme por USD 10/mes 🌿', url: WHOP_CLUB },
      { texto: 'Suscribirme por $15.000 ARS/mes 🇦🇷', url: MPAGO_CLUB }
    ],
    nota: `<strong>Si pagás en pesos, un paso más:</strong> MercadoPago no te manda la invitación a la comunidad como hace Whop. Cuando te suscribas, <a href="${WHATSAPP_CLUB}" style="color: #1e6f1d; font-weight: bold;">mandame el comprobante por WhatsApp</a> con tu número y te paso la invitación yo mismo. Por Whop entrás en el momento.`,
    cierre: ['Y si te queda alguna duda antes de pagar, respondé este mail. Lo leo yo.']
  },
  metodo: {
    subject: 'Te cuento cómo es el Método 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y el resultado te llevó al Método Sustento, así que te cuento de qué se trata.',
      'Son 90 días de acompañamiento para cambiar tu relación con la comida. Sin dietas, sin listas de alimentos prohibidos y sin contar calorías. Desde la expansión, no desde la restricción.',
      'Antes de cualquier cosa hay una llamada de 30 minutos sin cargo, para ver si tiene sentido en tu caso. Si no tiene sentido, te lo digo.'
    ],
    ctas: [{ texto: 'Reservar la llamada gratuita', url: CALENDLY }]
  },
  recetario: {
    subject: 'Te cuento qué tiene el Recetario 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y el resultado te llevó al Recetario, así que te cuento qué hay adentro.',
      'Son más de 60 recetas con plantas pensadas para el día a día real, no para el domingo con tiempo de sobra. Ingredientes que se consiguen y que se repiten entre recetas, para que cocinar no sea una expedición.',
      'Es un PDF: lo descargás una vez y es tuyo para siempre.'
    ],
    ctas: [{ texto: 'Ver el Recetario', url: `${SITIO}/#tienda` }]
  },
  red: {
    subject: 'Te cuento de la Red 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y me marcaste que sos profesional de la salud, así que te cuento de la Red Sustento.',
      'Es una comunidad para colegas, sobre todo nutris recién recibidos, con encuentros quincenales para compartir recorridos y crecer en comunidad. Es lo que a mí me hubiera servido cuando arranqué y no existía.',
      'El ingreso es manual y lo coordinamos por WhatsApp.'
    ],
    ctas: [{ texto: 'Escribirme por WhatsApp 💬', url: WHATSAPP }]
  },
  general: {
    subject: 'Bienvenido/a al ecosistema 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Gracias por dejarme tu mail. Que estés acá me dice que algo de lo que hago resonó con vos, y eso me alegra genuinamente.',
      'Mi forma de ver esto es simple: la salud no se mejora restringiendo, se mejora expandiendo. Aprender a cocinar rico, comer con placer y entender qué le hace bien a tu cuerpo y al planeta.',
      `No te voy a llenar la casilla de mails. La mayor parte de lo que hago del día a día vive en Instagram, así que si querés seguirme por ahí te espero como <a href="https://www.instagram.com/guido.sustento/" style="color: #1e6f1d; font-weight: bold;">@guido.sustento</a>.`,
      'Y si querés un primer paso concreto, tengo el Recetario: más de 60 recetas con plantas para el día a día.'
    ],
    ctas: [{ texto: 'Ver el Recetario', url: `${SITIO}/#tienda` }]
  }
};

function varianteDeSource(source) {
  const s = String(source || '');
  if (s.includes('club')) return 'club';
  if (s.includes('metodo')) return 'metodo';
  if (s.includes('recetario')) return 'recetario';
  if (s.includes('red')) return 'red';
  return 'general';
}

function parrafo(texto) {
  return `<p style="font-size: 1rem; line-height: 1.8; color: #444; margin: 0 0 20px 0;">${texto}</p>`;
}

function armarHtml({ variante, bajaUrl }) {
  const parrafos = variante.parrafos.map(parrafo).join('');

  // El primer botón va lleno; los siguientes con borde, para que se vea cuál es
  // la opción principal sin que la otra parezca de segunda.
  const botones = variante.ctas
    .map((cta, i) => {
      const estilo = i === 0
        ? 'background: #1e6f1d; color: #ffffff; border: 2px solid #1e6f1d;'
        : 'background: transparent; color: #1e6f1d; border: 2px solid #1e6f1d;';
      return `<a href="${cta.url}" style="${estilo} padding: 14px 30px; border-radius: 100px; text-decoration: none; font-family: Arial, sans-serif; font-weight: 600; font-size: 0.95rem; display: inline-block; margin: 0 0 10px 0;">${cta.texto}</a>`;
    })
    .join('<br>');

  const nota = variante.nota
    ? `<p style="font-size: 0.9rem; line-height: 1.7; color: #555; background: #fff; border-left: 3px solid #1e6f1d; padding: 14px 18px; margin: 0 0 24px 0;">${variante.nota}</p>`
    : '';

  const cierre = (variante.cierre || []).map(parrafo).join('');

  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111; background: #f5eee0;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 48px 40px; background: #f5eee0;">
        ${parrafos}
        <div style="margin: 32px 0 28px 0;">
          ${botones}
        </div>
        ${nota}
        ${cierre}
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin: 0 0 4px 0;">Nos vemos,</p>
        <p style="font-size: 1rem; font-weight: bold; color: #1e6f1d; margin: 0;">Guido 🌱</p>
      </div>
      <div style="background: #111; padding: 20px 40px;">
        <p style="font-size: 0.75rem; color: rgba(255,255,255,0.3); margin: 0; text-align: center; line-height: 1.7;">
          © 2026 Guido Sustento · <a href="${SITIO}" style="color: rgba(255,255,255,0.4);">haceloconsustento.com</a><br>
          Si no querés recibir más mails míos, <a href="${bajaUrl}" style="color: rgba(255,255,255,0.4);">darte de baja acá</a>.
        </p>
      </div>
    </div>
  `;
}

async function enviarBienvenida(email, source) {
  const variante = VARIANTES[varianteDeSource(source)];
  const bajaUrl = `${BAJA_URL}?email=${encodeURIComponent(email)}`;

  await resend.emails.send({
    from: `Guido Sustento <hola@haceloconsustento.com>`,
    reply_to: 'guidosustento.nutri@gmail.com',
    to: email,
    subject: variante.subject,
    // Gmail muestra su propio botón de "Cancelar suscripción" con estos headers,
    // y eso ayuda a no caer en Promociones o en spam.
    headers: {
      'List-Unsubscribe': `<${bajaUrl}>, <mailto:guidosustento.nutri@gmail.com?subject=Baja>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    },
    html: armarHtml({ variante, bajaUrl })
  });
}

export default async function handler(req, res) {
  const allowedOrigins = ['https://haceloconsustento.com', 'https://www.haceloconsustento.com'];
const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
};
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, source, tags, motivo, origen } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    const { ok, isNew } = await agregarASupabase({ email, name, source, tags, motivo, origen });
    // Solo mandamos el welcome email a suscriptores nuevos (no a duplicados).
    if (ok && isNew) {
      await enviarBienvenida(email, source);
      // Y le avisamos a Guido. Va después de la bienvenida y se traga sus
      // propios errores, así que no puede romper el alta ni la respuesta.
      await notificarSuscriptor({ email, name, source, motivo, origen, total: await contarSuscriptores() });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
