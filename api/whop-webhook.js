import crypto from 'crypto';
import { PRODUCTS } from './products.js';
import { notificarVenta, notificarBaja } from './notificar-venta.js';
import { registrarCompra } from './registrar-compra.js';

// Tolerancia del timestamp, para que no sirva reenviar un webhook viejo.
const TOLERANCIA_SEGUNDOS = 5 * 60;

/**
 * Arma las claves candidatas a partir del secret.
 *
 * 🔴 Acá estaba el bug que tuvo el webhook diez días en 401: **el secret de
 * Whop empieza con `ws_`**, y esta función solo sacaba el prefijo `whsec_`,
 * que es el de otras plataformas. Con un secret `ws_...` el prefijo quedaba
 * adentro de la clave, y además el guion bajo no es un carácter válido en
 * base64, así que `Buffer.from(secret, 'base64')` devolvía bytes cualquiera.
 * La firma no podía coincidir nunca.
 *
 * La documentación de Whop dice que la clave es el secret `ws_...` y que el
 * verificador espera base64, pero no muestra el código exacto. Para no volver
 * a comerse otra ronda de prueba y error se prueban las variantes razonables
 * y se loguea cuál funcionó. Cuando esté confirmada, dejar solo esa.
 */
function clavesCandidatas(secret) {
  const sinPrefijo = secret.replace(/^(ws_|whsec_)/, '');
  return [
    { nombre: 'base64 sin prefijo', clave: Buffer.from(sinPrefijo, 'base64') },
    { nombre: 'utf8 sin prefijo', clave: Buffer.from(sinPrefijo, 'utf8') },
    { nombre: 'base64 con prefijo', clave: Buffer.from(secret, 'base64') },
    { nombre: 'utf8 con prefijo', clave: Buffer.from(secret, 'utf8') }
  ];
}

/**
 * Verifica la firma con el esquema Standard Webhooks que usa Whop.
 *
 * Los headers son `webhook-id`, `webhook-timestamp` y `webhook-signature`.
 * Se firma la cadena "{id}.{timestamp}.{body}" con HMAC-SHA256, y la firma
 * viaja como "v1,<base64>" (puede haber varias separadas por espacio durante
 * una rotación de secret).
 *
 * Devuelve el motivo del rechazo además del booleano: sin eso, un 401 no
 * distingue "llegó mal el cuerpo" de "el secret no es el que firma".
 */
function verificarFirma(headers, bodyCrudo, secret) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const header = headers.get('webhook-signature');

  if (!id || !timestamp || !header) {
    return {
      ok: false,
      motivo: `faltan headers (id=${Boolean(id)} timestamp=${Boolean(timestamp)} firma=${Boolean(header)})`
    };
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) {
    return {
      ok: false,
      motivo: `timestamp fuera de tolerancia (llegó ${timestamp}, acá son las ${ahora})`
    };
  }

  const recibidas = String(header)
    .split(' ')
    .map((parte) => parte.split(',')[1])
    .filter(Boolean);

  const firmado = `${id}.${timestamp}.${bodyCrudo}`;
  const esperadas = [];

  for (const { nombre, clave } of clavesCandidatas(secret)) {
    const esperada = crypto.createHmac('sha256', clave).update(firmado).digest('base64');
    esperadas.push(`${nombre}=${esperada.slice(0, 10)}…`);

    const esperadaBuf = Buffer.from(esperada);
    const coincide = recibidas.some((recibida) => {
      const recibidaBuf = Buffer.from(recibida);
      // timingSafeEqual explota si los largos difieren: hay que chequearlo antes.
      return recibidaBuf.length === esperadaBuf.length &&
        crypto.timingSafeEqual(recibidaBuf, esperadaBuf);
    });

    if (coincide) return { ok: true, variante: nombre };
  }

  // Solo los primeros caracteres de cada firma. Son salidas de HMAC, no el
  // secret, así que no se filtra nada y alcanza para comparar a ojo.
  return {
    ok: false,
    motivo: `ninguna variante coincide (cuerpo de ${bodyCrudo.length} bytes; llegó ${recibidas.map((r) => r.slice(0, 10)).join(' / ')}…; probé ${esperadas.join(' ')})`
  };
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

/**
 * Firma Web estándar, no la de Node con (req, res).
 *
 * Es a propósito: para verificar la firma hace falta el cuerpo crudo, tal cual
 * lo mandó Whop, y en las funciones de Vercel con firma de Node el cuerpo llega
 * ya parseado. `request.text()` devuelve los bytes exactos.
 */
export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (!secret) {
      console.error('Whop webhook: falta WHOP_WEBHOOK_SECRET en Vercel');
      return Response.json({ error: 'Webhook mal configurado' }, { status: 500 });
    }

    try {
      const bodyCrudo = await request.text();

      const firma = verificarFirma(request.headers, bodyCrudo, secret);
      if (!firma.ok) {
        console.error('Whop webhook rechazado:', firma.motivo);
        return Response.json({ error: 'Firma inválida' }, { status: 401 });
      }
      console.log('Whop webhook: firma válida con la variante', firma.variante);

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
            return Response.json({ received: true, warning: 'sin email' });
          }

          // Whop marca la primera factura de la suscripción. Si el campo no
          // viene, se asume alta: es el caso que necesita atención de Guido.
          const renovacion = data.billing_reason
            ? data.billing_reason !== 'subscription_create'
            : Boolean(data.renewal_period_start);

          // Whop tambien reintenta webhooks. Si el pago ya estaba registrado,
          // no se vuelve a avisar.
          const { esNueva } = await registrarCompra({
            productId: product.id,
            productName: product.name,
            buyerEmail: email,
            buyerName: nombre,
            amount: monto,
            currency: moneda,
            paymentMethod: 'whop',
            paymentId: String(data.id || request.headers.get('webhook-id'))
          });

          if (!esNueva) {
            console.log('Whop reenvio un pago ya procesado, no se avisa.');
            return Response.json({ received: true, duplicado: true });
          }

          await Promise.all([
            notificarVenta({
              product,
              buyerEmail: email,
              buyerName: nombre,
              amount: monto,
              currency: moneda,
              paymentMethod: 'Whop',
              paymentId: String(data.id || request.headers.get('webhook-id')),
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

      return Response.json({ received: true });

    } catch (error) {
      console.error('Whop webhook error:', error);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
};
