// Recibo de pago imprimible (se genera a partir de un pago validado con folio).
import { Icon, fecha, money, useAction } from './ui';

type PagoRecibo = {
  id: string;
  folio?: string;
  monto: number;
  fecha?: string;
  referencia?: string;
  validadoEn?: string;
  saldoFavorUsado?: number | null;
  ajuste?: string | null;
  diferencia?: number | null;
  abonoOtros?: number | null;
};
type CargoRecibo = { id: string; concepto: string; monto: number; montoOriginal?: number | null };

export type ReciboData = {
  pago: PagoRecibo;
  cargos: CargoRecibo[];
  condominio: { nombre: string; direccion?: string };
  unidad: { etiqueta: string; propietario?: string };
};

type PagoBD = { id: string; folio?: string | null; monto: number; fecha?: string | null; referencia?: string | null; validadoEn?: string | null } & Partial<
  Record<'saldoFavorUsado' | 'diferencia' | 'abonoOtros', number | null> & Record<'ajuste', string | null>
>;

/** Datos del pago para el recibo (los registros traen null donde el recibo espera undefined). */
export const pagoRecibo = (p: PagoBD): PagoRecibo => ({
  id: p.id,
  folio: p.folio ?? '',
  monto: p.monto,
  fecha: p.fecha ?? undefined,
  referencia: p.referencia ?? undefined,
  validadoEn: p.validadoEn ?? undefined,
  saldoFavorUsado: p.saldoFavorUsado,
  ajuste: p.ajuste,
  diferencia: p.diferencia,
  abonoOtros: p.abonoOtros,
});
export const cargoRecibo = (c: CargoRecibo): CargoRecibo => ({ id: c.id, concepto: c.concepto, monto: c.monto, montoOriginal: c.montoOriginal });

/** Concepto en el recibo: un abono parcial dice de cuánto era el cargo. */
export const conceptoRecibo = (c: CargoRecibo, fmt: (n: number) => string) =>
  c.montoOriginal && c.montoOriginal !== c.monto ? `${c.concepto} (abono; el cargo era de ${fmt(c.montoOriginal)})` : c.concepto;

/** Líneas bajo el total: saldo a favor usado y qué pasó con la diferencia. */
export function notasRecibo(p: PagoRecibo, fmt: (n: number) => string): string[] {
  const n: string[] = [];
  if (p.saldoFavorUsado) n.push(`Saldo a favor aplicado: ${fmt(p.saldoFavorUsado)}`);
  if (p.abonoOtros) n.push(`Excedente abonado a otros cargos pendientes: ${fmt(p.abonoOtros)}`);
  const d = p.diferencia ?? 0;
  if (p.ajuste === 'PARCIAL') n.push(`Pago parcial: queda pendiente ${fmt(d)}`);
  if (p.ajuste === 'CONDONADO') n.push(`Diferencia condonada por la administración: ${fmt(d)}`);
  if (p.ajuste === 'SALDO_FAVOR') n.push(`Excedente abonado al saldo a favor: ${fmt(d)}`);
  if (p.ajuste === 'EXCEDENTE') n.push(`Excedente registrado como otro ingreso: ${fmt(d)}`);
  return n;
}

export function Recibo({ data }: { data: ReciboData }) {
  const { pago, cargos, condominio, unidad } = data;
  const imprimir = () => {
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 500);
  };
  const { run, busy } = useAction();
  const descargar = () =>
    run(async () => {
      const { descargarRecibo } = await import('./reciboPdf');
      await descargarRecibo(data);
    }, 'Recibo descargado');
  return (
    <>
      <div className="recibo">
        <div className="recibo-head">
          <img src="/marca/siia-vertical.svg" alt="SIIA · soluciones inmobiliarias" />
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">Recibo de pago</div>
            <div className="codigo">{pago.folio}</div>
            <div className="small">Validado el {fecha(pago.validadoEn)}</div>
          </div>
        </div>
        <p style={{ margin: '0 0 4px' }}>
          <strong>{condominio.nombre}</strong>
        </p>
        {condominio.direccion && <p className="small muted" style={{ margin: 0 }}>{condominio.direccion}</p>}
        <p style={{ margin: '12px 0' }}>
          Unidad: <strong>{unidad.etiqueta}</strong>
          {unidad.propietario && ` · ${unidad.propietario}`}
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            {cargos.length ? (
              cargos.map((c) => (
                <tr key={c.id}>
                  <td>{conceptoRecibo(c, money)}</td>
                  <td className="num">{money(c.monto)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>Pago a cuenta de mantenimiento</td>
                <td className="num">{money(pago.monto)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="recibo-total" style={{ marginTop: 12 }}>
          Total recibido: {money(pago.monto)}
        </div>
        {notasRecibo(pago, money).map((t) => (
          <div key={t} className="small" style={{ textAlign: 'right', marginTop: 4 }}>
            {t}
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 16 }}>
          Fecha de pago: {fecha(pago.fecha)}
          {pago.referencia && ` · Referencia: ${pago.referencia}`}
          <br />
          SIIA · Sistemas Integrales Inmobiliarios y de Administración · Documento sin validez fiscal.
        </p>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn-app" disabled={busy} onClick={descargar}>
          <Icon name="download" />
          {busy ? 'Generando…' : 'Descargar PDF'}
        </button>
        <button className="btn-app secondary" onClick={imprimir}>
          <Icon name="print" />
          Imprimir
        </button>
      </div>
    </>
  );
}
