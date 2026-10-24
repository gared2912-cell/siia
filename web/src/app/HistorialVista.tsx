// Historial de pagos en pantalla (mismo cálculo que el PDF): para revisarlo mientras se atiende al residente y,
// si lo pide, descargarlo en PDF desde aquí. Cada recibo aprobado se ve en la misma ventana (y se descarga).
import { useState } from 'react';
import { Archivo, Icon, Modal, fecha, money, useAction } from './ui';
import { calcularHistorial, type DatosHistorial, type PagoHistorial } from './historialPdf';
import { Recibo, type ReciboData } from './Recibo';

const ESTADO: Record<string, { texto: string; clase: string }> = {
  PAGADO: { texto: 'Pagado', clase: 'ok' },
  PENDIENTE: { texto: 'Pendiente', clase: 'warn' },
  VENCIDO: { texto: 'Vencido', clase: 'mal' },
  REVISION: { texto: 'En revisión', clase: 'info' },
};
const mes = (p?: string | null) => {
  if (!p || !/^\d{4}-\d{2}$/.test(p)) return '—';
  const [a, m] = p.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function HistorialVista({ datos, onClose }: { datos: DatosHistorial; onClose: () => void }) {
  const h = calcularHistorial(datos);
  const { run, busy } = useAction();
  const [recibo, setRecibo] = useState<{ data: ReciboData; comprobante?: string | null } | null>(null);
  const descargar = () =>
    run(async () => {
      const { descargarHistorial } = await import('./historialPdf');
      await descargarHistorial(datos);
    }, 'Historial descargado');
  const recibos = datos.pagos
    .filter((p) => p.estado === 'VALIDADO')
    .sort((a, b) => String(b.fecha ?? b.validadoEn ?? '').localeCompare(String(a.fecha ?? a.validadoEn ?? '')));
  const ver = (p: PagoHistorial) =>
    setRecibo({
      data: {
        pago: { id: p.id, folio: p.folio ?? '', monto: p.monto, fecha: p.fecha ?? undefined, referencia: p.referencia ?? undefined, validadoEn: p.validadoEn ?? undefined },
        cargos: datos.cargos.filter((c) => (p.cargoIds ?? []).includes(c.id)).map((c) => ({ id: c.id, concepto: c.concepto, monto: c.monto })),
        condominio: { nombre: datos.condominio, direccion: datos.direccion ?? undefined },
        unidad: { etiqueta: datos.unidad, propietario: datos.residente ?? undefined },
      },
      comprobante: p.comprobantePath,
    });

  if (recibo)
    return (
      <Modal title={`Recibo ${recibo.data.pago.folio} · ${datos.unidad}`} onClose={onClose} wide>
        <div className="stack">
          <div className="row-actions" style={{ justifyContent: 'space-between' }}>
            <button className="btn-app sm secondary" onClick={() => setRecibo(null)}>
              <Icon name="chevron-left" />
              Volver al historial
            </button>
            <Archivo path={recibo.comprobante} origen={{ model: 'Pago', id: recibo.data.pago.id }} label="Ver comprobante del residente" />
          </div>
          <Recibo data={recibo.data} />
        </div>
      </Modal>
    );

  return (
    <Modal title={`Historial de pagos · ${datos.unidad}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">
            {datos.residente || 'Sin residente'} · {datos.condominio}{' '}
            <span className={`pill ${h.vencido > 0 ? 'mal' : 'ok'}`}>{h.vencido > 0 ? 'Con adeudo vencido' : 'Al corriente'}</span>
          </span>
          <button className="btn-app sm" disabled={busy} onClick={descargar}>
            <Icon name="download" />
            {busy ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
        <div className="hist-resumen">
          <div>
            <span>Total de cargos</span>
            <strong>{money(h.total)}</strong>
          </div>
          <div className="ok">
            <span>Pagado</span>
            <strong>{money(h.pagado)}</strong>
          </div>
          <div className="info">
            <span>En revisión</span>
            <strong>{money(h.enRevision)}</strong>
          </div>
          <div className={h.pendiente > 0 ? 'mal' : 'ok'}>
            <span>{h.pendiente > 0 ? 'Saldo pendiente' : 'Sin adeudo'}</span>
            <strong>{money(h.pendiente)}</strong>
          </div>
        </div>
        {h.vencido > 0 && <div className="alert error small">De este saldo, {money(h.vencido)} ya pasó su fecha límite de pago.</div>}
        <div className="table-wrap">
          <table className="tbl tbl-tarjetas">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Concepto</th>
                <th>Vence</th>
                <th className="num">Monto</th>
                <th>Estado</th>
                <th>Pagado el</th>
                <th>Recibo</th>
              </tr>
            </thead>
            <tbody>
              {h.filas.length ? (
                h.filas.map((x) => (
                  <tr key={x.c.id}>
                    <td data-label="Periodo">{mes(x.c.periodo)}</td>
                    <td className="tt-titulo">{x.c.concepto}</td>
                    <td data-label="Vence">{fecha(x.c.vence)}</td>
                    <td className="num" data-label="Monto">{money(x.c.monto)}</td>
                    <td data-label="Estado">
                      <span className={`pill ${ESTADO[x.clave].clase}`}>{ESTADO[x.clave].texto}</span>
                    </td>
                    <td data-label="Pagado el">{x.pagadoEl ? fecha(x.pagadoEl) : '—'}</td>
                    <td data-label="Recibo">
                      {x.p ? (
                        <button className="linklike" style={{ whiteSpace: 'nowrap' }} onClick={() => ver(x.p!)}>
                          {x.p.folio ?? 'Ver recibo'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                    Sin cargos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="hist-titulo">Recibos de pago ({recibos.length})</h3>
          {recibos.length ? (
            <ul className="list mascotas-lista">
              {recibos.map((p) => (
                <li key={p.id}>
                  <button type="button" className="mascota-fila" onClick={() => ver(p)} aria-label={`Ver recibo ${p.folio ?? ''}`}>
                    <span className="photo-thumb sin-foto">
                      <Icon name="file" />
                    </span>
                    <span className="list-main">
                      <strong>{p.folio ?? 'Recibo'}</strong>
                      <span className="list-sub">Pagado el {fecha(p.fecha ?? p.validadoEn)}</span>
                    </span>
                    <span className="mascota-fila-estado">
                      <strong>{money(p.monto)}</strong>
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Aún no hay recibos aprobados.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
