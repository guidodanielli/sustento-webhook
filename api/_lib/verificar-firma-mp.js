import crypto from 'node:crypto';

/**
 * Verifica la firma de una notificación de MercadoPago.
 *
 * MP firma así: manda el header `x-signature` con dos campos separados por
 * coma, `ts` (el momento en que firmó) y `v1` (el hash). Con esos datos se
 * arma un texto, el "manifest", y se le calcula HMAC-SHA256 usando la clave
 * secreta del webhook. Si el resultado coincide con `v1`, la notificación
 * salió de MercadoPago y nadie la tocó en el camino.
 *
 * El manifest es literal, con los puntos y comas incluidos:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * ⚠️ EL PUNTO DELICADO: las notificaciones viejas de MercadoPago (el formato
 * IPN, el que usa `topic` en vez de `type`) NO traen firma. Son legítimas
 * igual. Por eso esta función distingue "firma inválida" de "sin firma": la
 * primera es un intento de falsificación y la segunda es MercadoPago hablando
 * en su formato viejo. Rechazar las dos por igual rompería ventas que hoy
 * funcionan, que es justo lo que no puede pasar acá.
 */

const ESTADOS = {
  OK: 'ok',
  INVALIDA: 'invalida',
  SIN_FIRMA: 'sin-firma',
  SIN_SECRET: 'sin-secret',
  SIN_DATOS: 'sin-datos'
};

/**
 * El id del recurso, que es la primera parte del manifest.
 *
 * MercadoPago pide tomarlo del query param `data.id` de la URL a la que
 * notifica, no del cuerpo, y pasarlo a minúsculas cuando es alfanumérico.
 */
function extraerDataId(req) {
  const query = req.query || {};
  const valor = query['data.id'] ?? query.id ?? req.body?.data?.id;
  if (valor === undefined || valor === null || valor === '') return null;

  const texto = String(valor);
  return /^[a-zA-Z0-9]+$/.test(texto) ? texto.toLowerCase() : texto;
}

// "ts=1704908010,v1=618c8534..." → { ts: '1704908010', v1: '618c8534...' }
function parsearHeaderDeFirma(header) {
  const campos = {};

  for (const trozo of String(header).split(',')) {
    const corte = trozo.indexOf('=');
    if (corte === -1) continue;
    campos[trozo.slice(0, corte).trim()] = trozo.slice(corte + 1).trim();
  }

  return { ts: campos.ts, v1: campos.v1 };
}

// Comparación en tiempo constante. Con `===` el tiempo que tarda en fallar
// filtra cuántos caracteres acertó quien esté probando.
function sonIguales(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function construirManifest({ dataId, requestId, ts }) {
  // Los tramos que no tienen valor no se incluyen, ni siquiera vacíos.
  return [
    dataId ? `id:${dataId};` : '',
    requestId ? `request-id:${requestId};` : '',
    ts ? `ts:${ts};` : ''
  ].join('');
}

export function verificarFirmaMP(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    return { estado: ESTADOS.SIN_SECRET, detalle: 'MP_WEBHOOK_SECRET no está configurada' };
  }

  const header = req.headers?.['x-signature'];
  if (!header) {
    return { estado: ESTADOS.SIN_FIRMA, detalle: 'la notificación no trae x-signature' };
  }

  const { ts, v1 } = parsearHeaderDeFirma(header);
  if (!ts || !v1) {
    return { estado: ESTADOS.SIN_DATOS, detalle: `x-signature sin ts o sin v1: ${header}` };
  }

  const dataId = extraerDataId(req);
  const requestId = req.headers?.['x-request-id'];
  const manifest = construirManifest({ dataId, requestId, ts });

  const calculado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  if (!sonIguales(calculado, v1)) {
    return {
      estado: ESTADOS.INVALIDA,
      // El manifest va al log porque es lo único que permite entender por qué
      // no coincidió: casi siempre es un tramo de más o de menos, no la clave.
      detalle: `no coincide. manifest="${manifest}"`
    };
  }

  return { estado: ESTADOS.OK, detalle: 'firma válida' };
}

export { ESTADOS };
