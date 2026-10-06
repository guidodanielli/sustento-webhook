/**
 * Qué botón tocó cada seguidor nuevo en el DM automático de ManyChat.
 *
 * El DM a seguidores nuevos (Follow to DM) pregunta "qué te trajo a mi cuenta?"
 * con cuatro botones. Cada botón dispara un External Request de ManyChat a
 * este endpoint, así el toque queda registrado aunque la persona nunca llegue
 * a la web. Es la única forma de saber qué viene a buscar quien recién sigue:
 * el mail (con su utm_content) solo cuenta a los que siguieron hasta el final.
 *
 *  - POST /api/dm-boton  body { boton, contacto }
 *    boton: recetas | pasarme | ordenar | nutri
 *    contacto: el Contact Id de ManyChat ({{user_id}}). No es el usuario de
 *    Instagram ni un dato personal: sirve solo para no contar dos veces a
 *    quien toca más de un botón o el mismo dos veces. Vale el primero.
 *
 * El repo es público, así que no cualquiera puede escribir: ManyChat manda el
 * header x-manychat-secret con el valor de MANYCHAT_SECRET (panel de Vercel).
 *
 * Siempre contesta rápido y nunca rompe el flujo de ManyChat: si Supabase
 * falla, queda en los logs y el DM sigue igual.
 */

const BOTONES = ['recetas', 'pasarme', 'ordenar', 'nutri'];

async function registrarToque({ boton, contacto }) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/dm_botones?on_conflict=contacto`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      // Mismo criterio que la lista de mails: si el contacto ya tocó un botón,
      // se ignora en silencio. El on_conflict de la URL es lo que lo hace andar.
      'Prefer': 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify({ boton, contacto })
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => '');
    console.error('Supabase dm_botones error:', response.status, detalle);
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secreto = process.env.MANYCHAT_SECRET;
  if (!secreto || req.headers['x-manychat-secret'] !== secreto) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const boton = String((req.body || {}).boton || '').trim().toLowerCase();
  const contacto = String((req.body || {}).contacto || '').trim().slice(0, 64);
  if (!BOTONES.includes(boton) || !contacto) {
    return res.status(400).json({ error: 'Falta boton o contacto' });
  }

  const ok = await registrarToque({ boton, contacto });
  return res.status(200).json({ ok });
}
