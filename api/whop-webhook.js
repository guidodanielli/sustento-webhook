import crypto from 'crypto';
import { PRODUCTS } from './products.js';
import { notificarVenta, notificarBaja } from './notificar-venta.js';
import { registrarCompra } from './registrar-compra.js';

// Whop manda el body firmado: hay que leerlo crudo, sin que Vercel lo parsee.
export const config = { api: { bodyParser: false } };

// Tolerancia del timestamp, para que no sirva reenviar un webhook viejo.
const TOLERANCIA_SEGUNDOS = 5 * 60;

function leerBodyCrudo(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Verifica la firma con el esquema Standard Webhooks que usa Whop.
 *
 * Los headers son `webhook-id`, `webhook-timestamp` y `webhook-signature`.
 * Se firma la cadena "{id}.{timestamp}.{body}" con HMAC-SHA256 usando el
 * secret en base64, y la firma viaja como "v1,<base64>" (puede haber varias
 * separadas por espacio durante una rotación de secret).
 */
function firmaValida(req, bodyCrudo, secret) {
  const id = req.headers['webhook-id'];
  const timestamp = req.headers['webhook-timestamp'];
  const header = req.headers['webhook-signature'];

  if (!id || !timestamp || !header) return false;

  const ahora = Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) {
    console.error('Whop webhook: timestamp fuera de tolerancia');
    return false;
  }

  // El secret de Whop viene con el prefijo "whsec_" y el resto es base64.
  const secretLimpio = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const esperada = crypto
    .createHmac('sha256', Buffer.from(secretLimpio, 'base64'))
    .update(`${id}.${timestamp}.${bodyCrudo}`)
    .digest('base64');

  const esperadaBuf = Buffer.from(esperada);

  return String(header)
    .split(' ')
    .map((parte) => parte.split(',')[1])
    .filter(Boolean)
    .some((recibida) => {
      const recibidaBuf = Buffer.from(recibida);
      // timingSafeEqual explota si los largos difieren: hay que chequearlo antes.
      return recibidaBuf.length === esperadaBuf.length &&
        crypto.timingSafeEqual(recibidaBuf, esperadaBuf);
    });
}

/**
 * Saca los datos del miembro del payload.
 *
 * Whop no expone un contrato estable para todos los eventos, así que se buscan
 * los campos en los lugares donde suelen venir. Si algo no aparece queda en el
 * log de Vercel para poder ajustarlo contra un evento real.
 */
function extraerDatos(data = {}) {
  const email =
    data.user_email ||
    data.email ||
    data.user?.email ||
    data.member?.email ||
    data.membership?.user?.email ||
    null;

  const nombre =
    data.user?.name ||
    data.user?.username ||
    data.name ||
    data.member?.name ||
    null;

  // Whop manda los montos en unidades enteras de la moneda (no en centavos).
  const monto = Number(
    data.final_amount ??
    data.amount ??
    data.subtotal ??
    PRODUCTS.club.usd
  );

  const moneda = String(data.currency || 'usd').toUpperCase();

  return { email, nombre, monto, moneda };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Whop webhook: falta WHOP_WEBHOOK_SECRET en Vercel');
    return res.status(500).json({ error: 'Webhook mal configurado' });
  }

  try {
    const bodyCrudo = await leerBodyCrudo(req);

    if (!firmaValida(req, bodyCrudo, secret)) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const payload = JSON.parse(bodyCrudo);
    // Whop cambió el nombre de este campo entre versiones de la API.
    const evento = payload.action || payload.type || payload.event;
    const data = payload.data || {};

    const { email, nombre, monto, moneda } = extraerDatos(data);
    const product = PRODUCTS.club;

    switch (evento) {
      // Cobro exitoso: el alta y cada renovación mensual.
      case 'payment.succeeded':
      case 'payment_succeeded': {
        if (!email) {
          console.error('Whop payment.succeeded sin email:', bodyCrudo);
          return res.status(200).json({ received: true, warning: 'sin email' });
        }

        // Whop marca la primera factura de la suscripción. Si el campo no
        // viene, se asume alta: es el caso que necesita atención de Guido.
        const renovacion = data.billing_reason
          ? data.billing_reason !== 'subscription_create'
          : Boolean(data.renewal_period_start);

        await Promise.all([
          registrarCompra({
            productId: product.id,
            productName: product.name,
            buyerEmail: email,
            buyerName: nombre,
            amount: monto,
            currency: moneda,
            paymentMethod: 'whop',
            paymentId: String(data.id || req.headers['webhook-id'])
          }),
          notificarVenta({
            product,
            buyerEmail: email,
            buyerName: nombre,
            amount: monto,
            currency: moneda,
            paymentMethod: 'Whop',
            paymentId: String(data.id || req.headers['webhook-id']),
            recurrente: true,
            accesoAutomatico: true,
            renovacion
          })
        ]);
        break;
      }

      // Se cayó del Club: canceló, falló el cobro o se fue.
      case 'membership.deactivated':
      case 'membership_went_invalid': {
        await notificarBaja({
          buyerEmail: email,
          buyerName: nombre,
          motivo: data.cancel_reason || data.status_reason || null,
          plataforma: 'Whop'
        });
        break;
      }

      // El alta de la membresía no genera cobro propio: la plata la reporta
      // payment.succeeded. Se deja en el log y no se duplica el aviso.
      case 'membership.activated':
      case 'membership_went_valid':
        console.log('Whop: membresía activada para', email || 'sin email');
        break;

      default:
        console.log('Whop: evento sin manejar:', evento);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Whop webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
