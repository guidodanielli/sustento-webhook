/**
 * Arma asunto + html + text de cada mail de la agenda (siempre los dos
 * formatos). Los textos son los aprobados por Guido en
 * BORRADOR-mails-agenda.md (versión 2): no reescribir el copy.
 *
 * Son mails transaccionales: sin link de baja ni List-Unsubscribe. Los que van
 * a la persona no llevan firma personal ni "Nos vemos" (estilo Calendly).
 * Todo dato que escribió la persona se escapa antes de entrar al HTML.
 *
 * Todo es puro (sin red): se prueba con node o JavaScriptCore.
 */
import { ZONA, fechaBA } from './horarios.js';

export const EVENTO = 'Llamada de diagnóstico — Método Sustento';
const SITIO = 'https://haceloconsustento.com';

export const ALIMENTACION_TEXTO = {
  'carne': 'Incluyo carne y otros productos animales',
  'reduciendo': 'Estoy reduciendo los productos animales',
  'vegetariana': 'Vegetariana',
  'vegana': 'Vegana',
  'quiere-empezar': 'Quiero empezar a comer a base de plantas'
};

export const ETIQUETAS = [
  { clave: 'analisis-alterados', texto: 'análisis alterados' },
  { clave: 'relacion-comida', texto: 'relación con la comida' },
  { clave: 'habitos-organizacion', texto: 'hábitos y organización' },
  { clave: 'entrenamiento', texto: 'entrenamiento' },
  { clave: 'digestivo', texto: 'digestivo' },
  { clave: 'composicion-corporal', texto: 'composición corporal' },
  { clave: 'transicion-plantas', texto: 'transición a comer a base de plantas' },
  { clave: 'otro', texto: 'otro' }
];

export const COMPROMISO_TEXTO = { 'si': 'Sí', 'no': 'No', 'entender-mas': 'Quiero entender más' };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

function partes(iso, zona, opciones) {
  const p = new Intl.DateTimeFormat('es-AR', { timeZone: zona, ...opciones }).formatToParts(new Date(iso));
  return Object.fromEntries(p.map(x => [x.type, x.value]));
}

/** IANA válida (la manda el navegador de la persona: no se confía). */
export function zonaValida(zona) {
  if (typeof zona !== 'string' || !zona || zona.length > 64) return false;
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** "martes 21 de octubre de 2026" (o sin año). */
export function fechaLarga(iso, zona = ZONA, conAnio = true) {
  const p = partes(iso, zona, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${p.weekday} ${p.day} de ${p.month}${conAnio ? ` de ${p.year}` : ''}`;
}

/** "martes 21/10", o "mar 21/10" con corto=true. */
export function fechaCorta(iso, zona = ZONA, corto = false) {
  const p = partes(iso, zona, { weekday: corto ? 'short' : 'long', day: 'numeric', month: 'numeric' });
  return `${p.weekday.replace(/\.$/, '')} ${p.day}/${p.month}`;
}

/** "9:00" */
export function hora(iso, zona = ZONA) {
  const p = partes(iso, zona, { hour: 'numeric', minute: '2-digit', hour12: false });
  return `${Number(p.hour) % 24}:${p.minute}`;
}

/**
 * "9:00 a 9:30 (hora de Argentina)" y, si la persona está en otra hora, suma
 * " · 14:00 a 14:30 en tu hora" (con el día si cambia).
 */
export function rango(inicio, fin, zonaPersona) {
  let s = `${hora(inicio)} a ${hora(fin)} (hora de Argentina)`;
  if (zonaValida(zonaPersona) && zonaPersona !== ZONA) {
    const difiereHora = hora(inicio, zonaPersona) !== hora(inicio);
    const difiereDia = fechaCorta(inicio, zonaPersona) !== fechaCorta(inicio);
    if (difiereHora || difiereDia) {
      const dia = difiereDia ? `${fechaCorta(inicio, zonaPersona, true)} ` : '';
      s += ` · ${dia}${hora(inicio, zonaPersona)} a ${hora(fin, zonaPersona)} en tu hora`;
    }
  }
  return s;
}

function fechaYHora(ctx, conAnio = true) {
  return `${fechaLarga(ctx.inicio, ZONA, conAnio)}, ${rango(ctx.inicio, ctx.fin, ctx.zona)}`;
}

/**
 * "hoy a las 21:00" / "mañana a las 5:30": hasta cuándo se puede cambiar, medido
 * desde que sale el recordatorio del día anterior (inicio − 24 h). El límite es
 * inicio − 12 h; cae "hoy" si es el mismo día de Buenos Aires que el envío.
 */
export function limiteDeCambio(inicioISO) {
  const t = new Date(inicioISO).getTime();
  const envio = new Date(t - 24 * 3600 * 1000);
  const limite = new Date(t - 12 * 3600 * 1000);
  const dia = fechaBA(envio) === fechaBA(limite) ? 'hoy' : 'mañana';
  return `${dia} a las ${hora(limite.toISOString())}`;
}

export function primerNombre(nombre) {
  return String(nombre).trim().split(/\s+/)[0] || '';
}

// ---------------------------------------------------------------------------
// Render (html + text a partir de bloques)
// ---------------------------------------------------------------------------

const P = 'font-size: 1rem; line-height: 1.8; color: #444; margin: 0 0 18px 0;';

// Valor de una fila: texto o { texto, url }.
function valorHtml(v) {
  return typeof v === 'object' ? `<a href="${esc(v.url)}" style="color: #1e6f1d;">${esc(v.texto)}</a>` : esc(v);
}
function valorTexto(v) {
  return typeof v === 'object' ? `${v.texto} (${v.url})` : v;
}

function boton(texto, url) {
  return `<a href="${esc(url)}" style="background: #1e6f1d; color: #ffffff; border: 2px solid #1e6f1d; padding: 14px 30px; border-radius: 100px; text-decoration: none; font-family: Arial, sans-serif; font-weight: 600; font-size: 0.95rem; display: inline-block;">${esc(texto)}</a>`;
}

/**
 * Bloques:
 *  { p }                      párrafo
 *  { datos: [[k, v, {tachado}]] }  líneas "k: v" (v texto o {texto,url})
 *  { boton: [texto, url] }
 *  { links: { intro, items: [[texto, url]], pie } }
 *  { linea: [prefijo, v] }     una línea "prefijo valor" (v texto o {texto,url})
 *  { campo: [k, v] }          pregunta en negrita y respuesta larga
 *  { hr: true }
 */
function renderizar(bloques) {
  const html = [];
  const text = [];
  for (const b of bloques) {
    if (b.p !== undefined) {
      html.push(`<p style="${P}">${esc(b.p)}</p>`);
      text.push(b.p);
    } else if (b.datos) {
      html.push(`<p style="${P}">${b.datos.map(([k, v, o]) => {
        const linea = `<strong>${esc(k)}:</strong> ${valorHtml(v)}`;
        return o && o.tachado ? `<s>${linea}</s>` : linea;
      }).join('<br>')}</p>`);
      text.push(b.datos.map(([k, v]) => `${k}: ${valorTexto(v)}`).join('\n'));
    } else if (b.boton) {
      html.push(`<div style="margin: 8px 0 24px 0;">${boton(b.boton[0], b.boton[1])}</div>`);
      text.push(`${b.boton[0]}: ${b.boton[1]}`);
    } else if (b.links) {
      const { intro, items, pie } = b.links;
      html.push(`<p style="${P}">${intro ? `${esc(intro)}<br>` : ''}${items.map(([t, u]) => `<a href="${esc(u)}" style="color: #1e6f1d;">${esc(t)}</a>`).join(' · ')}${pie ? `<br>${esc(pie)}` : ''}</p>`);
      text.push([...(intro ? [intro] : []), ...items.map(([t, u]) => `${t}: ${u}`), ...(pie ? [pie] : [])].join('\n'));
    } else if (b.linea) {
      html.push(`<p style="${P}">${esc(b.linea[0])} ${valorHtml(b.linea[1])}</p>`);
      text.push(`${b.linea[0]} ${valorTexto(b.linea[1])}`);
    } else if (b.campo) {
      html.push(`<p style="${P}"><strong>${esc(b.campo[0])}</strong><br>${esc(b.campo[1]).replace(/\n/g, '<br>')}</p>`);
      text.push(`${b.campo[0]}\n${b.campo[1]}`);
    } else if (b.hr) {
      html.push('<hr style="border: 0; border-top: 1px solid #d9cfba; margin: 24px 0;">');
      text.push('---');
    }
  }
  return {
    html: `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111; background: #f5eee0;">
      <div style="background: #1e6f1d; padding: 28px 40px;">
        <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
      </div>
      <div style="padding: 40px; background: #f5eee0;">
        ${html.join('\n        ')}
      </div>
      <div style="background: #111; padding: 20px 40px;">
        <p style="font-size: 0.75rem; color: rgba(255,255,255,0.3); margin: 0; text-align: center; line-height: 1.7;">
          © 2026 Guido Sustento · <a href="${SITIO}" style="color: rgba(255,255,255,0.4);">haceloconsustento.com</a>
        </p>
      </div>
    </div>
  `,
    text: text.join('\n\n')
  };
}

function mail(asunto, bloques) {
  return { subject: asunto, ...renderizar(bloques) };
}

const bloqueMeet = ctx => (ctx.meet ? [{ boton: ['Entrar al Meet', ctx.meet] }] : []);

const bloqueCambios = (ctx, intro, pie = 'Podés hacerlo hasta 12 horas antes.') => ({
  links: { intro, items: [['Reprogramar', ctx.urls.reprogramar], ['Cancelar', ctx.urls.cancelar]], pie }
});

// ---------------------------------------------------------------------------
// Mails a la persona (1 a 5)
// ---------------------------------------------------------------------------

/** ctx: { nombre, inicio, fin, zona, meet, urls: { reprogramar, cancelar, agendar } } */

/**
 * `recordatorios`: tipos que realmente se van a programar ('dia', 'hora'). Así
 * el mail no promete uno que no sale (reserva con menos de 24 h). Si no se pasa,
 * se asumen los dos.
 */
export function confirmacion(ctx, recordatorios = ['dia', 'hora']) {
  const dia = recordatorios.includes('dia');
  const hora1 = recordatorios.includes('hora');
  const lineaRecordatorios = dia && hora1
    ? [{ p: 'Te vamos a mandar un recordatorio el día anterior y otro una hora antes.' }]
    : hora1
      ? [{ p: 'Te vamos a mandar un recordatorio una hora antes.' }]
      : [];
  return mail(
    `Confirmado: Llamada de diagnóstico con Guido Sustento el ${fechaCorta(ctx.inicio)} a las ${hora(ctx.inicio)}`,
    [
      { p: `Hola ${primerNombre(ctx.nombre)},` },
      { p: 'Tu llamada quedó agendada.' },
      { datos: [
        ['Evento', EVENTO],
        ['Fecha y hora', fechaYHora(ctx)],
        ['Duración', '30 minutos'],
        ['Dónde', 'Google Meet']
      ] },
      ...bloqueMeet(ctx),
      ...lineaRecordatorios,
      bloqueCambios(ctx, '¿Necesitás hacer un cambio?')
    ]
  );
}

export function recordatorioDia(ctx) {
  return mail(
    `Recordatorio: Llamada de diagnóstico mañana a las ${hora(ctx.inicio)}`,
    [
      { p: `Hola ${primerNombre(ctx.nombre)},` },
      { p: 'Te recordamos tu llamada de mañana.' },
      { datos: [
        ['Evento', EVENTO],
        ['Fecha y hora', fechaYHora(ctx, false)],
        ['Dónde', 'Google Meet']
      ] },
      ...bloqueMeet(ctx),
      bloqueCambios(ctx, '¿Necesitás hacer un cambio?', `Podés hacerlo hasta ${limiteDeCambio(ctx.inicio)}.`)
    ]
  );
}

export function recordatorioHora(ctx) {
  return mail(
    'Recordatorio: Llamada de diagnóstico en 1 hora',
    [
      { p: `Hola ${primerNombre(ctx.nombre)},` },
      { p: 'Tu llamada empieza en 1 hora.' },
      { datos: [
        ['Evento', EVENTO],
        ['Fecha y hora', `hoy, ${rango(ctx.inicio, ctx.fin, ctx.zona)}`],
        ['Dónde', 'Google Meet']
      ] },
      ...bloqueMeet(ctx)
    ]
  );
}

export function reprogramacion(ctx, antesInicio) {
  return mail(
    `Reprogramado: Llamada de diagnóstico el ${fechaCorta(ctx.inicio)} a las ${hora(ctx.inicio)}`,
    [
      { p: `Hola ${primerNombre(ctx.nombre)},` },
      { p: 'Tu llamada se reprogramó.' },
      { datos: [
        ['Evento', EVENTO],
        ['Nueva fecha y hora', fechaYHora(ctx, false)],
        ['Antes', `${fechaLarga(antesInicio, ZONA, false)}, ${hora(antesInicio)}`, { tachado: true }],
        ['Dónde', 'Google Meet (el mismo link)']
      ] },
      ...bloqueMeet(ctx),
      bloqueCambios(ctx, '¿Necesitás hacer otro cambio?')
    ]
  );
}

/** `motivo` solo si canceló Guido y lo escribió. */
export function cancelacion(ctx, motivo) {
  return mail(
    `Cancelado: Llamada de diagnóstico del ${fechaCorta(ctx.inicio)} a las ${hora(ctx.inicio)}`,
    [
      { p: `Hola ${primerNombre(ctx.nombre)},` },
      { p: 'Tu llamada fue cancelada.' },
      { datos: [
        ['Evento', EVENTO],
        ['Fecha y hora', fechaYHora(ctx, false)],
        ...(motivo ? [['Motivo', motivo]] : [])
      ] },
      { p: 'Si querés elegir otro horario:' },
      { boton: ['Agendar de nuevo', ctx.urls.agendar] }
    ]
  );
}

// ---------------------------------------------------------------------------
// Avisos a Guido (6 y 7)
// ---------------------------------------------------------------------------

/**
 * ctx suma: email, whatsapp, fila { alimentacion, origen, utm_source, utm_content,
 * recomendo, fueANutri ('si'|'no'), compromiso, motivo, objetivo } y
 * urls { calendar, cancelarGuido, etiquetar(clave), wa }.
 */
export function avisoReserva(ctx) {
  const f = ctx.fila;
  const utm = [f.utm_source, f.utm_content].filter(Boolean).join(' / ');
  const filas = [
    ['Nombre', ctx.nombre],
    ['Mail', ctx.email],
    ['WhatsApp', ctx.urls.wa ? { texto: ctx.whatsapp, url: ctx.urls.wa } : ctx.whatsapp],
    ['Alimentación hoy', ALIMENTACION_TEXTO[f.alimentacion] || f.alimentacion],
    ['Cómo llegó', f.origen + (utm ? ` · link: ${utm}` : '')],
    ...(f.recomendo ? [['Lo recomendó', f.recomendo]] : []),
    ['¿Fue a nutri antes?', f.fueANutri === 'si' ? 'Sí' : 'No'],
    ['¿Compromiso 3 meses?', COMPROMISO_TEXTO[f.compromiso] || f.compromiso]
  ];
  const cortoLargo = `${fechaCorta(ctx.inicio)}, ${hora(ctx.inicio)}`;
  const cuando = cortoLargo.charAt(0).toUpperCase() + cortoLargo.slice(1);
  return mail(
    `Nueva reserva: ${ctx.nombre}, ${fechaCorta(ctx.inicio, ZONA, true)} ${hora(ctx.inicio)}`,
    [
      { p: cuando },
      { datos: filas },
      { campo: ['Qué lo/la trajo:', f.motivo] },
      { campo: ['Qué quiere lograr en 90 días:', f.objetivo] },
      { boton: ['Abrir en el Calendar', ctx.urls.calendar] },
      { links: { intro: '', items: [['Cancelar este turno', ctx.urls.cancelarGuido]] } },
      { hr: true },
      { links: {
        intro: 'Después de la llamada, etiquetá el caso (hasta 2):',
        items: ETIQUETAS.map(e => [e.texto, ctx.urls.etiquetar(e.clave)])
      } }
    ]
  );
}

export function avisoCancelo(ctx) {
  const extra = ctx.whatsapp ? [{ linea: ['Si querés escribirle:', ctx.urls.wa ? { texto: ctx.whatsapp, url: ctx.urls.wa } : ctx.whatsapp] }] : [];
  return mail(
    `Canceló: ${ctx.nombre}, ${fechaCorta(ctx.inicio, ZONA, true)} ${hora(ctx.inicio)}`,
    [
      { p: `${ctx.nombre} canceló la llamada del ${fechaCorta(ctx.inicio)} a las ${hora(ctx.inicio)}. El horario ya quedó libre en la agenda.` },
      ...extra
    ]
  );
}

export function avisoCambio(ctx, antesInicio) {
  return mail(
    `Cambió el horario: ${ctx.nombre}, de ${fechaCorta(antesInicio, ZONA, true)} ${hora(antesInicio)} a ${fechaCorta(ctx.inicio, ZONA, true)} ${hora(ctx.inicio)}`,
    [
      { p: `${ctx.nombre} movió la llamada al ${fechaCorta(ctx.inicio)} a las ${hora(ctx.inicio)}. El Calendar ya está actualizado y el Meet sigue siendo el mismo.` }
    ]
  );
}

// ---------------------------------------------------------------------------
// Archivo de calendario (.ics) que va adjunto en la confirmación
// ---------------------------------------------------------------------------

function icsFecha(iso) {
  return new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function icsTexto(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** VCALENDAR de un evento; el estándar pide CRLF entre líneas. */
export function armarIcs({ eventId, inicio, fin, meet, ahora = new Date() }) {
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hacelo con Sustento//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${eventId}@haceloconsustento.com`,
    `DTSTAMP:${icsFecha(ahora)}`,
    `DTSTART:${icsFecha(inicio)}`,
    `DTEND:${icsFecha(fin)}`,
    `SUMMARY:${icsTexto('Llamada de diagnóstico — Método Sustento')}`,
    ...(meet ? [`LOCATION:${icsTexto(meet)}`, `DESCRIPTION:${icsTexto(meet)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lineas.join('\r\n') + '\r\n';
}
