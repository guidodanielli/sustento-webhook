import { Resend } from 'resend';
import { PRODUCTS } from './products.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const ALLOWED_ORIGINS = [
  'https://www.haceloconsustento.com',
  'https://haceloconsustento.com'
];

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getPayPalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

async function logPurchase({ productId, productName, buyerEmail, buyerName, amount, currency, paymentId }) {
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
        payment_method: 'paypal',
        payment_id: paymentId,
        status: 'approved'
      })
    });
  } catch (err) {
    console.error('Supabase log error:', err);
  }
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
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderID, productId = 'recetario' } = req.body || {};
  if (!orderID) return res.status(400).json({ error: 'No orderID' });

  const product = PRODUCTS[productId] || PRODUCTS['recetario'];

  try {
    const token = await getPayPalToken();

    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const capture = await captureRes.json();

    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Pago no completado', status: capture.status });
    }

    const payer = capture.payer;
    const buyerEmail = payer?.email_address;
    const buyerName = payer?.name?.given_name;
    const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const amount = parseFloat(captureUnit?.amount?.value || product.usd);

    await Promise.all([
      resend.emails.send({
        from: `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`,
        to: buyerEmail,
        subject: `¡Acá está tu ${product.name}! 🌿`,
        html: buildEmail({ buyerName, product })
      }),
      logPurchase({
        productId: product.id,
        productName: product.name,
        buyerEmail,
        buyerName,
        amount,
        currency: 'USD',
        paymentId: orderID
      })
    ]);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('PayPal capture error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
