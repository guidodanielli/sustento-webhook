/**
 * Lo que alguien completa en /suscribirme/ antes de ir a pagar a MercadoPago.
 *
 * Existe porque el checkout de un plan de MercadoPago no deja pasar datos
 * propios: el pago llega con el mail de la cuenta de MP y nada más. Para que
 * Guido pueda sumar a la persona al grupo sin pedirle el comprobante por
 * WhatsApp, el WhatsApp se guarda acá y el webhook lo busca por mail cuando
 * entra el cobro.
 *
 * Tabla `altas_suscripcion` (creada el 05/11/2026, RLS prendido: solo la
 * service key la lee). Ninguna función de acá tira error hacia afuera: si
 * Supabase no responde, la persona igual tiene que poder pagar.
 */

const TABLA = 'altas_suscripcion';

function headers(extra = {}) {
  return {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    ...extra
  };
}

export async function guardarAlta({ producto, nombre, email, whatsapp, origen }) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${TABLA}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ producto, nombre, email, whatsapp, origen: origen || null })
    });
    if (!response.ok) {
      console.error('Supabase guardarAlta:', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase guardarAlta error:', err);
    return false;
  }
}

/**
 * La última alta de ese mail para ese producto en los últimos 30 días, o null.
 *
 * Se busca por mail en minúsculas, igual que se guarda. Puede no aparecer aunque la
 * persona haya llenado el formulario: si pagó con una cuenta de MercadoPago de
 * otro mail, no hay forma de unir las dos cosas. Por eso el aviso de "por
 * pagar" que sale al completar el formulario ya trae el WhatsApp.
 */
export async function buscarAlta({ email, producto }) {
  if (!email || !producto) return null;
  try {
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const query = new URLSearchParams({
      // suscripcion.js lo guarda en minúsculas: alcanza con comparar igual.
      email: `eq.${String(email).trim().toLowerCase()}`,
      producto: `eq.${producto}`,
      created_at: `gte.${desde}`,
      select: 'nombre,whatsapp',
      order: 'created_at.desc',
      limit: '1'
    });
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${TABLA}?${query}`, { headers: headers() });
    if (!response.ok) return null;
    const filas = await response.json();
    return Array.isArray(filas) && filas[0] ? filas[0] : null;
  } catch (err) {
    console.error('Supabase buscarAlta error:', err);
    return null;
  }
}
