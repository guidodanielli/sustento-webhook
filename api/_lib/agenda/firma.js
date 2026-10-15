import crypto from 'node:crypto';

/**
 * Firma HMAC-SHA256 para los links y el `state` de la agenda.
 * Si falta AGENDA_SECRET tira error: firmar con clave vacía daría firmas que
 * cualquiera puede fabricar.
 */
function secreto() {
  const s = process.env.AGENDA_SECRET;
  if (!s) {
    // Mismo código que las variables de Google: el handler lo traduce a 503.
    const e = new Error('Falta la variable de entorno AGENDA_SECRET');
    e.codigo = 'falta-config';
    e.variable = 'AGENDA_SECRET';
    throw e;
  }
  return s;
}

export function firmar(texto) {
  return crypto.createHmac('sha256', secreto()).update(String(texto)).digest('base64url');
}

export function verificar(texto, firma) {
  if (typeof firma !== 'string') return false;
  const esperada = Buffer.from(firmar(texto));
  const recibida = Buffer.from(firma);
  // timingSafeEqual tira si los largos difieren: se descarta antes.
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}
