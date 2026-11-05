import { Resend } from 'resend';
import { PRODUCTS, productoDelPlan } from './_lib/products.js';
import { notificarVenta, notificarCobroSinProducto, notificarBaja } from './_lib/notificar-venta.js';
import { buscarAlta } from './_lib/altas.js';
import { registrarCompra, yaCompro } from './_lib/registrar-compra.js';
import { linkDeDescarga, HORAS_DE_VIDA } from './_lib/entrega.js';
import { verificarFirmaMP, ESTADOS } from './_lib/verificar-firma-mp.js';
import { productoDeReferencia } from './_lib/referencia-externa.js';

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

/**
 * Trae una suscripción (el "preapproval"). Es lo único que dice de qué plan
 * es un cobro recurrente: ni la factura ni el pago traen el plan.
 */
async function getPreapproval(preapprovalId) {
  const response = await fetch(
    `https://api.mercadopago.com/preapproval/${preapprovalId}`,
    { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
  );
  return response.json();
}

// Los ids de suscripción de MercadoPago son alfanuméricos (no solo números,
// como los de pago). Mismo motivo que SOLO_NUMEROS: van pegados a la URL.
const ID_SUSCRIPCION = /^[A-Za-z0-9]{8,64}$/;

/**
 * El producto recurrente de un cobro, según el plan de su suscripción.
 *
 * Hasta el 05/11/2026 todo cobro recurrente se asumía del Club, porque era el
 * único plan. La Red también cobra por un plan de MercadoPago, así que sus
 * cuotas se habrían anunciado como Club. Si no se puede saber el plan (MP no
 * responde, o la suscripción no tiene plan), decide el monto, y si tampoco
 * coincide, se cae al Club como antes.
 */
async function productoRecurrente(preapprovalId, monto) {
  if (preapprovalId && ID_SUSCRIPCION.test(String(preapprovalId))) {
    try {
      const suscripcion = await getPreapproval(preapprovalId);
      const porPlan = productoDelPlan(suscripcion?.preapproval_plan_id);
      if (porPlan) return porPlan;
    } catch (err) {
      console.error('No se pudo leer la suscripción', preapprovalId, err);
    }
  }
  // Sin plan legible, el monto es la mejor pista: $10.000 es la Red y
  // $15.000 el Club. Si los precios cambian, actualizar products.js.
  const porMonto = Object.values(PRODUCTS).find((p) => p.recurring && p.mpPlanId && Number(p.ars) === Number(monto));
  return porMonto || PRODUCTS.club;
}

/**
 * Una suscripción cambió de estado. Solo interesa la cancelación: el alta y
 * las cuotas las cuenta el evento de pago, igual que en Whop.
 */
async function procesarCambioDeSuscripcion(req, res) {
  const query = req.query || {};
  const id = req.body?.data?.id || query['data.id'] || query.id;
  if (!id || !ID_SUSCRIPCION.test(String(id))) {
    return res.status(200).json({ received: true, warning: 'suscripción sin id' });
  }

  const suscripcion = await getPreapproval(id);
  if (suscripcion?.status !== 'cancelled') {
    return res.status(200).json({ received: true, status: suscripcion?.status || null });
  }

  const product = productoDelPlan(suscripcion.preapproval_plan_id) || PRODUCTS.club;
  const buyerEmail = suscripcion.payer_email || null;
  const alta = await buscarAlta({ email: buyerEmail, producto: product.id });

  await notificarBaja({
    buyerEmail,
    buyerName: alta?.nombre || null,
    motivo: `Cancelada en Mercado Pago (suscripción ${id})${alta?.whatsapp ? ` · WhatsApp ${alta.whatsapp}` : ''}`,
    plataforma: 'Mercado Pago',
    product
  });
  return res.status(200).json({ received: true, baja: true });
}

function buildClubEmail({ buyerName, product = PRODUCTS.club }) {
  const esRed = product.id === 'red';
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 48px 40px; background: #f5eee0;">
        <h2 style="font-family: Georgia, serif; color: #1e6f1d; font-size: 1.5rem; margin-bottom: 16px;">
          ¡Hola${buyerName ? ' ' + buyerName : ''}! Bienvenido/a ${esRed ? 'a Red Sustento' : 'al Club Sustento'} 🌿
        </h2>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          Gracias por sumarte. Tu pago de este mes ya está confirmado y desde ahora sos parte ${esRed ? 'de la Red' : 'del Club'}.
        </p>
        <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
          ${esRed ? 'En las próximas horas te escribo por WhatsApp para sumarte al grupo y pasarte la fecha del próximo encuentro.' : 'En las próximas horas te voy a escribir para darte acceso al espacio con las recetas, los seminarios y la comunidad.'} Si tenés cualquier duda, respondé este mail o escribime a Instagram como <strong>@guido.sustento</strong>.
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
function textoDescarga({ buyerName, product, link }) {
  return [
    `Hola${buyerName ? ' ' + buyerName : ''}! Tu ${product.name} ya es tuyo.`,
    'Gracias por tu compra. Este es el link para descargarlo:',
    link.url,
    link.expira
      ? `El link vale por ${HORAS_DE_VIDA} horas, asi que bajate el archivo y guardalo en tu compu. Si se te vencio, respondeme este mail y te mando uno nuevo.`
      : null,
    'Si tenés alguna duda, me encontrás en Instagram como @guido.sustento.',
    'Que lo disfrutes!',
    'Guido'
  ].filter(Boolean).join('\n\n');
}

function textoClub({ buyerName, product = PRODUCTS.club }) {
  const esRed = product.id === 'red';
  return [
    `Hola${buyerName ? ' ' + buyerName : ''}! Ya estás adentro ${esRed ? 'de Red Sustento' : 'del Club Sustento'}.`,
    esRed
      ? 'En las próximas horas te escribo por WhatsApp para sumarte al grupo y pasarte la fecha del próximo encuentro.'
      : 'En las próximas horas te escribo para darte el acceso al espacio de la comunidad.',
    'Si tenés alguna duda, respondé este mail. Lo leo yo.',
    'Guido'
  ].join('\n\n');
}

function buildEmail({ buyerName, product, link }) {
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
          <a href="${link.url}" style="background: #1e6f1d; color: #ffffff; padding: 16px 36px; border-radius: 100px; text-decoration: none; font-family: Arial, sans-serif; font-weight: 600; font-size: 1rem; display: inline-block;">
            📥 Descargar ${product.name}
          </a>
        </div>
        ${link.expira ? `<p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin-bottom: 20px; text-align: center;">
          El link vale por ${HORAS_DE_VIDA} horas, así que bajate el archivo y guardalo en tu compu. Si se te venció, respondeme este mail y te mando uno nuevo.
        </p>` : ''}
        <p style="font-size: 0.88rem; color: #888; margin-bottom: 20px; text-align: center;">
          Si el botón no funciona, copiá este link:<br>
          <a href="${link.url}" style="color: #1e6f1d;">${link.url}</a>
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

// Los ids de pago y de factura de MercadoPago son solo números. Se exige eso
// porque el id va pegado a la URL de la API de MP con el token de Guido: un id
// inventado como "../otra-cosa" haría que el webhook consulte otro endpoint.
const SOLO_NUMEROS = /^\d+$/;

function extraerEventId(req) {
  const query = req.query || {};
  const directo = req.body?.data?.id || query['data.id'] || query.id;
  if (directo) return SOLO_NUMEROS.test(String(directo)) ? String(directo) : null;

  const resource = req.body?.resource;
  if (!resource) return null;

  // "https://api.mercadopago.com/v1/payments/123" y "123" tienen que dar 123.
  const ultimo = String(resource).split('?')[0].split('/').filter(Boolean).pop();
  return SOLO_NUMEROS.test(ultimo || '') ? ultimo : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // La firma se mira antes que nada: si alguien está inventando
  // notificaciones, no vale la pena ni consultarle el pago a MercadoPago.
  //
  // MP_FIRMA_ESTRICTA arranca apagada a propósito. Con la variable apagada
  // esto solo deja el resultado en el log y las ventas siguen su curso pase lo
  // que pase; recién cuando el log muestre "firma: ok" en un cobro real
  // conviene prenderla, y ahí sí una firma inválida corta la notificación.
  // Es la única forma de no deployar a ciegas un cambio que puede romper
  // ventas que hoy funcionan.
  const firma = verificarFirmaMP(req);
  const modoEstricto = process.env.MP_FIRMA_ESTRICTA === 'true';

  if (firma.estado === ESTADOS.INVALIDA) {
    console.error(
      `MP firma INVÁLIDA: ${firma.detalle}.`,
      modoEstricto ? 'Modo estricto: se rechaza.' : 'Modo observación: se procesa igual.'
    );
    if (modoEstricto) {
      return res.status(401).json({ error: 'Firma inválida' });
    }
  } else {
    // Las notificaciones viejas (IPN) no traen firma y son legítimas: quedan
    // como `sin-firma`, no como error.
    console.log(`MP firma: ${firma.estado} (${firma.detalle}).`);
  }

  try {
    const type = extraerTipo(req);
    const esSuscripcion = type === 'subscription_authorized_payment';

    if (type === 'subscription_preapproval') {
      return await procesarCambioDeSuscripcion(req, res);
    }

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

      if (!paymentId || !SOLO_NUMEROS.test(String(paymentId))) {
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

    // Un cobro recurrente es del Club o de la Red: se decide por el plan de su
    // suscripción (ver productoRecurrente). Se mira el pago además del tipo de
    // evento porque MP también manda las cuotas como un `payment` común, y esas
    // cuotas (links de plan) no traen nuestro external_reference.
    const preapprovalId = facturaSuscripcion?.preapproval_id || payment.metadata?.preapproval_id || null;
    const esCobroRecurrente = esSuscripcion
      || payment.operation_type === 'recurring_payment'
      || Boolean(preapprovalId);
    const productId = esCobroRecurrente
      ? (await productoRecurrente(preapprovalId, payment.transaction_amount)).id
      : productoDeReferencia(payment.external_reference);

    if (!buyerEmail) {
      console.error('MP sin payer.email. paymentId:', paymentId, 'pago:', JSON.stringify(payment));
      return res.status(400).json({ error: 'No buyer email' });
    }

    // Un cobro sin referencia reconocible no salió del checkout de la web: es
    // un link de pago, una transferencia o un cobro del Método. Hasta el
    // 23/10/2026 caía en "recetario" y la persona recibía un Recetario que no
    // compró. Se registra igual (así un reenvío de MP no vuelve a avisar) y
    // se le avisa a Guido, sin mandarle nada a quien pagó.
    if (!productId || !PRODUCTS[productId]) {
      const { esNueva } = await registrarCompra({
        productId: 'mercadopago-otro',
        productName: payment.description || 'Cobro por MercadoPago fuera de la web',
        buyerEmail,
        buyerName,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        paymentMethod: 'mercadopago',
        paymentId: String(paymentId)
      });

      if (esNueva) {
        await notificarCobroSinProducto({
          buyerEmail,
          buyerName,
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          descripcion: payment.description,
          paymentId: String(paymentId)
        });
      }
      return res.status(200).json({ received: true, sinProducto: true });
    }

    const product = PRODUCTS[productId];

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

    // Se firma recién acá, con la venta ya confirmada, para que las 24hs del
    // link empiecen a correr cuando el mail sale y no antes.
    const link = esDescargable ? await linkDeDescarga(product) : null;

    const emailContent = esDescargable
      ? { subject: `¡Acá está tu ${product.name}! 🌿`, html: buildEmail({ buyerName, product, link }), text: textoDescarga({ buyerName, product, link }) }
      : { subject: product.id === 'red' ? '¡Bienvenido/a a Red Sustento! 🌿' : '¡Bienvenido/a al Club Sustento! 🌿', html: buildClubEmail({ buyerName, product }), text: textoClub({ buyerName, product }) };

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

    // El mail al comprador sale primero y el aviso a Guido después, porque el
    // aviso tiene que decir si la entrega salió. La compra ya quedó registrada,
    // así que si Resend falla MercadoPago no va a reintentar: sin esto, la
    // persona pagó, no recibió nada y nadie se enteraba.
    // Resend no tira error: lo devuelve en `error`. Por eso se miran las dos cosas.
    let entregaFallida = false;
    // En una renovación el comprador no recibe nada: ya está adentro.
    if (!esRenovacion) {
      try {
        const { error } = await resend.emails.send({
          from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
          reply_to: 'guidosustento.nutri@gmail.com',
          to: buyerEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text
        });
        if (error) throw new Error(JSON.stringify(error));
      } catch (err) {
        entregaFallida = true;
        console.error('No salió el mail al comprador. paymentId:', paymentId, err);
      }
    }

    // El WhatsApp que dejó en /suscribirme/, para que Guido lo sume sin
    // pedirle el comprobante. En una renovación no hace falta.
    const contacto = esRecurrente && !esRenovacion
      ? await buscarAlta({ email: buyerEmail, producto: product.id })
      : null;

    await notificarVenta({
      product,
      contacto,
      buyerEmail,
      buyerName,
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      paymentMethod: 'MercadoPago',
      paymentId: String(paymentId),
      recurrente: esRecurrente,
      renovacion: esRenovacion,
      entregaFallida,
      linkEntrega: link?.url || null
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
