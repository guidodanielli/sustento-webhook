import { PRODUCTS } from './_lib/products.js';
import { construirReferencia } from './_lib/referencia-externa.js';

const ALLOWED_ORIGINS = [
  'https://www.haceloconsustento.com',
  'https://haceloconsustento.com'
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productId = 'recetario' } = req.body || {};
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ error: 'Producto inválido' });

  // Se arma antes del pedido para poder dejarla en el log: es el hilo que ata
  // este checkout con el pago que MercadoPago notifica después.
  const referencia = construirReferencia(product.id);

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [{
          id: product.id,
          title: product.name,
          // La ve el comprador en el checkout de MercadoPago, así sabe qué está
          // pagando. Sale de products.js, que ya la tenía escrita sin usar.
          description: product.description,
          quantity: 1,
          unit_price: product.ars,
          currency_id: 'ARS'
        }],
        back_urls: {
          success: 'https://www.haceloconsustento.com?pago=ok',
          failure: 'https://www.haceloconsustento.com?pago=error',
          pending: 'https://www.haceloconsustento.com?pago=pendiente'
        },
        auto_return: 'approved',
        // Único por transacción, como pide MercadoPago, pero arrancando con el
        // id del producto, que es lo que `webhook.js` lee para saber qué se
        // compró. El formato y su lectura viven juntos en referencia-externa.js:
        // no cambiar uno solo de los dos.
        external_reference: referencia,
        notification_url: 'https://sustento-webhook.vercel.app/api/webhook'
      })
    });

    const data = await response.json();

    if (data.init_point) {
      console.log(`MP preferencia creada: ${referencia}`);
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
