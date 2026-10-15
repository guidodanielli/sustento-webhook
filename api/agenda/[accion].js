/**
 * Única función de la agenda propia: Vercel la expone como /api/agenda/<accion>
 * y la acción llega en req.query.accion. Una sola función porque el plan Hobby
 * limita a 12 y ya hay 9.
 *
 * Acciones: horarios, google-conectar, google-callback, reservar, gestionar,
 * cancelar-guido y etiquetar. La lógica de reservas vive en _lib/agenda/reservas.js;
 * acá solo se traduce HTTP.
 */
import { generarTurnos, restarOcupados, ZONA, MAX_DIAS } from '../_lib/agenda/horarios.js';
import { firmar, verificar } from '../_lib/agenda/firma.js';
import * as reservas from '../_lib/agenda/reservas.js';
import { ETIQUETAS, fechaCorta, hora } from '../_lib/agenda/mails.js';
import { leerReserva } from '../_lib/agenda/supabase.js';
import { urlConsentimiento, conectarConCodigo, ocupado, feriados, CUENTA_GUIDO } from '../_lib/agenda/google.js';

const STATE_MAX_MS = 15 * 60 * 1000;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pagina(res, status, titulo, mensaje, { izquierda = false } = {}) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f1e7;color:#2b2b2b;font-family:Arial,Helvetica,sans-serif;text-align:center}
main{max-width:480px;padding:24px 16px${izquierda ? ';text-align:left' : ''}}
label{display:block;margin:8px 0;font-size:16px}
textarea,input[type=text]{width:100%;box-sizing:border-box;font:inherit;padding:8px;margin:6px 0 12px}
button{background:#1e6f1d;color:#fff;border:0;border-radius:100px;padding:14px 30px;font:600 16px Arial,sans-serif;cursor:pointer}
.aviso{color:#a12a1b;font-weight:bold}
h1{font-size:22px;margin:0 0 12px;text-align:center}
.m,p{font-size:17px;line-height:1.5;margin:0}
</style></head><body><main><h1>${esc(titulo)}</h1><div class="m">${mensaje}</div></main></body></html>`);
}

const LINK_CONEXION = '<a href="/api/agenda/google-conectar">link de conexión</a>';

const MENSAJES_ERROR = {
  'otra-cuenta': `Elegiste otra cuenta de Google. Repetí el proceso y elegí <b>${esc(CUENTA_GUIDO)}</b>. Volvé a abrir el ${LINK_CONEXION}.`,
  'faltan-permisos': `Faltó dar algún permiso. Repetí el proceso y tildá <b>todas</b> las casillas. Volvé a abrir el ${LINK_CONEXION}.`
};

async function horarios(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ahora = new Date();
    const hasta = new Date(ahora.getTime() + (MAX_DIAS + 1) * 24 * 3600 * 1000).toISOString();
    const desde = ahora.toISOString();
    const [busy, fer] = await Promise.all([ocupado(desde, hasta), feriados(desde, hasta)]);
    const turnos = restarOcupados(generarTurnos(ahora), busy, fer);
    return res.status(200).json({ zona: ZONA, turnos });
  } catch (e) {
    if (e.codigo === 'no-conectada') return res.status(503).json({ error: 'agenda-no-conectada' });
    if (e.codigo === 'falta-config') {
      console.error('Agenda horarios:', e.message);
      return res.status(503).json({ error: 'agenda-no-configurada' });
    }
    console.error('Agenda horarios:', e);
    return res.status(502).json({ error: 'google' });
  }
}

// Falta una variable de entorno: se le explica a Guido qué cargar y dónde.
function paginaFaltaConfig(res, e) {
  const nombre = e.variable || 'AGENDA_SECRET';
  return pagina(res, 500, 'Falta una configuración', `Falta cargar <b>${esc(nombre)}</b> en Vercel → Settings → Environment Variables. Cargala y volvé a deployar.`);
}

// firmar/verificar tiran si falta AGENDA_SECRET.
function variableDe(e) {
  if (e.codigo === 'falta-config') return e;
  if (/AGENDA_SECRET/.test(e.message || '')) { const x = new Error(e.message); x.codigo = 'falta-config'; x.variable = 'AGENDA_SECRET'; return x; }
  return null;
}

function googleConectar(req, res) {
  try {
    const redirectUri = `https://${req.headers.host}/api/agenda/google-callback`;
    const ts = String(Date.now());
    const state = `${ts}.${firmar(ts)}`;
    const url = urlConsentimiento({ redirectUri, state });
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, url);
  } catch (e) {
    const f = variableDe(e);
    if (f) return paginaFaltaConfig(res, f);
    console.error('Agenda google-conectar:', e.message);
    return pagina(res, 500, 'No se pudo iniciar', `Algo salió mal. Volvé a abrir el ${LINK_CONEXION}.`);
  }
}

async function googleCallback(req, res) {
  const { code, state, error: errGoogle } = req.query;

  if (errGoogle) {
    return pagina(res, 400, 'No se conectó', `Google avisó: <b>${esc(errGoogle)}</b>. Si cancelaste sin querer, volvé a abrir el ${LINK_CONEXION}.`);
  }

  try {
    const [ts, firma] = String(state || '').split('.');
    const edad = Date.now() - Number(ts);
    if (!ts || !firma || !verificar(ts, firma) || !(edad >= 0 && edad < STATE_MAX_MS)) {
      return pagina(res, 400, 'El link venció', `Pasaron más de 15 minutos o el link no es válido. Volvé a abrir el ${LINK_CONEXION} y repetí el proceso.`);
    }
    if (!code) {
      return pagina(res, 400, 'No se conectó', `Google no mandó el código. Volvé a abrir el ${LINK_CONEXION}.`);
    }
    const redirectUri = `https://${req.headers.host}/api/agenda/google-callback`;
    const email = await conectarConCodigo({ code: String(code), redirectUri });
    return pagina(res, 200, 'Agenda conectada', `Listo: la agenda quedó conectada con <b>${esc(email)}</b>. Ya podés cerrar esta pestaña.`);
  } catch (e) {
    const f = variableDe(e);
    if (f) return paginaFaltaConfig(res, f);
    console.error('Agenda google-callback:', e.codigo || '', e.message);
    const msg = MENSAJES_ERROR[e.codigo] || `Algo salió mal al conectar. Volvé a abrir el ${LINK_CONEXION} y repetí el proceso.`;
    return pagina(res, 400, 'No se conectó', msg);
  }
}

// ---------------------------------------------------------------------------
// Helpers de HTTP
// ---------------------------------------------------------------------------

// Reservar espera hasta 3 s por el Meet, más Resend y Supabase: el tope por defecto de Hobby se queda corto.
export const config = { maxDuration: 30 };

const baseDe = req => `https://${req.headers.host}`;

// Vercel parsea JSON y formularios solos, pero si el content-type no coincide el
// body llega como string: se cubren los dos casos.
function cuerpoJson(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b || '{}'); } catch { return {}; }
  }
  // Un array, un número o null no sirven como cuerpo: se trata como vacío.
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

function cuerpoForm(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const out = {};
  for (const [k, v] of new URLSearchParams(String(b || ''))) {
    out[k] = k in out ? [].concat(out[k], v) : v;
  }
  return out;
}

const valor = v => (Array.isArray(v) ? v[0] : v);

// Traduce un error de Google/config a la respuesta JSON de la API.
function errorJson(res, e, donde) {
  if (e.codigo === 'no-conectada') return res.status(503).json({ error: 'agenda-no-conectada' });
  // El evento desapareció entre que se leyó y se modificó.
  if (e.codigo === 'cancelada') return res.status(409).json({ error: 'cancelada' });
  if (e.codigo === 'falta-config') {
    console.error(`Agenda ${donde}:`, e.message);
    return res.status(503).json({ error: 'agenda-no-configurada' });
  }
  console.error(`Agenda ${donde}:`, e);
  return res.status(502).json({ error: 'google' });
}

// Lo mismo, pero para las páginas que ve Guido.
function errorPagina(res, e, donde) {
  const f = variableDe(e);
  if (f) return paginaFaltaConfig(res, f);
  console.error(`Agenda ${donde}:`, e);
  if (e.codigo === 'no-conectada') {
    return pagina(res, 503, 'Agenda sin conectar', `La agenda perdió la conexión con Google. Abrí el ${LINK_CONEXION} y repetí el proceso.`);
  }
  return pagina(res, 502, 'Algo salió mal', 'No se pudo hablar con Google. Probá de nuevo en unos minutos.');
}

// ---------------------------------------------------------------------------
// reservar y gestionar (JSON)
// ---------------------------------------------------------------------------

async function reservar(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = cuerpoJson(req);
  // Honeypot: un bot rellena el campo escondido. Se le contesta que sí y no se hace nada.
  if (body && body.sitio) return res.status(200).json({ ok: true });
  try {
    const r = await reservas.reservar(body, { base: baseDe(req) });
    return res.status(r.status).json(r.cuerpo);
  } catch (e) {
    return errorJson(res, e, 'reservar');
  }
}

async function gestionarGet(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const r = await reservas.infoGestion(String(req.query.t || ''), { base: baseDe(req) });
    return res.status(r.status).json(r.cuerpo);
  } catch (e) {
    return errorJson(res, e, 'gestionar');
  }
}

async function gestionarPost(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const b = cuerpoJson(req);
  try {
    const r = await reservas.gestionar(
      { t: String(b.t || ''), accion: b.accion, inicio: b.inicio },
      { base: baseDe(req) }
    );
    return res.status(r.status).json(r.cuerpo);
  } catch (e) {
    return errorJson(res, e, 'gestionar');
  }
}

// ---------------------------------------------------------------------------
// cancelar-guido (página para Guido)
// ---------------------------------------------------------------------------

const linkInvalido = res => pagina(res, 403, 'Link inválido', 'Este link no es válido. Usá el botón del mail de aviso de la reserva.');

async function cancelarGuido(req, res) {
  const t = String(req.query.t || '');
  const base = baseDe(req);
  try {
    if (req.method === 'POST') {
      const motivo = valor(cuerpoForm(req).motivo);
      const r = await reservas.cancelarPorGuido(t, motivo, { base });
      if (r.estado === 'invalido') return linkInvalido(res);
      if (r.estado === 'cancelada') return pagina(res, 200, 'Ya estaba cancelada', 'Esa llamada ya estaba cancelada. No hay nada más que hacer.');
      return pagina(res, 200, 'Listo', `Listo: la llamada quedó cancelada y le avisamos a ${esc(r.nombre)}.`);
    }
    const info = await reservas.infoCancelarGuido(t, { base });
    if (info.estado === 'invalido') return linkInvalido(res);
    if (info.estado === 'cancelada') return pagina(res, 200, 'Ya estaba cancelada', 'Esa llamada ya estaba cancelada. No hay nada más que hacer.');
    return pagina(res, 200, 'Cancelar la llamada', `
      Cancelar la llamada con <b>${esc(info.nombre)}</b>, ${esc(fechaCorta(info.inicio))} ${esc(hora(info.inicio))}
      <form method="post" action="/api/agenda/cancelar-guido?t=${encodeURIComponent(t)}" style="margin-top:20px;text-align:left">
        <label for="motivo">Motivo (lo ve la persona)</label>
        <textarea id="motivo" name="motivo" rows="3" maxlength="500"></textarea>
        <div style="text-align:center"><button type="submit">Cancelar la llamada</button></div>
      </form>`);
  } catch (e) {
    return errorPagina(res, e, 'cancelar-guido');
  }
}

// ---------------------------------------------------------------------------
// etiquetar (página para Guido)
// ---------------------------------------------------------------------------

function paginaEtiquetar(res, { r, f, marcadas, nota, aviso }) {
  const casillas = ETIQUETAS.map(e => `
    <label><input type="checkbox" name="e" value="${esc(e.clave)}"${marcadas.includes(e.clave) ? ' checked' : ''}> ${esc(e.texto)}</label>`).join('');
  return pagina(res, aviso ? 400 : 200, 'Etiquetar el caso', `
    ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
    <form method="post" action="/api/agenda/etiquetar">
      <input type="hidden" name="r" value="${esc(r)}">
      <input type="hidden" name="f" value="${esc(f)}">
      ${casillas}
      <label for="nota">Nota (para "otro")</label>
      <textarea id="nota" name="nota" rows="3" maxlength="2000">${esc(nota || '')}</textarea>
      <div style="text-align:center"><button type="submit">Guardar</button></div>
    </form>`, { izquierda: true });
}

async function etiquetar(req, res) {
  try {
    if (req.method === 'POST') {
      const b = cuerpoForm(req);
      const r = String(valor(b.r) || '');
      const f = String(valor(b.f) || '');
      if (!reservas.firmaEtiquetar(r, f)) return linkInvalido(res);
      const elegidas = [].concat(b.e || []).filter(c => reservas.CLAVES_ETIQUETA.includes(c));
      const unicas = [...new Set(elegidas)];
      const nota = String(valor(b.nota) || '');
      if (unicas.length > 2) {
        return paginaEtiquetar(res, { r, f, marcadas: unicas, nota, aviso: 'Elegí hasta 2.' });
      }
      try {
        await reservas.guardarEtiquetas(r, unicas, nota);
      } catch (e) {
        console.error('Agenda etiquetar:', e.message);
        if (e.codigo === 'no-existe') {
          return pagina(res, 404, 'No se guardó', 'No se encontró esa reserva en la base.');
        }
        return pagina(res, 502, 'No se guardó', 'No se pudo guardar, probá de nuevo en un rato.');
      }
      return pagina(res, 200, 'Guardado', 'Guardado.');
    }

    // GET: solo muestra el formulario. NO guarda: los antivirus de mail abren
    // todos los links y marcarían las 8 etiquetas solos.
    const r = String(req.query.r || '');
    const f = String(req.query.f || '');
    if (!reservas.firmaEtiquetar(r, f)) return linkInvalido(res);
    const fila = await leerReservaSegura(r);
    const e = String(req.query.e || '');
    const marcadas = [...new Set([...(fila.etiquetas || []), ...(reservas.CLAVES_ETIQUETA.includes(e) ? [e] : [])])];
    return paginaEtiquetar(res, { r, f, marcadas, nota: fila.etiqueta_nota });
  } catch (e) {
    return errorPagina(res, e, 'etiquetar');
  }
}

// Si Supabase falla al leer, la página igual se muestra (sin lo ya marcado).
async function leerReservaSegura(id) {
  try {
    return (await leerReserva(id)) || {};
  } catch (e) {
    console.error('Agenda etiquetar:', e.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Métodos permitidos por acción: cualquier otro da 405.
const ACCIONES = {
  'horarios': { GET: horarios },
  'google-conectar': { GET: googleConectar },
  'google-callback': { GET: googleCallback },
  'reservar': { POST: reservar },
  'gestionar': { GET: gestionarGet, POST: gestionarPost },
  'cancelar-guido': { GET: cancelarGuido, POST: cancelarGuido },
  'etiquetar': { GET: etiquetar, POST: etiquetar }
};

export default async function handler(req, res) {
  const permitidos = Object.hasOwn(ACCIONES, req.query.accion) ? ACCIONES[req.query.accion] : null;
  if (!permitidos) return res.status(404).json({ error: 'accion-desconocida' });
  const fn = permitidos[req.method];
  if (!fn) {
    res.setHeader('Allow', Object.keys(permitidos).join(', '));
    return res.status(405).json({ error: 'metodo-no-permitido' });
  }
  return fn(req, res);
}
