import { Resend } from 'resend';
import { PRODUCTS } from './products.js';
import { notificarVenta } from './notificar-venta.js';
import { registrarCompra, yaCompro } from './registrar-compra.js';

const resend = new Resend(process.env.RESEND_API_KEY);

async function getPaymentDetails(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  return response.json();
}

/**
 * Trae la factura de una suscripción (el "authorized payment").
 *
 * El payload de una suscripción no trae el ID del pago real: trae el de la
 * factura, que a su vez apunta al pago en `payment.id`. Recién con ese ID se
 * puede pedir el pago normal, que es el único que trae el mail del pagador.
 */
async function getAuthorizedPayment(authorizedPaymentId) {
  const response = await fetch(
    `https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`,
    { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
  );
  return response.json();
}

function buildClubEmail({ buyerName }) {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 48px 40px; background: #f5eee0;">
        <h2 style="font-family: Georgia, serif; color: #1e6f1d; font-size: 1.5rem; margin-bottom: 16px;">
          ¡Hola${buyerName ? ' ' + buyerName : ''}! Bienvenido/a al Club Sustento 🌿
        </h2>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          Gracias por sumarte. Tu pago de este mes ya está confirmado y desde ahora sos parte del Club.
        </p>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          En las próximas horas te voy a escribir para darte acceso al espacio con las recetas, los seminarios y la comunidad. Si tenés cualquier duda, respondé este mail o escribime a Instagram como <strong>@guido.sustento</strong>.
        </p>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 4px;">Nos vemos adentro,</p>
        <p style="font-size: 1rem; font-weight: bold; color: #1e6f1d; margin: 0;">Guido 🌱</p>
      </div>
      <div style="background: #111; padding: 20px 40px;">
        <p style="font-size: 0.75rem; color: rgba(255,255,255,0.3); margin: 0; text-align: center;">
          © 2026 Guido Sustento · <a href="https://www.haceloconsustento.com" style="color: rgba(255,255,255,0.4);">haceloconsustento.com</a>
        </p>
      </div>
    </div>
  `;
}

// Version en texto de los dos mails al comprador. Van junto al HTML: un mail
// que viaja solo en HTML le parece envio masivo a Gmail y cae en Promociones.
function textoDescarga({ buyerName, product }) {
  return [
    `Hola${buyerName ? ' ' + buyerName : ''}! Tu ${product.name} ya es tuyo.`,
    'Gracias por tu compra. Este es el link para descargarlo:',
    product.driveUrl,
    'Si tenés alguna duda, me encontrás en Instagram como @guido.sustento.',
    'Que lo disfrutes!',
    'Guido'
  ].join('\n\n');
}

function textoClub({ buyerName }) {
  return [
    `Hola${buyerName ? ' ' + buyerName : ''}! Ya estás adentro del Club Sustento.`,
    'En las próximas horas te escribo para darte el acceso al espacio de la comunidad.',
    'Si tenés alguna duda, respondé este mail. Lo leo yo.',
    'Guido'
  ].join('\n\n');
}

function buildEmail({ buyerName, product }) {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 48px 40px; background: #f5eee0;">
        <h2 style="font-family: Georgia, serif; color: #1e6f1d; font-size: 1.5rem; margin-bottom: 16px;">
          ¡Hola${buyerName ? ' ' + buyerName : ''}! Tu ${product.name} ya es tuyo. 🌱
        </h2>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          Gracias por tu compra. Acá abajo encontrás el link para descargar tu ${product.name}.
        </p>
        <div style="text-align: center; margin: 36px 0;">
          <a href="${product.driveUrl}" style="background: #1e6f1d; color: #ffffff; padding: 16px 36px; border-radius: 100px; text-decoration: none; font-family: Arial, sans-serif; font-weight: 600; font-size: 1rem; display: inline-block;">
            📥 Descargar ${product.name}
          </a>
        </div>
        <p style="font-size: 0.88rem; color: #888; margin-bottom: 20px; text-align: center;">
          Si el botón no funciona, copiá este link:<br>
          <a href="${product.driveUrl}" style="color: #1e6f1d;">${product.driveUrl}</a>
        </p>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          Si tenés alguna duda, me encontrás en Instagram como <strong>@guido.sustento</strong>.
        </p>
        <p style="font-size: 1rem; color: #444; margin-bottom: 4px;">¡Que lo disfrutes!</p>
        <p style="font-size: 1rem; font-weight: bold; color: #1e6f1d; margin: 0;">Guido 🌱</p>
      </div>
      <div style="background: #111; padding: 20px 40px;">
        <p style="font-size: 0.75rem; color: rgba(255,255,255,0.3); margin: 0; text-align: center;">
          © 2026 Guido Sustento · <a href="https://www.haceloconsustento.com" style="color: rgba(255,255,255,0.4);">haceloconsustento.com</a>
        </p>
      </div>
    </div>
  `;
}

// MercadoPago avisa en dos formatos y no deja elegir cuál manda. El de webhooks
// usa `type` + `data.id`; el viejo (IPN) usa `topic` + `id` en la query, o un
// `resource` que a veces es la URL completa del recurso y a veces el id pelado.
// Por eso se busca en los cuatro lugares: un pago que no encontremos acá se
// pierde entero. No queda en `purchases`, no sale aviso, y como `yaCompro()`
// mira esa tabla, la cuota siguiente de esa persona parecería una venta nueva
// en vez de una renovación.
function extraerTipo(req) {
  return req.body?.type || req.body?.topic || req.query?.type || req.query?.topic;
}

function extraerEventId(req) {
  const query = req.query || {};
  const directo = req.body?.data?.id || query['data.id'] || query.id;
  if (directo) return String(directo);

  const resource = req.body?.resource;
  if (!resource) return null;

  // "https://api.mercadopago.com/v1/payments/123" y "123" tienen que dar 123.
  const ultimo = String(resource).split('?')[0].split('/').filter(Boolean).pop();
  return /^[\w-]+$/.test(ultimo || '') ? ultimo : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const type = extraerTipo(req);
    const esSuscripcion = type === 'subscription_authorized_payment';

    if (type !== 'payment' && !esSuscripcion) {
      return res.status(200).json({ received: true });
    }

    const eventId = extraerEventId(req);
    if (!eventId) {
      // Si llegamos acá es un formato que no conocíamos: queda el cuerpo y la
      // query crudos para poder leerlo, porque el pago no se registra en
      // ningún lado y no hay forma de reconstruirlo después.
      console.error(
        'MP sin id de pago. Cuerpo:', JSON.stringify(req.body),
        'Query:', JSON.stringify(req.query)
      );
      return res.status(400).json({ error: 'No payment ID' });
    }

    // Las suscripciones del Club llegan como factura: hay que dar un salto más
    // para llegar al pago real, que es el que trae el mail del pagador.
    let paymentId = eventId;
    let facturaSuscripcion = null;

    if (esSuscripcion) {
      facturaSuscripcion = await getAuthorizedPayment(eventId);
      paymentId = facturaSuscripcion?.payment?.id;

      if (!paymentId) {
        console.error('Suscripción MP sin payment.id:', JSON.stringify(facturaSuscripcion));
        return res.status(200).json({ received: true, warning: 'sin payment id' });
      }
    }

    const payment = await getPaymentDetails(paymentId);

    if (payment.status !== 'approved') {
      return res.status(200).json({ status: payment.status });
    }

    const buyerEmail = payment.payer?.email;
    const buyerName = payment.payer?.first_name;
    // El único plan de suscripción que tiene Guido en MP es el del Club, así
    // que una factura de suscripción es siempre el Club.
    const productId = esSuscripcion
      ? 'club'
      : (payment.external_reference || 'recetario');
    const product = PRODUCTS[productId] || PRODUCTS['recetario'];

    if (!buyerEmail) {
      console.error('MP sin payer.email. paymentId:', paymentId, 'pago:', JSON.stringify(payment));
      return res.status(400).json({ error: 'No buyer email' });
    }

    // El Club es una suscripción (sin archivo para descargar): mail de bienvenida.
    // El resto son productos digitales descargables: mail con el link.
    const esDescargable = Boolean(product.driveUrl);

    // Si el producto es recurrente, esto es una suscripción, venga como venga
    // el evento. MercadoPago manda estos cobros unas veces como
    // subscription_authorized_payment y otras como un payment común, así que
    // el tipo de evento no sirve para decidir: el producto sí. Atarlo a
    // esSuscripcion hacía que toda cuota mensual del Club cobrada por MP se
    // anunciara como venta nueva y le remandara la bienvenida al socio.
    const esRecurrente = Boolean(product.recurring);

    // Si ya compró este producto antes, esto es la renovación mensual: no
    // corresponde darle la bienvenida de nuevo ni pedirle que espere el acceso.
    const esRenovacion = esRecurrente && await yaCompro({ buyerEmail, productId: product.id });

    const emailContent = esDescargable
      ? { subject: `¡Acá está tu ${product.name}! 🌿`, html: buildEmail({ buyerName, product }), text: textoDescarga({ buyerName, product }) }
      : { subject: `¡Bienvenido/a al Club Sustento! 🌿`, html: buildClubEmail({ buyerName }), text: textoClub({ buyerName }) };

    // Se registra ANTES de avisar y de entregar. Si el pago ya estaba en la
    // tabla, la pasarela está reenviando una notificación vieja y no hay que
    // volver a hacer nada: ni mail al comprador ni aviso a Guido.
    const { esNueva } = await registrarCompra({
      productId: product.id,
      productName: product.name,
      buyerEmail,
      buyerName,
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      paymentMethod: esRecurrente ? 'mercadopago-suscripcion' : 'mercadopago',
      paymentId: String(paymentId)
    });

    if (!esNueva) {
      console.log('MP reenvió un pago ya procesado, no se avisa. id:', paymentId);
      return res.status(200).json({ received: true, duplicado: true });
    }

    await Promise.all([
      // En una renovación el comprador no recibe nada: ya está adentro.
      esRenovacion
        ? Promise.resolve()
        : resend.emails.send({
            from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
            reply_to: 'guidosustento.nutri@gmail.com',
            to: buyerEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text
          }),
      notificarVenta({
        product,
        buyerEmail,
        buyerName,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        paymentMethod: 'MercadoPago',
        paymentId: String(paymentId),
        recurrente: esRecurrente,
        renovacion: esRenovacion
      })
    ]);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
