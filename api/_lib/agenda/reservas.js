/**
 * Orquestación de la agenda propia: reservar, reprogramar, cancelar y
 * etiquetar. El handler (api/agenda/[accion].js) solo traduce HTTP.
 *
 * Cada función devuelve { status, cuerpo } cuando el resultado es esperable
 * (validación, turno ocupado, link inválido...). Los fallos de Google tiran: el
 * handler los traduce (503 si falta conectar o configurar, 502 el resto).
 *
 * Regla de la reserva: una vez creado el evento, el turno ya es de la persona.
 * Todo lo que viene después (fila en Supabase, mails, recordatorios) va en su
 * propio try: si falla se loguea y se sigue, nunca se le devuelve error a
 * alguien cuyo turno ya quedó reservado.
 */
import crypto from 'node:crypto';
import { turnoValido, restarOcupados, fechaBA, DURACION_MIN, ZONA } from './horarios.js';
import { firmar, verificar } from './firma.js';
import { CUENTA_GUIDO, ocupado, feriados, crearEvento, leerEvento, moverEvento, actualizarPrivado, borrarEvento } from './google.js';
import { insertarReserva, actualizarReserva } from './supabase.js';
import { enviar, programar, cancelarProgramado } from './resend.js';
import * as mails from './mails.js';

const MIN_MS = 60 * 1000;
const HORA_MS = 60 * MIN_MS;
const PLAZO_CAMBIO_HS = 12;
const MARGEN_PROGRAMAR_MS = 5 * MIN_MS;

export const ORIGENES = [
  'Club Sustento', 'VBalance', 'La Cucha', 'Instagram', 'TikTok', 'Newsletter',
  'Nutrición Sin Humo', 'Me lo recomendó alguien'
];
const ALIMENTACIONES = Object.keys(mails.ALIMENTACION_TEXTO);
const COMPROMISOS = Object.keys(mails.COMPROMISO_TEXTO);

// ---------------------------------------------------------------------------
// Lógica pura (testeable sin red)
// ---------------------------------------------------------------------------

function limpiar(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Valida y normaliza el formulario. Devuelve { ok: true, datos } o
 * { ok: false, campo }. `zona` inválida no es error: se descarta.
 */
export function validarReserva(b) {
  if (!b || typeof b !== 'object') return { ok: false, campo: 'cuerpo' };

  const d = {
    inicio: limpiar(b.inicio, 40),
    // El nombre va al asunto de los mails y al título del evento: sin saltos de línea.
    nombre: limpiar(b.nombre, 120).replace(/\s+/g, ' '),
    email: limpiar(b.email, 254),
    motivo: limpiar(b.motivo, 2000),
    objetivo: limpiar(b.objetivo, 2000),
    fueANutri: limpiar(b.fueANutri, 10),
    compromiso: limpiar(b.compromiso, 20),
    whatsapp: limpiar(b.whatsapp, 40),
    origen: limpiar(b.origen, 60),
    recomendo: limpiar(b.recomendo, 120),
    alimentacion: limpiar(b.alimentacion, 30),
    utm_source: limpiar(b.utm_source, 120),
    utm_content: limpiar(b.utm_content, 120),
    zona: mails.zonaValida(b.zona) ? b.zona : ''
  };

  if (!d.inicio || Number.isNaN(new Date(d.inicio).getTime())) return { ok: false, campo: 'inicio' };
  if (!d.nombre) return { ok: false, campo: 'nombre' };
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(d.email)) return { ok: false, campo: 'email' };
  if (!d.motivo) return { ok: false, campo: 'motivo' };
  if (!d.objetivo) return { ok: false, campo: 'objetivo' };
  if (!['si', 'no'].includes(d.fueANutri)) return { ok: false, campo: 'fueANutri' };
  if (!COMPROMISOS.includes(d.compromiso)) return { ok: false, campo: 'compromiso' };
  // Para el link wa.me hacen falta dígitos: sin al menos 6 no hay a quién escribirle.
  if ((d.whatsapp.match(/\d/g) || []).length < 6) return { ok: false, campo: 'whatsapp' };
  if (!ORIGENES.includes(d.origen)) return { ok: false, campo: 'origen' };
  if (!ALIMENTACIONES.includes(d.alimentacion)) return { ok: false, campo: 'alimentacion' };

  return { ok: true, datos: d };
}

/** Descripción del evento, igual que la de Calendly: etiquetas fijas, una línea en blanco entre cada una. */
export function armarDescripcion(d) {
  const sn = v => (v === 'si' ? 'Sí' : 'No');
  const utm = [d.utm_source, d.utm_content].filter(Boolean).join(' / ');
  return [
    `¿Qué te trajo hasta acá?: ${d.motivo}`,
    `¿Qué querés lograr en los próximos 90 días?: ${d.objetivo}`,
    `¿Ya tuviste consultas con nutricionista antes?: ${sn(d.fueANutri)}`,
    `¿Estás dispuesto/a a comprometerte con un proceso de 3 meses?: ${mails.COMPROMISO_TEXTO[d.compromiso]}`,
    `¿Cómo es tu alimentación hoy?: ${mails.ALIMENTACION_TEXTO[d.alimentacion]}`,
    `WhatsApp: ${d.whatsapp}`,
    `¿Cómo llegaste hasta acá?: ${d.origen}`,
    ...(d.recomendo ? [`Si te lo recomendó alguien, ¿quién?: ${d.recomendo}`] : []),
    ...(utm ? [`Link: ${utm}`] : [])
  ].join('\n\n');
}

/**
 * Recordatorios a programar: 24 h y 1 h antes. Uno que quedaría a menos de 5
 * minutos de `ahora` (o ya pasado) no se programa: con una reserva de menos de
 * 24 h sale solo el de 1 hora.
 */
export function elegirRecordatorios(inicioISO, ahoraMs) {
  const t = new Date(inicioISO).getTime();
  return [
    { tipo: 'dia', at: new Date(t - 24 * HORA_MS) },
    { tipo: 'hora', at: new Date(t - HORA_MS) }
  ].filter(r => r.at.getTime() - ahoraMs >= MARGEN_PROGRAMAR_MS);
}

const soloDigitos = s => String(s || '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Tokens y links
// ---------------------------------------------------------------------------

const ID_EVENTO = /^[a-z0-9]{5,100}$/;

export function tokenGestionar(eventId) {
  return `${eventId}.${firmar(`gestionar:${eventId}`)}`;
}
export function tokenGuido(eventId) {
  return `${eventId}.${firmar(`guido-cancela:${eventId}`)}`;
}

/** Devuelve el eventId si el token es válido para ese prefijo, o null. */
export function eventIdDeToken(token, prefijo) {
  const t = String(token || '');
  const i = t.indexOf('.');
  if (i < 1) return null;
  const id = t.slice(0, i);
  if (!ID_EVENTO.test(id)) return null;
  return verificar(`${prefijo}${id}`, t.slice(i + 1)) ? id : null;
}

// Con fallback: armar links nunca puede romper una reserva ya creada.
function urlsSeguras(base, eventId, reservaId, wa, calendar) {
  try {
    return urlsDe(base, eventId, reservaId, wa, calendar);
  } catch (e) {
    console.error('Agenda: no se pudieron armar los links:', e.message);
    return {
      reprogramar: `${base}/agenda/`, cancelar: `${base}/agenda/`, agendar: `${base}/agenda/`,
      cancelarGuido: '', etiquetar: () => '', wa: '', calendar: calendar || ''
    };
  }
}

function urlsDe(base, eventId, reservaId, wa, calendar) {
  const t = encodeURIComponent(tokenGestionar(eventId));
  return {
    reprogramar: `${base}/agenda/gestionar/?t=${t}&accion=reprogramar`,
    cancelar: `${base}/agenda/gestionar/?t=${t}&accion=cancelar`,
    agendar: `${base}/agenda/`,
    cancelarGuido: `${base}/api/agenda/cancelar-guido?t=${encodeURIComponent(tokenGuido(eventId))}`,
    etiquetar: clave => {
      const r = encodeURIComponent(reservaId || '');
      return `${base}/api/agenda/etiquetar?r=${r}&f=${encodeURIComponent(firmar(`etiquetar:${reservaId}`))}&e=${encodeURIComponent(clave)}`;
    },
    wa: soloDigitos(wa) ? `https://wa.me/${soloDigitos(wa)}` : '',
    calendar: calendar || ''
  };
}

// ---------------------------------------------------------------------------
// Mails
// ---------------------------------------------------------------------------

const DE_PERSONA = () => `Guido Sustento <${process.env.RESEND_FROM_EMAIL}>`;
const DE_AVISO = () => `Agenda Sustento <${process.env.RESEND_FROM_EMAIL}>`;
const MAIL_GUIDO = CUENTA_GUIDO;

function paraPersona(ctx, m, extra = {}) {
  return { from: DE_PERSONA(), to: ctx.email, reply_to: MAIL_GUIDO, subject: m.subject, html: m.html, text: m.text, ...extra };
}
function paraGuido(ctx, m) {
  return { from: DE_AVISO(), to: MAIL_GUIDO, reply_to: ctx.email, subject: m.subject, html: m.html, text: m.text };
}

/** Programa los recordatorios y devuelve los ids. Cada uno en su try. */
async function programarRecordatorios(ctx, recordatorios) {
  const ids = [];
  for (const r of recordatorios) {
    try {
      const m = r.tipo === 'dia' ? mails.recordatorioDia(ctx) : mails.recordatorioHora(ctx);
      ids.push(await programar({ ...paraPersona(ctx, m), scheduledAt: r.at.toISOString() }));
    } catch (e) {
      console.error('Agenda: no se pudo programar el recordatorio:', e.message);
    }
  }
  return ids;
}

async function cancelarRecordatorios(ids) {
  for (const id of ids) await cancelarProgramado(id);
}

const idsDe = priv => String((priv && priv.recordatorios) || '').split(',').filter(Boolean);

// ---------------------------------------------------------------------------
// Contexto a partir de un evento de Google
// ---------------------------------------------------------------------------

function contextoDe(ev, base) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  const invitada = (ev.attendees || []).find(a => a.email && a.email.toLowerCase() !== CUENTA_GUIDO);
  const inicio = new Date(ev.start.dateTime).toISOString();
  const fin = new Date(ev.end.dateTime).toISOString();
  return {
    eventId: ev.id,
    reservaId: priv.reservaId || '',
    nombre: priv.nombre || '',
    email: invitada ? invitada.email : '',
    whatsapp: priv.whatsapp || '',
    zona: priv.zona || '',
    inicio,
    fin,
    meet: ev.hangoutLink || '',
    priv,
    urls: urlsSeguras(base, ev.id, priv.reservaId, priv.whatsapp, ev.htmlLink)
  };
}

/** { ctx } si el evento sigue vivo, { cancelada: true } si no existe o está cancelado. */
async function cargar(eventId, base) {
  const ev = await leerEvento(eventId);
  if (!ev || ev.status === 'cancelled' || !ev.start || !ev.start.dateTime) return { cancelada: true };
  return { ctx: contextoDe(ev, base) };
}

// ---------------------------------------------------------------------------
// Reservar
// ---------------------------------------------------------------------------

async function turnoLibre(inicioISO, finISO) {
  // Los feriados all-day se piden por el día completo de Buenos Aires.
  const dia = fechaBA(inicioISO);
  const diaDesde = new Date(`${dia}T00:00:00-03:00`);
  const diaHasta = new Date(diaDesde.getTime() + 24 * HORA_MS);
  const [busy, fer] = await Promise.all([
    ocupado(inicioISO, finISO),
    feriados(diaDesde.toISOString(), diaHasta.toISOString())
  ]);
  return restarOcupados([{ inicio: inicioISO, fin: finISO }], busy, fer).length === 1;
}

export async function reservar(entrada, { base, ahora = new Date() }) {
  const v = validarReserva(entrada);
  if (!v.ok) return { status: 400, cuerpo: { error: 'datos', campo: v.campo } };
  const d = v.datos;

  // Falla temprano (503 agenda-no-configurada) si falta AGENDA_SECRET: sin ella
  // no se pueden firmar los links, y no se quiere crear un evento sin ellos.
  firmar('prueba');

  // No se confía en lo que manda el navegador: el inicio tiene que ser un
  // turno que la agenda realmente ofrecería ahora.
  if (!turnoValido(d.inicio, ahora)) return { status: 409, cuerpo: { error: 'turno-invalido' } };
  const inicio = new Date(d.inicio).toISOString();
  const fin = new Date(new Date(inicio).getTime() + DURACION_MIN * MIN_MS).toISOString();

  if (!(await turnoLibre(inicio, fin))) return { status: 409, cuerpo: { error: 'turno-ocupado' } };

  const reservaId = crypto.randomUUID();
  // Si esto falla, tira y el handler responde 502: no se reservó nada.
  const ev = await crearEvento({
    // La medición del Método depende de este título exacto.
    summary: `${d.nombre} y Guido Sustento`,
    description: armarDescripcion(d),
    inicio,
    fin,
    email: d.email,
    requestId: reservaId,
    privado: { reservaId, nombre: d.nombre, whatsapp: d.whatsapp, zona: d.zona, recordatorios: '' }
  });

  // Desde acá nada corta la reserva: el turno ya es de la persona.
  const ctx = {
    eventId: ev.id,
    reservaId,
    nombre: d.nombre,
    email: d.email,
    whatsapp: d.whatsapp,
    zona: d.zona,
    inicio,
    fin,
    meet: ev.hangoutLink || '',
    urls: urlsSeguras(base, ev.id, reservaId, d.whatsapp, ev.htmlLink),
    fila: d
  };

  try {
    await insertarReserva({
      id: reservaId,
      fecha_turno: fechaBA(inicio),
      motivo: d.motivo,
      objetivo: d.objetivo,
      fue_a_nutri: d.fueANutri === 'si',
      compromiso: d.compromiso,
      alimentacion: d.alimentacion,
      origen: d.origen,
      utm_source: d.utm_source || null,
      utm_content: d.utm_content || null
    });
  } catch (e) {
    console.error('Agenda: no se pudo registrar la reserva:', e.message);
  }

  // Qué recordatorios salen se decide antes del mail 1, para que no prometa
  // uno que no se manda.
  const recordatorios = elegirRecordatorios(inicio, ahora.getTime());

  try {
    const ics = mails.armarIcs({ eventId: ev.id, inicio, fin, meet: ctx.meet });
    await enviar(paraPersona(ctx, mails.confirmacion(ctx, recordatorios.map(r => r.tipo)), {
      attachments: [{ filename: 'llamada-sustento.ics', content: Buffer.from(ics, 'utf8').toString('base64') }]
    }));
  } catch (e) {
    console.error('Agenda: no se pudo mandar la confirmación:', e.message);
  }

  const ids = await programarRecordatorios(ctx, recordatorios);
  if (ids.length) {
    const privado = { reservaId, nombre: d.nombre, whatsapp: d.whatsapp, zona: d.zona, recordatorios: ids.join(',') };
    try {
      await actualizarPrivado(ev.id, privado);
    } catch {
      try {
        await actualizarPrivado(ev.id, privado); // un reintento
      } catch (e) {
        // Los ids de Resend no son secretos: se loguean para poder cancelarlos a mano.
        console.error(`Agenda: no se pudieron guardar los recordatorios del evento ${ev.id}. Ids de Resend: ${ids.join(',')}.`, e.message);
      }
    }
  }

  try {
    await enviar(paraGuido(ctx, mails.avisoReserva(ctx)));
  } catch (e) {
    console.error('Agenda: no se pudo avisar a Guido de la reserva:', e.message);
  }

  return { status: 200, cuerpo: { ok: true, inicio, fin, meet: ctx.meet } };
}

// ---------------------------------------------------------------------------
// Gestionar (persona) y cancelar (Guido)
// ---------------------------------------------------------------------------

const faltanHoras = (ctx, ahora) => (new Date(ctx.inicio).getTime() - ahora.getTime()) / HORA_MS;

export async function infoGestion(token, { base, ahora = new Date() }) {
  const id = eventIdDeToken(token, 'gestionar:');
  if (!id) return { status: 403, cuerpo: { error: 'token-invalido' } };
  const r = await cargar(id, base);
  if (r.cancelada) return { status: 200, cuerpo: { estado: 'cancelada' } };
  const { ctx } = r;
  return {
    status: 200,
    cuerpo: {
      estado: 'activa',
      inicio: ctx.inicio,
      fin: ctx.fin,
      nombre: mails.primerNombre(ctx.nombre),
      puedeCambiar: faltanHoras(ctx, ahora) >= PLAZO_CAMBIO_HS
    }
  };
}

/** Borra el evento y avisa. Los pasos posteriores al borrado no cortan. */
async function cancelarComun(ctx, { motivo, avisarAGuido }) {
  await borrarEvento(ctx.eventId); // si falla tira: no se canceló nada
  await cancelarRecordatorios(idsDe(ctx.priv));
  try {
    await actualizarReserva(ctx.reservaId, { estado: 'cancelada' });
  } catch (e) {
    console.error('Agenda: no se pudo marcar la reserva cancelada:', e.message);
  }
  try {
    await enviar(paraPersona(ctx, mails.cancelacion(ctx, motivo)));
  } catch (e) {
    console.error('Agenda: no se pudo mandar la cancelación:', e.message);
  }
  if (avisarAGuido) {
    try {
      await enviar(paraGuido(ctx, mails.avisoCancelo(ctx)));
    } catch (e) {
      console.error('Agenda: no se pudo avisar a Guido de la cancelación:', e.message);
    }
  }
}

export async function gestionar({ t, accion, inicio }, { base, ahora = new Date() }) {
  const id = eventIdDeToken(t, 'gestionar:');
  if (!id) return { status: 403, cuerpo: { error: 'token-invalido' } };
  if (accion !== 'cancelar' && accion !== 'reprogramar') return { status: 400, cuerpo: { error: 'datos', campo: 'accion' } };

  const r = await cargar(id, base);
  if (r.cancelada) return { status: 409, cuerpo: { error: 'cancelada' } };
  const { ctx } = r;
  if (faltanHoras(ctx, ahora) < PLAZO_CAMBIO_HS) return { status: 409, cuerpo: { error: 'fuera-de-plazo' } };

  if (accion === 'cancelar') {
    await cancelarComun(ctx, { motivo: '', avisarAGuido: true });
    return { status: 200, cuerpo: { ok: true } };
  }

  // Reprogramar: el nuevo horario pasa por las mismas reglas que una reserva.
  const nuevoMs = new Date(String(inicio || '')).getTime();
  if (Number.isNaN(nuevoMs)) return { status: 400, cuerpo: { error: 'datos', campo: 'inicio' } };
  const nuevoInicio = new Date(nuevoMs).toISOString();
  if (nuevoInicio === ctx.inicio) return { status: 409, cuerpo: { error: 'mismo-turno' } };
  if (!turnoValido(nuevoInicio, ahora)) return { status: 409, cuerpo: { error: 'turno-invalido' } };
  const nuevoFin = new Date(nuevoMs + DURACION_MIN * MIN_MS).toISOString();
  // El propio evento figura ocupado en su horario viejo; no molesta porque el nuevo es otro turno.
  if (!(await turnoLibre(nuevoInicio, nuevoFin))) return { status: 409, cuerpo: { error: 'turno-ocupado' } };

  const antes = ctx.inicio;
  await moverEvento(ctx.eventId, nuevoInicio, nuevoFin); // si falla tira: no se movió nada

  const nuevo = { ...ctx, inicio: nuevoInicio, fin: nuevoFin };
  await cancelarRecordatorios(idsDe(ctx.priv));
  const ids = await programarRecordatorios(nuevo, elegirRecordatorios(nuevoInicio, ahora.getTime()));
  const privadoNuevo = { ...ctx.priv, recordatorios: ids.join(',') };
  try {
    await actualizarPrivado(ctx.eventId, privadoNuevo);
  } catch {
    try {
      await actualizarPrivado(ctx.eventId, privadoNuevo); // un reintento
    } catch (e) {
      console.error(`Agenda: no se pudieron guardar los recordatorios del evento ${ctx.eventId}. Ids de Resend: ${ids.join(',')}.`, e.message);
    }
  }
  try {
    await actualizarReserva(ctx.reservaId, { estado: 'reprogramada', fecha_turno: fechaBA(nuevoInicio) });
  } catch (e) {
    console.error('Agenda: no se pudo marcar la reserva reprogramada:', e.message);
  }
  try {
    await enviar(paraPersona(nuevo, mails.reprogramacion(nuevo, antes)));
  } catch (e) {
    console.error('Agenda: no se pudo mandar la reprogramación:', e.message);
  }
  try {
    await enviar(paraGuido(nuevo, mails.avisoCambio(nuevo, antes)));
  } catch (e) {
    console.error('Agenda: no se pudo avisar a Guido del cambio:', e.message);
  }
  return { status: 200, cuerpo: { ok: true, inicio: nuevoInicio, fin: nuevoFin } };
}

/** Para la página de Guido. { estado: 'invalido' | 'cancelada' | 'activa', nombre, inicio } */
export async function infoCancelarGuido(token, { base }) {
  const id = eventIdDeToken(token, 'guido-cancela:');
  if (!id) return { estado: 'invalido' };
  const r = await cargar(id, base);
  if (r.cancelada) return { estado: 'cancelada' };
  return { estado: 'activa', nombre: r.ctx.nombre, inicio: r.ctx.inicio };
}

/** Cancela Guido: sin el límite de 12 h, sin mail 7, y el mail 5 suma el motivo si lo escribió. */
export async function cancelarPorGuido(token, motivo, { base }) {
  const id = eventIdDeToken(token, 'guido-cancela:');
  if (!id) return { estado: 'invalido' };
  const r = await cargar(id, base);
  if (r.cancelada) return { estado: 'cancelada' };
  await cancelarComun(r.ctx, { motivo: limpiar(motivo, 500), avisarAGuido: false });
  return { estado: 'ok', nombre: r.ctx.nombre };
}

// ---------------------------------------------------------------------------
// Etiquetar
// ---------------------------------------------------------------------------

export const CLAVES_ETIQUETA = mails.ETIQUETAS.map(e => e.clave);

export function firmaEtiquetar(reservaId, f) {
  return verificar(`etiquetar:${reservaId}`, f);
}

/** Guarda hasta 2 etiquetas válidas y la nota. Tira si la reserva no existe. */
export async function guardarEtiquetas(reservaId, claves, nota) {
  await actualizarReserva(reservaId, {
    etiquetas: claves,
    etiqueta_nota: limpiar(nota, 2000) || null
  });
}
