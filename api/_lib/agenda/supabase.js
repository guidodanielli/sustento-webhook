/**
 * Tabla `reservas` (registro anónimo de la agenda: sin nombre, mail ni
 * teléfono). Columnas en supabase-schema.sql. Mismo patrón que google.js:
 * fetch directo con la service key y errores sin cuerpos completos (PostgREST
 * puede devolver "Failing row contains" con datos de la fila).
 */
import { resumenError } from './google.js';

function headers(extra = {}) {
  return {
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function fallo(r, que) {
  const datos = await r.json().catch(() => ({}));
  return new Error(`${que}: ${r.status} ${resumenError(datos)}`);
}

export async function insertarReserva(fila) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/reservas`, {
    method: 'POST',
    headers: headers({ 'Prefer': 'return=minimal' }),
    body: JSON.stringify(fila)
  });
  if (!r.ok) throw await fallo(r, 'No se pudo insertar la reserva');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Código `no-existe`: permite distinguir "no hay esa reserva" de un fallo de Supabase.
function noExiste() {
  const e = new Error('La reserva no existe');
  e.codigo = 'no-existe';
  return e;
}

/** Actualiza campos de una reserva. Tira si el id no es un uuid o si no hay fila. */
export async function actualizarReserva(id, campos) {
  if (!UUID.test(String(id))) throw noExiste();
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/reservas?id=eq.${id}`, {
    method: 'PATCH',
    headers: headers({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(campos)
  });
  if (!r.ok) throw await fallo(r, 'No se pudo actualizar la reserva');
  const filas = await r.json().catch(() => []);
  if (!filas.length) throw noExiste();
}

/** { etiquetas, etiqueta_nota } o null si no hay fila. */
export async function leerReserva(id) {
  if (!UUID.test(String(id))) return null;
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/reservas?id=eq.${id}&select=etiquetas,etiqueta_nota`,
    { headers: headers() }
  );
  if (!r.ok) throw await fallo(r, 'No se pudo leer la reserva');
  const filas = await r.json();
  return filas[0] || null;
}
