// Devuelve la cantidad de miembros del Club Sustento para el banner de urgencia.
//
// Cuenta las compras del Club registradas en Supabase (las que entran por
// MercadoPago vía el webhook). Los miembros que entran por Whop o manualmente
// NO están en Supabase todavía, así que se suman con BASE_MIEMBROS.
//
// 👉 GUIDO: actualizá BASE_MIEMBROS con los miembros que entraron por Whop o a
//    mano (los que no pasan por MercadoPago). Las compras MP se suman solas.
//    Cuando montemos el webhook de Whop, esto pasa a ser 100% automático.
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
    // HEAD con Prefer: count=exact devuelve el total en el header content-range.
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/purchases?product_id=eq.club&select=id`,
      {
        method: 'GET',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Prefer': 'count=exact',
          'Range': '0-0'
        }
      }
    );

    // content-range: "0-0/<total>"  ó  "*/<total>"
    const contentRange = response.headers.get('content-range') || '';
    const total = parseInt(contentRange.split('/').pop(), 10);
    const comprasMP = Number.isFinite(total) ? total : 0;

    return res.status(200).json({ count: BASE_MIEMBROS + comprasMP });
  } catch (error) {
    console.error('club-miembros error:', error);
    // Si falla, el front usa el número del HTML como fallback.
    return res.status(200).json({ count: BASE_MIEMBROS });
  }
}
