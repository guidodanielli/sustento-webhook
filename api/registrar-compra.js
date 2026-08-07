/**
 * Deja registrada una compra aprobada en la tabla `purchases` de Supabase.
 *
 * Lo usan los tres caminos de cobro: el webhook de MercadoPago (pagos únicos y
 * suscripciones del Club), la captura de PayPal y el webhook de Whop.
 *
 * Nunca tira error hacia afuera: si Supabase falla, la entrega del producto al
 * comprador tiene que seguir su curso igual. Solo queda el log en Vercel.
 */
export async function registrarCompra({
  productId,
  productName,
  buyerEmail,
  buyerName,
  amount,
  currency,
  paymentMethod,
  paymentId
}) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/purchases`, {
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

    // Supabase devuelve 4xx con el detalle en el body: sin esto el error es invisible.
    if (!response.ok) {
      console.error('Supabase log error:', response.status, await response.text());
    }
  } catch (err) {
    console.error('Supabase log error:', err);
  }
}

/**
 * ¿Esta persona ya compró este producto antes?
 *
 * Sirve para distinguir el alta de una suscripción de sus renovaciones, que es
 * la única forma de no mandarle el mail de bienvenida al Club todos los meses:
 * ni MercadoPago ni Whop exponen un campo confiable para eso.
 *
 * Ante cualquier falla devuelve `false` (lo trata como alta). Es el lado seguro
 * del error: mandar una bienvenida de más molesta menos que no mandar ninguna.
 */
export async function yaCompro({ buyerEmail, productId }) {
  if (!buyerEmail) return false;

  try {
    const query = new URLSearchParams({
      buyer_email: `eq.${buyerEmail}`,
      product_id: `eq.${productId}`,
      select: 'id',
      limit: '1'
    });

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/purchases?${query}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (!response.ok) return false;

    const filas = await response.json();
    return Array.isArray(filas) && filas.length > 0;
  } catch (err) {
    console.error('Supabase yaCompro error:', err);
    return false;
  }
}
