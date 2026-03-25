const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// URL del PDF en Google Drive — convertida a link de descarga directa
const PDF_URL = 'https://drive.google.com/uc?export=download&id=1Et0JnzzylaCQ993iHLwrTbFH9McvRqmN';

async function getPaymentDetails(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
    }
  });
  return response.json();
}

async function sendRecetario(buyerEmail, buyerName) {
  // Descargamos el PDF para adjuntarlo
  const pdfResponse = await fetch(PDF_URL);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

  await resend.emails.send({
    from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
    to: buyerEmail,
    subject: '¡Acá está tu Recetario Digital Sustento! 🌿',
    html: `
      <div style="font-family: 'Open Sans', sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
        <div style="background: #1e6f1d; padding: 32px; text-align: center;">
          <h1 style="color: #fff; font-size: 1.4rem; margin: 0; letter-spacing: 0.05em; text-transform: uppercase;">
            Hacelo con Sustento
          </h1>
        </div>
        <div style="padding: 40px 32px; background: #f5eee0;">
          <h2 style="color: #1e6f1d; font-size: 1.5rem; margin-bottom: 16px;">
            ¡Hola ${buyerName || ''}! Tu Recetario ya es tuyo. 🌱
          </h2>
          <p style="font-size: 1rem; line-height: 1.7; color: #444; margin-bottom: 24px;">
            Gracias por tu compra. El Recetario Digital Sustento está adjunto a este mail — 
            recetas plant-based para el día a día, simples, nutritivas y con ingredientes reales.
          </p>
          <p style="font-size: 1rem; line-height: 1.7; color: #444; margin-bottom: 24px;">
            Si en algún momento tenés alguna duda o querés contarme cómo te va con las recetas, 
            me encontrás en Instagram como <strong>@guido.sustento</strong>.
          </p>
          <p style="font-size: 0.9rem; color: #888; border-top: 1px solid #ddd; padding-top: 24px; margin-top: 32px;">
            © 2026 Guido Sustento · <a href="https://www.haceloconsustento.com" style="color: #1e6f1d;">haceloconsustento.com</a>
          </p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: 'Recetario-Digital-Sustento.pdf',
        content: pdfBase64,
      }
    ]
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // MercadoPago manda distintos tipos de notificaciones
    // Solo nos interesa cuando se aprueba un pago
    if (type !== 'payment') {
      return res.status(200).json({ received: true });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'No payment ID' });
    }

    // Consultamos los detalles del pago a MP
    const payment = await getPaymentDetails(paymentId);

    // Solo procesamos pagos aprobados
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
