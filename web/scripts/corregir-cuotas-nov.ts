// Corrección única (11 nov 2026): cuotas completas de noviembre que no debían cobrarse según las reglas de
// shared/cuotas.ts (entrega a mitad de mes o cuota manual del mes).
// - Si alguno de los cargos de cuota del mes ya está pagado, se respeta y se cancelan los pendientes.
// - Si ninguno está pagado, se cancelan y se crea la cuota proporcional (fecha de entrega o, si falta, fecha de alta).
// - Con un comprobante en revisión no se toca: se revisa a mano.
// Uso (simulación): SUFIJO=<api>-NONE CONDOMINIO=<id> npx tsx scripts/corregir-cuotas-nov.ts   ·   APLICAR=1 para guardar.
const SUFIJO = process.env.SUFIJO!;
for (const m of ['Unidad', 'Cargo', 'Pago', 'Condominio']) process.env[`TABLE_${m}`] = `${m}-${SUFIJO}`;
process.env.AWS_PROFILE ??= 'Gared';
process.env.AWS_REGION ??= 'us-east-1';

const { byIndex, get, hoyMX, put, update } = await import('../amplify/functions/shared/db');
const { sinCuotaCompleta, fechaCargo } = await import('../amplify/functions/shared/cuotas');
const { esCuotaManual, periodoDeCuota, cargoProporcional } = await import('../amplify/functions/shared/finanzas');
const { firmarComo } = await import('../amplify/functions/shared/firma');
const { edicionesDe } = await import('../amplify/functions/shared/ediciones');

const APLICAR = process.env.APLICAR === '1';
const PERIODO = process.env.PERIODO ?? '2026-11';
const POR = { id: 'sistema', nombre: 'SIIA (corrección de cuotas duplicadas)', rol: 'SISTEMA' as const };
firmarComo(POR);

const c = await get('Condominio', { id: process.env.CONDOMINIO! });
if (!c) throw new Error('Condominio no encontrado');
const cuota = Number(c.cuotaMensual);
const [unidades, cargos, pagos] = await Promise.all(['Unidad', 'Cargo', 'Pago'].map((m) => byIndex(m, 'byCondominio', 'condominioId', c.id)));
const enRevision = (x: any) => pagos.some((p) => p.estado === 'EN_REVISION' && (p.cargoIds ?? []).includes(x.id));
const altaMX = (x: any) => hoyMX(new Date(x.createdAt));
const money = (n: number) => `$${n.toFixed(2)}`;

async function cancelar(x: any, detalle: string) {
  const e = { en: new Date().toISOString(), por: POR, motivo: 'DUPLICADO', detalle, accion: 'CANCELAR', cambios: [{ campo: 'estado', antes: x.estado, despues: 'CANCELADO' }] };
  if (APLICAR) await update('Cargo', { id: x.id }, { estado: 'CANCELADO', ediciones: JSON.stringify([...edicionesDe(x.ediciones), e]) }, { estado: 'PENDIENTE' });
}

const filas: string[] = [];
for (const u of [...unidades].sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es', { numeric: true }))) {
  const suyos = cargos.filter((x) => x.unidadId === u.id);
  const auto = suyos.find((x) => x.id === `${u.id}#${PERIODO}#cuota` && x.estado !== 'CANCELADO');
  if (!auto) continue;
  const motivo = sinCuotaCompleta(u, suyos, PERIODO, { fechaCargo: fechaCargo(c, PERIODO) });
  if (!motivo) continue;
  const delMes = [auto, ...suyos.filter((x) => esCuotaManual(x) && periodoDeCuota(x) === PERIODO)];
  const entrega = u.fechaEntrega ?? altaMX(u);
  const desc = delMes.map((x) => `«${x.concepto}» ${money(x.monto)} ${x.estado}${enRevision(x) ? ' (comprobante en revisión)' : ''}`).join(' + ');
  if (delMes.some(enRevision)) {
    filas.push(`${u.etiqueta} · entrega ${entrega} · ${desc}\n    → SIN CAMBIOS: tiene un comprobante en revisión; revisar a mano.`);
    continue;
  }
  const pagados = delMes.filter((x) => x.estado === 'PAGADO');
  const pendientes = delMes.filter((x) => x.estado === 'PENDIENTE');
  if (pagados.length) {
    for (const x of pendientes) await cancelar(x, `Duplicada: la cuota de ${PERIODO} ya está pagada («${pagados[0].concepto}»).`);
    const cp = cargoProporcional(cuota, entrega, c.diaVencimiento);
    filas.push(
      `${u.etiqueta} · entrega ${entrega} · ${desc}\n    → ${pendientes.length ? `cancelo ${pendientes.map((x) => `«${x.concepto}»`).join(', ')}; ` : ''}respeto lo pagado (${money(pagados[0].monto)}; la proporcional sería ${money(cp.monto)}).`,
    );
    continue;
  }
  const cp = cargoProporcional(cuota, entrega, c.diaVencimiento);
  for (const x of pendientes) await cancelar(x, `Reemplazada por la cuota proporcional de entrega (${entrega}).`);
  if (APLICAR)
    await put('Cargo', {
      id: `proporcional#${u.id}#${cp.periodo}`,
      condominioId: c.id,
      unidadId: u.id,
      concepto: cp.concepto,
      periodo: cp.periodo,
      monto: cp.monto,
      vence: cp.vence,
      estado: 'PENDIENTE',
      tipo: 'PROPORCIONAL',
    }, { ifNotExists: 'id' });
  filas.push(`${u.etiqueta} · entrega ${entrega} · ${desc}\n    → cancelo ${pendientes.length} y pongo «${cp.concepto}» ${money(cp.monto)} (${cp.dias}/${cp.total} días, vence ${cp.vence}).`);
}
console.log(filas.join('\n') || 'Nada que corregir.');
console.log(`\n${APLICAR ? 'APLICADO' : 'SIMULACIÓN (APLICAR=1 para guardar)'} · ${filas.length} unidad(es)`);
