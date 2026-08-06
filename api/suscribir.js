import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function agregarASupabase({ email, name, source, tags }) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      // Si el email ya existe, ignorar silenciosamente (no es un error).
      // return=representation nos deja saber si realmente se insertó una fila.
      'Prefer': 'resolution=ignore-duplicates,return=representation'
    },
    body: JSON.stringify({
      email,
      name: name || '',
      source: source || 'formulario-web',
      tags: tags || []
    })
  });

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

const SITIO = 'https://www.haceloconsustento.com';
const BAJA_URL = 'https://sustento-webhook.vercel.app/api/baja';
const CALENDLY = 'https://calendly.com/guidosustento-nutri/30min';
const WHATSAPP = 'https://wa.me/541171417177?text=Hola%20Guido%2C%20quiero%20unirme%20a%20Red%20Sustento';

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
      'Se paga mes a mes y te podés ir cuando quieras. Si te queda alguna duda, respondé este mail. Lo leo yo.'
    ],
    cta: { texto: 'Ver el Club', url: `${SITIO}/#club` }
  },
  metodo: {
    subject: 'Te cuento cómo es el Método 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y el resultado te llevó al Método Sustento, así que te cuento de qué se trata.',
      'Son 90 días de acompañamiento para cambiar tu relación con la comida. Sin dietas, sin listas de alimentos prohibidos y sin contar calorías. Desde la expansión, no desde la restricción.',
      'Antes de cualquier cosa hay una llamada de 30 minutos sin cargo, para ver si tiene sentido en tu caso. Si no tiene sentido, te lo digo.'
    ],
    cta: { texto: 'Reservar la llamada gratuita', url: CALENDLY }
  },
  recetario: {
    subject: 'Te cuento qué tiene el Recetario 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y el resultado te llevó al Recetario, así que te cuento qué hay adentro.',
      'Son más de 60 recetas con plantas pensadas para el día a día real, no para el domingo con tiempo de sobra. Ingredientes que se consiguen y que se repiten entre recetas, para que cocinar no sea una expedición.',
      'Es un PDF: lo descargás una vez y es tuyo para siempre.'
    ],
    cta: { texto: 'Ver el Recetario', url: `${SITIO}/#tienda` }
  },
  red: {
    subject: 'Te cuento de la Red 🌱',
    parrafos: [
      'Buenas buenas!! Soy Guido, nutricionista y cocinero.',
      'Hiciste el quiz y me marcaste que sos profesional de la salud, así que te cuento de la Red Sustento.',
      'Es una comunidad para colegas, sobre todo nutris recién recibidos, con encuentros quincenales para compartir recorridos y crecer en comunidad. Es lo que a mí me hubiera servido cuando arranqué y no existía.',
      'El ingreso es manual y lo coordinamos por WhatsApp.'
    ],
    cta: { texto: 'Escribirme por WhatsApp 💬', url: WHATSAPP }
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
    cta: { texto: 'Ver el Recetario', url: `${SITIO}/#tienda` }
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

function armarHtml({ variante, bajaUrl }) {
  const parrafos = variante.parrafos
    .map(p => `<p style="font-size: 1rem; line-height: 1.8; color: #444; margin: 0 0 20px 0;">${p}</p>`)
    .join('');

  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111; background: #f5eee0;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 48px 40px; background: #f5eee0;">
        ${parrafos}
        <div style="margin: 36px 0;">
          <a href="${variante.cta.url}" style="background: #1e6f1d; color: #ffffff; padding: 16px 32px; border-radius: 100px; text-decoration: none; font-family: Arial, sans-serif; font-weight: 600; font-size: 1rem; display: inline-block;">${variante.cta.texto}</a>
        </div>
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

  const { email, name, source, tags } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    const { ok, isNew } = await agregarASupabase({ email, name, source, tags });
    // Solo mandamos el welcome email a suscriptores nuevos (no a duplicados).
    if (ok && isNew) {
      await enviarBienvenida(email, source);
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
