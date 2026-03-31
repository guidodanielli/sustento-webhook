const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Link de descarga directa del Recetario en Google Drive
const PDF_LINK = 'https://drive.google.com/file/d/1Et0JnzzylaCQ993iHLwrTbFH9McvRqmN/view?usp=sharing';

async function getPaymentDetails(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
    }
  });
  return response.json();
}

async function sendRecetario(buyerEmail, buyerName) {
  await resend.emails.send({
    from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
    to: buyerEmail,
    subject: '¡Acá está tu Recetario Digital Sustento! 🌿',
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">

        <div style="background: #1e6f1d; padding: 28px 40px;">
          <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
        </div>

        <div style="padding: 48px 40px; background: #f5eee0;">
          <h2 style="font-family: Georgia, serif; color: #1e6f1d; font-size: 1.5rem; margin-bottom: 16px;">
            ¡Hola${buyerName ? ' ' + buyerName : ''}! Tu Recetario ya es tuyo. 🌱
          </h2>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
            Gracias por tu compra. Acá abajo encontrás el link para descargar tu Recetario Digital Sustento — más de 60 recetas plant-based para el día a día.
          </p>

          <div style="text-align: center; margin: 36px 0;">
            <a href="${PDF_LINK}" style="
              background: #1e6f1d; color: #ffffff;
              padding: 16px 36px; border-radius: 100px;
              text-decoration: none; font-family: Arial, sans-serif;
              font-weight: 600; font-size: 1rem;
              display: inline-block;
            ">
              📥 Descargar Recetario
            </a>
          </div>

          <p style="font-size: 0.88rem; color: #888; margin-bottom: 20px; text-align: center;">
            Si el botón no funciona, copiá este link: <a href="${PDF_LINK}" style="color: #1e6f1d;">${PDF_LINK}</a>
          </p>

          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">
            Si tenés alguna duda o querés contarme cómo te va con las recetas, me encontrás en Instagram como <strong>@guido.sustento</strong>.
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
    `
  });
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
    if (!paymentId) {
      return res.status(400).json({ error: 'No payment ID' });
    }

    const payment = await getPaymentDetails(paymentId);

    if (payment.status !== 'approved') {
      return res.status(200).json({ status: payment.status });
    }

    const buyerEmail = payment.payer?.email;
    const buyerName = payment.payer?.first_name;

    if (!buyerEmail) {
      return res.status(400).json({ error: 'No buyer email' });
    }

    await sendRecetario(buyerEmail, buyerName);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
