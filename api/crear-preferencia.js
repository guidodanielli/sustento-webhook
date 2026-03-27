export default async function handler(req, res) {
  // Permitir CORS para ambas versiones del dominio
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://www.haceloconsustento.com',
    'https://haceloconsustento.com'
  ];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [{
          title: 'Recetario Digital Sustento',
          quantity: 1,
          unit_price: 40000,
          currency_id: 'ARS'
        }],
        back_urls: {
          success: 'https://www.haceloconsustento.com?pago=ok',
          failure: 'https://www.haceloconsustento.com?pago=error',
          pending: 'https://www.haceloconsustento.com?pago=pendiente'
        },
        auto_return: 'approved',
        notification_url: 'https://sustento-webhook.vercel.app/api/webhook'
      })
    });

    const data = await response.json();

    if (data.init_point) {
      return res.status(200).json({ init_point: data.init_point });
    } else {
      console.error('MP error:', data);
      return res.status(500).json({ error: 'No se pudo crear la preferencia' });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
