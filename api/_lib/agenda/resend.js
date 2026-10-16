/**
 * Resend por REST directo, sin el SDK: la versión instalada puede no soportar
 * `scheduled_at`, y así se controla exactamente qué se manda.
 */
import { resumenError } from './google.js';

const API = 'https://api.resend.com';

// La agenda usa su propia clave porque cancelar un mail programado necesita
// "Full access": la RESEND_API_KEY del resto del sitio es de "Sending access"
// y Resend le contesta 401 al cancelar (visto en la prueba del 15/10/2026).
// Así la clave amplia queda solo en esta función. Sin ella, cae a la de siempre:
// manda bien, pero no puede cancelar recordatorios.
function clave() {
  const k = process.env.RESEND_AGENDA_KEY || process.env.RESEND_API_KEY;
  if (!k) throw new Error('Falta la variable de entorno RESEND_AGENDA_KEY');
  return k;
}

async function llamar(ruta, cuerpo) {
  const pedir = () => fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${clave()}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
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

/** Manda un mail ya. Devuelve el id. Tira si Resend rechaza. */
export async function enviar({ from, to, subject, html, text, reply_to, attachments }) {
  const { ok, status, datos } = await llamar('/emails', { from, to, subject, html, text, reply_to, attachments });
  if (!ok) throw new Error(`Resend rechazó el mail: ${status} ${resumenError(datos)}`);
  return datos.id;
}

/** Igual que enviar, pero Resend lo manda en `scheduledAt` (ISO). Devuelve el id. */
export async function programar({ scheduledAt, ...mail }) {
  const { ok, status, datos } = await llamar('/emails', { ...mail, scheduled_at: scheduledAt });
  if (!ok) throw new Error(`Resend rechazó el mail programado: ${status} ${resumenError(datos)}`);
  return datos.id;
}

/** Cancela un mail programado. Si ya salió o ya estaba cancelado, se loguea y se sigue. */
export async function cancelarProgramado(id) {
  try {
    const { ok, status, datos } = await llamar(`/emails/${encodeURIComponent(id)}/cancel`);
    if (!ok) console.error('Agenda: no se pudo cancelar el mail programado:', status, resumenError(datos));
  } catch (e) {
    console.error('Agenda: no se pudo cancelar el mail programado:', e.message);
  }
}
