import { PRODUCTS, checkoutDelPlan } from './_lib/products.js';
import { guardarAlta } from './_lib/altas.js';
import { notificarPorPagar } from './_lib/notificar-venta.js';

/**
 * POST /api/suscripcion — el formulario de /suscribirme/.
 *
 * Guarda nombre, mail y WhatsApp, le avisa a Guido que la persona se fue a
 * pagar, y devuelve el link del plan de MercadoPago. Con eso la persona ya no
 * tiene que mandar el comprobante por WhatsApp: Guido tiene el número antes de
 * que entre el pago.
 *
 * Se usa el checkout del PLAN, no una suscripción armada por API, a propósito:
 * una suscripción por API exige que el mail coincida con el de la cuenta de
 * MercadoPago de quien paga, y si no coincide el pago se cae. El plan acepta
 * cualquier cuenta. Es el mismo link que había antes en la web, así que el
 * paso de pagar no cambia para nadie.
 *
 * Nunca deja a la persona sin poder pagar: si Supabase o el aviso fallan, igual
 * devuelve el link.
 */

const PRODUCTOS_PERMITIDOS = ['club', 'red'];

const ALLOWED_ORIGINS = [
  'https://www.haceloconsustento.com',
  'https://haceloconsustento.com'
];

const MAIL_VALIDO = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

// Letras de cualquier idioma, espacios, punto, apóstrofe y guion.
function limpiarNombre(valor) {
  return String(valor || '').replace(/[^\p{L}\p{M}\s.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// Dígitos, +, espacios, guiones y paréntesis. Se valida que haya al menos 8 dígitos.
function limpiarWhatsapp(valor) {
  return String(valor || '').replace(/[^\d+\s()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

function limpiarOrigen(valor) {
  return String(valor || '').replace(/[^\w.-]/g, '').slice(0, 60);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const productId = String(body.producto || '');
  if (!PRODUCTOS_PERMITIDOS.includes(productId)) {
    return res.status(400).json({ error: 'Producto inválido' });
  }
  const product = PRODUCTS[productId];
  const checkout = checkoutDelPlan(product);

  // Honeypot: un humano no ve el campo. Al bot se le contesta como si todo
  // hubiera salido bien, sin guardar ni avisar.
  if (body.sitio) {
    return res.status(200).json({ url: checkout });
  }

  const nombre = limpiarNombre(body.nombre);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const whatsapp = limpiarWhatsapp(body.whatsapp);
  const origen = limpiarOrigen(body.origen);

  const errores = {};
  if (nombre.length < 2) errores.nombre = 'Escribí tu nombre.';
  if (!MAIL_VALIDO.test(email)) errores.email = 'Escribí un mail válido.';
  if (whatsapp.replace(/\D/g, '').length < 8) errores.whatsapp = 'Escribí tu WhatsApp con código de área.';
  if (Object.keys(errores).length) {
    return res.status(400).json({ error: 'Revisá los datos', errores });
  }

  // Las dos cosas en paralelo y sin esperar a que salgan bien: ninguna de las
  // dos puede trabar el pago.
  await Promise.allSettled([
    guardarAlta({ producto: productId, nombre, email, whatsapp, origen }),
    notificarPorPagar({ product, nombre, email, whatsapp, origen })
  ]);

  console.log(`Alta por pagar: ${productId} (${origen || 'sin origen'})`);
  return res.status(200).json({ url: checkout });
}
