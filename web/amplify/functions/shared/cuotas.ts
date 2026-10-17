// Cuotas de mantenimiento: un cargo por unidad y periodo (id «<unidad>#<periodo>#cuota», nunca se duplica).
// Las genera la administración (Finanzas › Generar cuotas del mes) o, si el condominio tiene activa la cuota
// automática, la tarea diaria de siia-recargos el día del mes configurado (diaCargo).
import { byIndex, put, type Item } from './db';

const dia = (n: unknown, def: number) => String(Math.min(Math.max(Number(n) || def, 1), 28)).padStart(2, '0');

/** «Cuota de mantenimiento octubre de 2026» */
export function conceptoCuota(periodo: string) {
  const [a, m] = periodo.split('-').map(Number);
  const mes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1)));
  return `Cuota de mantenimiento ${mes} de ${a}`;
}

/** Fecha límite de la cuota del periodo según el día de vencimiento del condominio. */
export const venceCuota = (c: Item, periodo: string) => `${periodo}-${dia(c.diaVencimiento, 10)}`;

/** Día del mes (AAAA-MM-DD) en que se genera automáticamente la cuota del periodo. */
export const fechaCargo = (c: Item, periodo: string) => `${periodo}-${dia(c.diaCargo, 1)}`;

/** Crea la cuota del periodo para cada unidad con cuota > 0. Regresa cuántas se crearon y cuáles ya existían o no tienen cuota. */
export async function crearCuotas(c: Item, periodo: string, opts: { vence?: string; concepto?: string } = {}) {
  const vence = opts.vence ?? venceCuota(c, periodo);
  // Cuota única del condominio; las unidades anteriores a esa configuración conservan su cuota propia.
  const cuotaCondo = Number(c.cuotaMensual) > 0 ? Number(c.cuotaMensual) : 0;
  const concepto = opts.concepto || conceptoCuota(periodo);
  const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', c.id);
  const nuevas: Item[] = [];
  let omitidos = 0;
  for (const u of unidades) {
    const monto = cuotaCondo || u.cuota;
    if (!(monto > 0)) {
      omitidos++;
      continue;
    }
    try {
      nuevas.push(
        await put(
          'Cargo',
          { id: `${u.id}#${periodo}#cuota`, condominioId: c.id, unidadId: u.id, concepto, periodo, monto, vence, estado: 'PENDIENTE', tipo: 'CUOTA' },
          { ifNotExists: 'id' },
        ),
      );
    } catch (err: any) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      omitidos++;
    }
  }
  return { creados: nuevas.length, omitidos, nuevas, vence };
}
