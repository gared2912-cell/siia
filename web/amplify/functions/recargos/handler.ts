// Recargo por pago tardío. En los condominios que lo tienen activo, al día siguiente del vencimiento
// se carga el recargo a cada cuota de mantenimiento que siga sin pagar y sin comprobante en revisión.
// Un solo recargo por cuota (id «<unidad>#<periodo>#recargo»), solo para cuotas que vencen después de
// activarlo (recargoDesde), y la unidad recibe un aviso en el portal.
import { byIndex, hoyMX, put, scan, type Item } from '../shared/db';

const mxn = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

export async function aplicarRecargos(c: Item, hoy = hoyMX()) {
  const monto = Number(c.recargoMonto);
  if (!c.recargoActivo || !(monto > 0) || c.activo === false) return 0;
  const desde: string = c.recargoDesde ?? hoy;
  const [cargos, pagos] = await Promise.all([
    byIndex('Cargo', 'byCondominio', 'condominioId', c.id),
    byIndex('Pago', 'byCondominio', 'condominioId', c.id),
  ]);
  // Comprobantes en revisión: cubren sus cargos; uno sin cargos indicados cubre toda la unidad.
  const enRevision = pagos.filter((p) => p.estado === 'EN_REVISION');
  const cubiertos = new Set(enRevision.flatMap((p) => p.cargoIds ?? []));
  const unidadesConPago = new Set(enRevision.filter((p) => !(p.cargoIds ?? []).length).map((p) => p.unidadId));
  const existentes = new Set(cargos.map((x) => x.id));

  let n = 0;
  for (const cuota of cargos) {
    if (!String(cuota.id).endsWith('#cuota') || cuota.estado !== 'PENDIENTE') continue;
    if (!cuota.vence || cuota.vence >= hoy || cuota.vence < desde) continue;
    if (cubiertos.has(cuota.id) || unidadesConPago.has(cuota.unidadId)) continue;
    const id = String(cuota.id).replace(/#cuota$/, '#recargo');
    if (existentes.has(id)) continue;
    try {
      await put(
        'Cargo',
        {
          id,
          condominioId: c.id,
          unidadId: cuota.unidadId,
          concepto: `Recargo por pago tardío · ${cuota.concepto}`,
          periodo: cuota.periodo,
          monto,
          vence: hoy,
          estado: 'PENDIENTE',
        },
        { ifNotExists: 'id' },
      );
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
    await put('Aviso', {
      condominioId: c.id,
      unidadId: cuota.unidadId,
      tipo: 'PAGO',
      titulo: `Recargo por pago tardío de ${mxn(monto)}`,
      texto: `Tu ${String(cuota.concepto).toLowerCase()} venció el ${cuota.vence} sin pago registrado. Puedes consultarlo y pagar en Finanzas.`,
      leido: false,
    });
    n++;
  }
  return n;
}

export const handler = async () => {
  const hoy = hoyMX();
  const condos = (await scan('Condominio')).filter((c) => c.recargoActivo);
  let total = 0;
  for (const c of condos) {
    try {
      const n = await aplicarRecargos(c, hoy);
      total += n;
      if (n) console.log(`${c.nombre}: ${n} recargo(s)`);
    } catch (err) {
      console.error(c.id, err);
    }
  }
  return { hoy, recargos: total };
};
