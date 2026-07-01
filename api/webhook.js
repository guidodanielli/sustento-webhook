import { Resend } from 'resend';
import { PRODUCTS } from './products.js';

const resend = new Resend(process.env.RESEND_API_KEY);

async function getPaymentDetails(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  return response.json();
}

async function logPurchase({ productId, productName, buyerEmail, buyerName, amount, currency, paymentMethod, paymentId }) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        product_id: productId,
        product_name: productName,
        buyer_email: buyerEmail,
        buyer_name: buyerName || null,
        amount,
        currency,
        payment_method: paymentMethod,
        payment_id: paymentId,
        status: 'approved'
      })
    });
  } catch (err) {
    // No cortar la entrega del producto si falla el log
    console.error('Supabase log error:', err);
  }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    if (type !== 'payment') {
      return res.status(200).json({ received: true });
    }

    const paymentId = data?.id;
    if (!paymentId) return res.status(400).json({ error: 'No payment ID' });

    const payment = await getPaymentDetails(paymentId);

    if (payment.status !== 'approved') {
      return res.status(200).json({ status: payment.status });
    }

    const buyerEmail = payment.payer?.email;
    const buyerName = payment.payer?.first_name;
    const productId = payment.external_reference || 'recetario';
    const product = PRODUCTS[productId] || PRODUCTS['recetario'];

    if (!buyerEmail) return res.status(400).json({ error: 'No buyer email' });

    // El Club es una suscripción (sin archivo para descargar): mail de bienvenida.
    // El resto son productos digitales descargables: mail con el link.
    const esDescargable = Boolean(product.driveUrl);
    const emailContent = esDescargable
      ? { subject: `¡Acá está tu ${product.name}! 🌿`, html: buildEmail({ buyerName, product }) }
      : { subject: `¡Bienvenido/a al Club Sustento! 🌿`, html: buildClubEmail({ buyerName }) };

    await Promise.all([
      resend.emails.send({
        from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
        to: buyerEmail,
        subject: emailContent.subject,
        html: emailContent.html
      }),
      logPurchase({
        productId: product.id,
        productName: product.name,
        buyerEmail,
        buyerName,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        paymentMethod: 'mercadopago',
        paymentId: String(paymentId)
      })
    ]);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
