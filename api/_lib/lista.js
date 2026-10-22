/**
 * La lista de mails en Resend: la secuencia de bienvenida y la baja.
 *
 * Supabase sigue siendo la fuente de verdad de quién se anotó. Resend necesita
 * tener a la persona como contacto para poder mandarle la secuencia (mails 2, 3
 * y 4 de la automatización "Secuencia de bienvenida"), y para que una baja
 * desde cualquier link la saque de todos los envíos.
 *
 * Usa RESEND_AGENDA_KEY porque crear contactos y mandar eventos necesita
 * "Full access", igual que cancelar recordatorios en la agenda: la
 * RESEND_API_KEY del resto del sitio es de "Sending access" y no alcanza.
 *
 * Ninguna función tira error hacia afuera: si Resend falla, la persona igual
 * queda anotada en Supabase y ya recibió el Mini Recetario. Queda en los logs.
 */

const API = 'https://api.resend.com';

// El segmento con el que salieron los mails 2, 3 y 4 a mano. Sumar ahí a los
// nuevos deja la lista completa para cualquier envío que venga después.
const SEGMENTO_LISTA = '0652d9e9-75fb-485c-bcfc-77079f3486bc';

// El nombre del evento que dispara la automatización en Resend. Si se cambia
// acá, cambiarlo también en el disparador de la automatización.
const EVENTO_ALTA = 'lista.alta';

async function llamar(metodo, ruta, cuerpo) {
  const clave = process.env.RESEND_AGENDA_KEY;
  if (!clave) throw new Error('Falta la variable de entorno RESEND_AGENDA_KEY');

  const pedir = () => fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Authorization': `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  let r = await pedir();
  // 429: Resend limita a pocos pedidos por segundo. Se espera y se reintenta una vez.
  if (r.status === 429) {
    await new Promise(ok => setTimeout(ok, 700));
    r = await pedir();
  }
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, datos };
}

/**
 * Crea el contacto en Resend y dispara la secuencia. La rama del mail 2 sale
 * de `barrera`: vacía va a la versión "sin barrera", cualquier otra (incluida
 * "otra") a la que dice "me dijiste que tenés ciertas dificultades".
 */
export async function sumarASecuencia({ email, source, barrera }) {
  try {
    const contacto = await llamar('POST', '/contacts', {
      email,
      unsubscribed: false,
      // Mismo valor que tienen los importados el 13/10 cuando no contestaron.
      properties: { barrera: barrera || 'sin-respuesta', source: source || '' },
      segments: [{ id: SEGMENTO_LISTA }]
    });
    // Si ya existía en Resend no es un problema: el evento igual lo encuentra
    // por el mail. Se loguea por si es otra cosa.
    if (!contacto.ok) console.error('Resend: no se pudo crear el contacto:', contacto.status, contacto.datos);

    const evento = await llamar('POST', '/events/send', {
      event: EVENTO_ALTA,
      email,
      payload: { barrera: barrera || '', source: source || '' }
    });
    if (!evento.ok) console.error('Resend: no se pudo disparar la secuencia:', evento.status, evento.datos);
  } catch (err) {
    console.error('Resend: falló el alta a la secuencia:', err);
  }
}

/**
 * Marca la baja también en Resend, así la secuencia y los envíos a la lista
 * dejan de llegarle aunque se haya dado de baja desde el mail de bienvenida.
 * Un 404 es alguien que nunca pasó a Resend (altas viejas): no hay nada que hacer.
 */
export async function darDeBajaEnResend(email) {
  try {
    const r = await llamar('PATCH', `/contacts/${encodeURIComponent(email)}`, { unsubscribed: true });
    if (!r.ok && r.status !== 404) console.error('Resend: no se pudo marcar la baja:', r.status, r.datos);
  } catch (err) {
    console.error('Resend: falló la baja:', err);
  }
}
