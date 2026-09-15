/**
 * Fecha oficial de operación para comprobantes emitidos desde Ecuador.
 *
 * Railway/Node normalmente trabaja en UTC. No debemos usar getDate(),
 * getMonth() o toISOString().slice(0,10) para construir la fecha tributaria,
 * porque entre las 19:00 y 23:59 de Ecuador UTC ya puede estar en el día
 * siguiente. El SRI valida la fecha de emisión contra su fecha/hora oficial.
 */
const ZONA_ECUADOR = 'America/Guayaquil';

function partesFechaEcuador(date = new Date()): Record<string, string> {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_ECUADOR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return Object.fromEntries(
    partes
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
}

/** DD/MM/YYYY, formato usado por el XML de comprobantes SRI. */
export function fechaEmisionEcuador(date = new Date()): string {
  const p = partesFechaEcuador(date);
  return `${p.day}/${p.month}/${p.year}`;
}

/** YYYY-MM-DD, útil para consultas y reportes. */
export function fechaIsoEcuador(date = new Date()): string {
  const p = partesFechaEcuador(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Devuelve la fecha/hora actual del Ecuador como objeto de partes, sin depender del TZ del servidor. */
export function hoyEcuador(): { year: number; month: number; day: number } {
  const p = partesFechaEcuador();
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

/**
 * Normaliza fechas de entrada del usuario al formato DD/MM/YYYY sin aplicar
 * conversiones UTC accidentales. Si no hay una fecha válida, usa hoy Ecuador.
 */
export function normalizarFechaEmisionEcuador(value: unknown): string {
  const s = String(value ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return fechaEmisionEcuador();
}
