// Cancela las reservas pendientes de pago que llevan 48 horas sin comprobante (en revisión o validado),
// con su cargo, y avisa a la unidad. También se revisa al consultar o pedir un horario (shared/reservas.ts).
import { scan } from '../shared/db';
import { vencerSiCorresponde } from '../shared/reservas';

export const handler = async () => {
  const pendientes = (await scan('Reserva')).filter((r) => r.estado === 'PENDIENTE_PAGO');
  let canceladas = 0;
  for (const r of pendientes) {
    try {
      if (await vencerSiCorresponde(r)) canceladas++;
    } catch (err) {
      console.error(r.id, err);
    }
  }
  if (canceladas) console.log(`${canceladas} reserva(s) cancelada(s) por falta de comprobante`);
  return { revisadas: pendientes.length, canceladas };
};
