import crypto from 'node:crypto';
import { PRODUCTS } from './products.js';

/**
 * El `external_reference` que viaja a MercadoPago.
 *
 * MercadoPago pide, en su evaluación de calidad de integración, que este campo
 * sea "un código único" por transacción, para poder correlacionar su
 * `payment_id` con el id interno del sistema. Pero `webhook.js` lo lee para
 * saber qué producto se compró: hasta el 08/09/2026 el campo era el id del
 * producto pelado (`club`, `recetario`) y nada más, así que hacerle caso a
 * MercadoPago sin más habría hecho que toda compra se registrara como
 * "recetario", las del Club incluidas.
 *
 * Las dos cosas entran juntas si el código único ARRANCA con el id del
 * producto:
 *
 *     club-1788874335520-a3f9c1
 *     └┬─┘ └──────┬────┘ └──┬─┘
 *      │          │         └── azar, para que dos compras del mismo
 *      │          │             milisegundo no compartan referencia
 *      │          └──────────── cuándo se creó la preferencia
 *      └─────────────────────── qué se compró, que es lo que lee el webhook
 *
 * Armar y leer viven en el mismo archivo a propósito: son las dos mitades de
 * un mismo formato, y tenerlas en archivos distintos es justo lo que las deja
 * desincronizarse.
 */

export function construirReferencia(productId) {
  return `${productId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * El id del producto que hay adentro de una referencia.
 *
 * 🔴 Se prueba contra los ids que EXISTEN, del más largo al más corto, en vez
 * de cortar en el primer guion. Cortar funciona hoy porque los dos ids son
 * `recetario` y `club`, pero un id con guion adentro (`mini-recetario`) daría
 * `mini`, y esa compra se registraría como otro producto sin que nada avise.
 *
 * 🔴 Tolera las referencias VIEJAS a propósito: hasta el 08/09/2026 el campo
 * era el id pelado, sin sufijo. MercadoPago reintenta notificaciones durante
 * días, así que un pago con el formato viejo todavía puede llegar.
 *
 * Devuelve `null` cuando no reconoce nada, que es lo que deja al que llama
 * decidir el producto por defecto, igual que antes de este cambio.
 */
export function productoDeReferencia(referencia) {
  if (!referencia) return null;

  const texto = String(referencia);
  const ids = Object.keys(PRODUCTS).sort((a, b) => b.length - a.length);

  return ids.find((id) => texto === id || texto.startsWith(`${id}-`)) || null;
}
