/**
 * Lógica pura de horarios de la agenda propia (llamada de diagnóstico).
 * Sin red y sin dependencias: se puede probar con node a secas.
 *
 * Las franjas están en hora de Buenos Aires. Argentina es UTC-3 todo el año,
 * sin horario de verano, así que alcanza con un offset fijo: no hace falta
 * ninguna librería de zonas horarias. El servidor de Vercel corre en UTC, por
 * eso el día de la semana y la fecha SIEMPRE se calculan sobre la fecha de
 * Buenos Aires, nunca con getDay()/getDate() del servidor: a las 22:00 de un
 * martes en Buenos Aires ya es miércoles en UTC.
 */

export const ZONA = 'America/Argentina/Buenos_Aires';
export const ANTICIPACION_MIN_HS = 12;
export const MAX_DIAS = 14;
export const DURACION_MIN = 30;

const OFFSET_AR = '-03:00';
const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

// Día de la semana (0 = domingo) -> franjas [desde, hasta) en "HH:MM".
// El último turno de cada franja es el que termina justo en `hasta`:
// 9–13 arranca su último turno 12:30; 17:30–20 lo arranca 19:30.
const FRANJAS = {
  2: [['09:00', '13:00'], ['17:30', '20:00']], // martes
  3: [['09:00', '13:00'], ['16:00', '20:00']], // miércoles
  4: [['09:00', '13:00'], ['17:30', '20:00']]  // jueves
};

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

/**
 * Fecha 'YYYY-MM-DD' en Buenos Aires de un instante. Se corre el instante 3 h
 * hacia atrás y se leen los campos UTC: así no depende de la zona del servidor.
 */
export function fechaBA(fecha) {
  const d = new Date(new Date(fecha).getTime() - OFFSET_AR_MS);
  return `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`;
}

/**
 * Genera los turnos que se pueden ofrecer a partir de `ahora`, ordenados.
 * Reglas: el turno tiene que empezar con al menos 12 h de anticipación y no más
 * de 14 días adelante.
 */
export function generarTurnos(ahora) {
  const desde = ahora.getTime() + ANTICIPACION_MIN_HS * 3600 * 1000;
  const hasta = ahora.getTime() + MAX_DIAS * 24 * 3600 * 1000;

  // Día base: la fecha de Buenos Aires de `ahora`, tomada al mediodía UTC para
  // que sumar días enteros nunca cruce un borde de fecha.
  const [y, mo, d] = fechaBA(ahora).split('-').map(Number);
  const base = Date.UTC(y, mo - 1, d, 12);

  const turnos = [];
  // 16 días cubre el máximo de 14 más el margen de la hora del día.
  for (let i = 0; i <= MAX_DIAS + 2; i++) {
    const dia = new Date(base + i * 24 * 3600 * 1000);
    const ymd = dia.toISOString().slice(0, 10);
    const franjas = FRANJAS[dia.getUTCDay()];
    if (!franjas) continue;

    for (const [ini, fin] of franjas) {
      for (let min = aMinutos(ini); min + DURACION_MIN <= aMinutos(fin); min += DURACION_MIN) {
        const hh = `${dosDigitos(Math.floor(min / 60))}:${dosDigitos(min % 60)}`;
        const inicio = new Date(`${ymd}T${hh}:00${OFFSET_AR}`);
        const t = inicio.getTime();
        if (t < desde || t > hasta) continue;
        turnos.push({
          inicio: inicio.toISOString(),
          fin: new Date(t + DURACION_MIN * 60 * 1000).toISOString()
        });
      }
    }
  }
  return turnos.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/**
 * Saca los turnos que chocan con algún evento ocupado y los de días feriado.
 * La superposición es estricta: un evento que termina 9:30 no bloquea el turno
 * que arranca 9:30.
 */
export function restarOcupados(turnos, ocupados, feriados) {
  const rangos = (ocupados || []).map(o => [new Date(o.start).getTime(), new Date(o.end).getTime()]);
  return turnos.filter(t => {
    if (feriados && feriados.has(fechaBA(t.inicio))) return false;
    const ini = new Date(t.inicio).getTime();
    const fin = new Date(t.fin).getTime();
    return !rangos.some(([s, e]) => ini < e && fin > s);
  });
}

/**
 * true si `inicioISO` es exactamente uno de los turnos que generaría
 * generarTurnos(ahora). Sirve para no confiar en lo que manda el navegador.
 */
export function turnoValido(inicioISO, ahora) {
  const t = new Date(inicioISO).getTime();
  if (Number.isNaN(t)) return false;
  return generarTurnos(ahora).some(x => new Date(x.inicio).getTime() === t);
}
