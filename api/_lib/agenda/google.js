/**
 * Conexión con Google Calendar de Guido, con fetch directo (sin googleapis).
 *
 * El refresh token vive en la tabla `agenda_config` de Supabase, no en una
 * variable de entorno, para poder renovarlo desde la página de conexión sin
 * redeploy.
 */

export const CUENTA_GUIDO = 'guidosustento.nutri@gmail.com';
export const CALENDARIO = 'primary';
export const CALENDARIO_FERIADOS = 'es.ar#holiday@group.v.calendar.google.com';

const ZONA = 'America/Argentina/Buenos_Aires';
const SCOPE_EVENTOS = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';
const SCOPES = `openid email ${SCOPE_EVENTOS} ${SCOPE_FREEBUSY}`;
const DIA_MS = 24 * 3600 * 1000;
const CLAVE_REFRESH = 'google_refresh_token';

function error(codigo, mensaje) {
  const e = new Error(mensaje || codigo);
  e.codigo = codigo;
  return e;
}

// Para logs: solo status y los campos de error conocidos. Nunca el cuerpo
// completo: PostgREST puede devolver "Failing row contains" con el refresh
// token adentro, y los cuerpos de Google pueden traer tokens.
export function resumenError(datos) {
  const d = datos && typeof datos === 'object' ? datos : {};
  return JSON.stringify({ code: d.code, message: d.message, error: d.error, error_description: d.error_description });
}

function exigirVariable(nombre) {
  if (!process.env[nombre]) {
    const e = error('falta-config', `Falta la variable de entorno ${nombre}`);
    e.variable = nombre;
    throw e;
  }
}

function headersSupabase(extra = {}) {
  return {
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    ...extra
  };
}

async function guardarRefreshToken(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agenda_config?on_conflict=clave`, {
    method: 'POST',
    headers: headersSupabase({
      'Content-Type': 'application/json',
      // merge-duplicates + actualizado_en explícito: así pisa el valor viejo.
      'Prefer': 'resolution=merge-duplicates'
    }),
    body: JSON.stringify({ clave: CLAVE_REFRESH, valor: token, actualizado_en: new Date().toISOString() })
  });
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}));
    throw error('supabase', `No se pudo guardar el refresh token: ${r.status} ${resumenError(datos)}`);
  }
}

async function leerRefreshToken() {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/agenda_config?clave=eq.${CLAVE_REFRESH}&select=valor`,
    { headers: headersSupabase() }
  );
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}));
    throw error('supabase', `No se pudo leer el refresh token: ${r.status} ${resumenError(datos)}`);
  }
  const filas = await r.json();
  return filas[0]?.valor || null;
}

export function urlConsentimiento({ redirectUri, state }) {
  exigirVariable('GOOGLE_CLIENT_ID');
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    // prompt=consent fuerza que Google entregue refresh_token aunque ya se haya
    // autorizado antes.
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// El id_token llega directo de Google por TLS en respuesta a nuestro pedido
// con client_secret, así que no hace falta verificar la firma del JWT: solo
// leemos el payload.
function payloadJWT(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export async function conectarConCodigo({ code, redirectUri }) {
  exigirVariable('GOOGLE_CLIENT_ID');
  exigirVariable('GOOGLE_CLIENT_SECRET');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw error('canje', `Google rechazó el código: ${r.status} ${resumenError(datos)}`);

  const info = payloadJWT(datos.id_token || '');
  if (info.email !== CUENTA_GUIDO || info.email_verified !== true) {
    // No se loguea el email ajeno.
    throw error('otra-cuenta', 'La cuenta elegida no es la de Guido');
  }

  // Google deja destildar permisos en la pantalla de consentimiento.
  const concedidos = String(datos.scope || '').split(' ');
  if (!concedidos.includes(SCOPE_EVENTOS) || !concedidos.includes(SCOPE_FREEBUSY)) {
    throw error('faltan-permisos', `Scopes concedidos: ${datos.scope}`);
  }

  if (!datos.refresh_token) throw error('sin-refresh', 'Google no devolvió refresh_token');

  await guardarRefreshToken(datos.refresh_token);
  accesoCache = null;
  return info.email;
}

let accesoCache = null; // { token, vence (ms) }
let accesoEnCurso = null; // promesa compartida si hay un refresh en vuelo

export function accessToken() {
  if (accesoCache && Date.now() < accesoCache.vence - 60 * 1000) return Promise.resolve(accesoCache.token);
  // Si dos pedidos llegan con la caché vacía, comparten el mismo refresh en
  // vez de pegarle dos veces a Google. Si falla, se limpia para reintentar.
  if (!accesoEnCurso) {
    accesoEnCurso = renovarAccessToken().finally(() => { accesoEnCurso = null; });
  }
  return accesoEnCurso;
}

async function renovarAccessToken() {
  exigirVariable('GOOGLE_CLIENT_ID');
  exigirVariable('GOOGLE_CLIENT_SECRET');
  const refresh = await leerRefreshToken();
  if (!refresh) throw error('no-conectada', 'No hay refresh token guardado');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    })
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    // invalid_grant: Guido revocó el permiso (o el token venció). Hay que reconectar.
    if (datos.error === 'invalid_grant') {
      accesoCache = null;
      throw error('no-conectada', 'Google devolvió invalid_grant');
    }
    throw error('google', `No se pudo renovar el token: ${r.status} ${resumenError(datos)}`);
  }
  accesoCache = { token: datos.access_token, vence: Date.now() + (datos.expires_in || 3600) * 1000 };
  return accesoCache.token;
}

/** Intervalos ocupados del calendario principal: [{start, end}] (ISO). */
export async function ocupado(desdeISO, hastaISO) {
  const token = await accessToken();
  const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: desdeISO,
      timeMax: hastaISO,
      timeZone: ZONA,
      items: [{ id: CALENDARIO }]
    })
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw error('google', `freeBusy falló: ${r.status} ${resumenError(datos?.error || datos)}`);

  const cal = datos.calendars?.[CALENDARIO];
  // Si Google no pudo leer el calendario, NO devolver vacío: un vacío
  // ofrecería horarios ocupados.
  if (!cal || cal.errors?.length) {
    throw error('google', `freeBusy con errores: ${JSON.stringify((cal?.errors || []).map(x => x.reason))}`);
  }
  return cal.busy || [];
}

/**
 * Feriados nacionales como Set de 'YYYY-MM-DD'. Solo cuentan los eventos con
 * description que empieza con "Día festivo"; los "Celebración" (Día de la
 * Madre, etc.) no son feriados y no bloquean.
 * Si el pedido falla, se loguea y se devuelve un Set vacío: es mejor ofrecer
 * un feriado que tumbar toda la agenda por un dato accesorio.
 */
export async function feriados(desdeISO, hastaISO) {
  try {
    const token = await accessToken();
    const p = new URLSearchParams({ singleEvents: 'true', timeMin: desdeISO, timeMax: hastaISO });
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARIO_FERIADOS)}/events?${p}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!r.ok) throw new Error(`status ${r.status}`);
    const datos = await r.json();
    const set = new Set();
    for (const ev of datos.items || []) {
      if (!String(ev.description || '').startsWith('Día festivo') || !ev.start?.date) continue;
      // Un feriado all-day puede durar varios días: end.date es exclusivo.
      set.add(ev.start.date);
      const fin = ev.end?.date || ev.start.date;
      for (let t = Date.parse(`${ev.start.date}T00:00:00Z`) + DIA_MS; new Date(t).toISOString().slice(0, 10) < fin; t += DIA_MS) {
        set.add(new Date(t).toISOString().slice(0, 10));
      }
    }
    return set;
  } catch (e) {
    console.error('Agenda: no se pudieron leer los feriados:', e.message);
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Eventos del calendario principal (reservas)
// ---------------------------------------------------------------------------

const URL_EVENTOS = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARIO)}/events`;

async function pedirEvento(metodo, id, { query, cuerpo } = {}) {
  const token = await accessToken();
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const r = await fetch(`${URL_EVENTOS}${id ? `/${encodeURIComponent(id)}` : ''}${qs}`, {
    method: metodo,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const datos = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = error('google', `Calendar ${metodo} falló: ${r.status} ${resumenError(datos?.error || datos)}`);
    e.status = r.status;
    throw e;
  }
  return datos;
}

const espera = ms => new Promise(ok => setTimeout(ok, ms));

/**
 * Crea el evento con Meet. Con sendUpdates=none Google no manda su propio mail
 * (los mails los mandamos nosotros). La persona va de invitada para entrar al
 * Meet sin esperar que Guido la admita. Si el Meet queda pendiente de
 * creación, se relee el evento hasta 3 veces.
 */
export async function crearEvento({ summary, description, inicio, fin, email, requestId, privado }) {
  let ev = await pedirEvento('POST', null, {
    query: { conferenceDataVersion: '1', sendUpdates: 'none' },
    cuerpo: {
      summary,
      description,
      start: { dateTime: inicio, timeZone: ZONA },
      end: { dateTime: fin, timeZone: ZONA },
      attendees: [{ email }],
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      extendedProperties: { private: privado }
    }
  });
  for (let i = 0; i < 3 && !ev.hangoutLink; i++) {
    await espera(1000);
    // Una vez creado el evento, nada puede devolver error a la persona: si la
    // relectura falla, nos quedamos con el evento ya creado.
    try {
      ev = await pedirEvento('GET', ev.id);
    } catch (e) {
      console.error('Agenda: no se pudo releer el evento para el Meet:', e.message);
      break;
    }
  }
  return ev;
}

/** Devuelve el evento, o null si no existe (404/410). Un borrado puede venir con status 'cancelled'. */
export async function leerEvento(id) {
  try {
    return await pedirEvento('GET', id);
  } catch (e) {
    if (e.status === 404 || e.status === 410) return null;
    throw e;
  }
}

// Si el evento ya no existe (404/410) se marca con código `cancelada`, para que
// quien llama pueda decirle a la persona que ese turno ya no está.
async function modificar(id, opciones) {
  try {
    return await pedirEvento('PATCH', id, opciones);
  } catch (e) {
    if (e.status === 404 || e.status === 410) {
      const c = error('cancelada', 'El evento ya no existe');
      c.status = e.status;
      throw c;
    }
    throw e;
  }
}

export function moverEvento(id, inicio, fin) {
  return modificar(id, {
    query: { sendUpdates: 'none' },
    cuerpo: { start: { dateTime: inicio, timeZone: ZONA }, end: { dateTime: fin, timeZone: ZONA } }
  });
}

/** Pisa el mapa `private` completo (hay que mandar todas las claves, no solo la que cambia). */
export function actualizarPrivado(id, privado) {
  return modificar(id, { cuerpo: { extendedProperties: { private: privado } } });
}

/** Borra el evento sin avisar. Si ya no existe no es un error. */
export async function borrarEvento(id) {
  try {
    await pedirEvento('DELETE', id, { query: { sendUpdates: 'none' } });
  } catch (e) {
    if (e.status === 404 || e.status === 410) return;
    throw e;
  }
}
