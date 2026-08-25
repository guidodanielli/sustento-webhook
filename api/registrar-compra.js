/**
 * Deja registrada una compra aprobada en la tabla `purchases` de Supabase.
 *
 * Lo usan los tres caminos de cobro: el webhook de MercadoPago (pagos únicos y
 * suscripciones del Club), la captura de PayPal y el webhook de Whop.
 *
 * Devuelve { ok, esNueva }. `esNueva` es false cuando ese payment_id ya estaba
 * registrado, o sea cuando la pasarela reenvía la notificación de un pago que ya
 * procesamos. MercadoPago lo hace: el 24/08/2026 reenvió la notificación de un
 * pago del 06/08 y Guido recibió un aviso de venta por algo de 18 días antes.
 * Quien llama tiene que usar ese flag para no avisar ni entregar dos veces.
 *
 * Nunca tira error hacia afuera: si Supabase falla, la entrega del producto al
 * comprador tiene que seguir su curso igual. Solo queda el log en Vercel. En ese
 * caso devuelve esNueva=true, que es el lado seguro: entregar de más molesta
 * menos que no entregar.
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
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/purchases?on_conflict=payment_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        // on_conflict=payment_id + ignore-duplicates: si ese pago ya existe la
        // respuesta vuelve vacía en vez de tirar 409, y así distinguimos un pago
        // nuevo de una notificación reenviada. Sin el on_conflict de la URL,
        // PostgREST mira la clave primaria (id) y el duplicado igual explota.
        'Prefer': 'resolution=ignore-duplicates,return=representation'
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
      const detalle = await response.text();
      console.error('Supabase log error:', response.status, detalle);
      // 409 es choque de unicidad: el pago ya estaba. No es un fallo, es un
      // duplicado, y hay que tratarlo como tal aunque el on_conflict falle.
      const duplicado = response.status === 409 || detalle.includes('23505');
      return { ok: false, esNueva: !duplicado };
    }

    // Array con la fila insertada si es un pago nuevo; vacío si era duplicado.
    const filas = await response.json().catch(() => []);
    const esNueva = Array.isArray(filas) && filas.length > 0;
    if (!esNueva) {
      console.log('Pago duplicado ignorado, payment_id:', paymentId);
    }
    return { ok: true, esNueva };
  } catch (err) {
    console.error('Supabase log error:', err);
    return { ok: false, esNueva: true };
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
