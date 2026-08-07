// Devuelve la cantidad de miembros del Club Sustento para el banner de urgencia.
//
// Cuenta los miembros del Club registrados en Supabase, contando personas y no
// pagos: una suscripción mensual deja una fila por mes, así que se deduplica
// por mail. Sin eso, un solo miembro de seis meses figuraría como seis.
//
// BASE_MIEMBROS son los que entraron ANTES de que existieran los webhooks de
// Whop y de las suscripciones de MercadoPago, que no dejaron rastro en Supabase.
//
// 👉 GUIDO: este número es histórico y ya no hay que tocarlo. Los miembros
//    nuevos, entren por donde entren, se suman solos.
const BASE_MIEMBROS = 12;

const ALLOWED_ORIGINS = [
  'https://www.haceloconsustento.com',
  'https://haceloconsustento.com'
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Se traen los mails en vez de pedir un count: PostgREST no cuenta valores
    // distintos, y el volumen es de decenas de filas.
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/purchases?product_id=eq.club&status=eq.approved&select=buyer_email`,
      {
        method: 'GET',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (!response.ok) throw new Error(`Supabase ${response.status}`);

    const filas = await response.json();
    const personas = new Set(
      (Array.isArray(filas) ? filas : [])
        .map((fila) => fila.buyer_email?.trim().toLowerCase())
        .filter(Boolean)
    );

    return res.status(200).json({ count: BASE_MIEMBROS + personas.size });
  } catch (error) {
    console.error('club-miembros error:', error);
    // Si falla, el front usa el número del HTML como fallback.
    return res.status(200).json({ count: BASE_MIEMBROS });
  }
}
