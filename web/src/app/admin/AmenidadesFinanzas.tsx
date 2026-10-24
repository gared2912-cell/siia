// Finanzas › Ingresos › Amenidades: fondo de amenidades (lo cobrado por reservas, arrastrado mes con mes, menos
// lo que se gasta del fondo con su evidencia) y solicitudes de reservación con su monto, que se aprueban aquí.
// Los residentes ven el ahorro y sus gastos en su portal (Amenidades).
import { useState } from 'react';
import { adminCall, db, ok, type Schema } from '../api';
import { Acciones, Archivo, Badge, Datos, Empty, Icon, Modal, Seg, Tarjeta, TarjetaIcono, Tarjetas, fecha, fechaHora, hoy, money, periodoActual, useAction, type Tono } from '../ui';
import { Firma } from './Firma';
import { useAdmin } from './AdminApp';
import { EditarEgreso, Mes, VerEvidencia } from './Egresos';
import { evidenciasDe, mesCorto, nombreMes, type DatosFinanzas } from './balance';
import { FONDO_AMENIDADES, calcularFondoAmenidades } from '../../../amplify/functions/shared/finanzas';

type Egreso = Schema['Egreso']['type'];
type Pago = Schema['Pago']['type'];
export type ReservaFin = Schema['Reserva']['type'] & { amenidad: string };

/** Comprobante en revisión que paga la reserva (su cargo es «reserva#<id>»). */
export const comprobanteDe = (r: ReservaFin, pagos: Pago[]) => pagos.find((p) => p.estado === 'EN_REVISION' && (p.cargoIds ?? []).includes(`reserva#${r.id}`));

/** Reservas que esperan una acción de la administración: solicitadas sin costo o con comprobante por aprobar. */
export const reservasPorAprobar = (reservas: ReservaFin[], pagos: Pago[]) =>
  reservas.filter((r) => r.estado === 'SOLICITADA' || (r.estado === 'PENDIENTE_PAGO' && !!comprobanteDe(r, pagos)));

export function AmenidadesFinanzas({ datos, reservas, reload }: { datos: DatosFinanzas; reservas: ReservaFin[]; reload: () => void }) {
  const { condo, etiqueta, puede, tiene } = useAdmin();
  const gestiona = puede('finanzas', 'editar');
  const apruebaPagos = tiene('finanzas.validarPagos');
  const apruebaReservas = puede('amenidades', 'editar');
  const [mes, setMes] = useState(periodoActual());
  const [filtro, setFiltro] = useState<'pendientes' | 'todas'>('pendientes');
  const [gasto, setGasto] = useState<Partial<Egreso> | null>(null);
  const [fichaR, setFichaR] = useState<string | null>(null);
  const [fichaG, setFichaG] = useState<string | null>(null);
  const { run, busy } = useAction();

  const fondo = calcularFondoAmenidades(datos, periodoActual() > mes ? periodoActual() : mes);
  const delMes = fondo.meses.find((x) => x.periodo === mes) ?? { periodo: mes, inicial: 0, ingresos: 0, reservas: 0, gastos: 0, final: 0 };
  const anteriores = fondo.meses.filter((x) => x.periodo < mes);
  if (!fondo.meses.some((x) => x.periodo === mes) && anteriores.length) {
    const ult = anteriores[anteriores.length - 1];
    Object.assign(delMes, { inicial: ult.final, final: ult.final });
  }
  const gastosMes = datos.egresos.filter((e) => e.fondo === FONDO_AMENIDADES && e.fecha.slice(0, 7) === mes).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const montoDe = (r: ReservaFin) => datos.cargos.find((c) => c.id === `reserva#${r.id}`);
  const pendientes = reservasPorAprobar(reservas, datos.pagos);
  const lista = (filtro === 'pendientes' ? reservas.filter((r) => r.estado === 'SOLICITADA' || r.estado === 'PENDIENTE_PAGO') : reservas).sort(
    (a, b) => Number(pendientes.includes(b)) - Number(pendientes.includes(a)) || String(b.createdAt).localeCompare(String(a.createdAt)),
  );

  const aprobarPago = (p: Pago, aprobar: boolean) => {
    const nota = aprobar ? '' : prompt('Motivo del rechazo (lo verá el residente):');
    if (!aprobar && nota === null) return;
    run(
      () => adminCall('validarPago', { pagoId: p.id, aprobar, nota }).then(() => (setFichaR(null), reload())),
      aprobar ? 'Pago aprobado: la reserva quedó confirmada y se emitió el recibo' : 'Pago rechazado; se notificó al residente',
    );
  };
  const resolver = (r: ReservaFin, estado: 'APROBADA' | 'RECHAZADA') => {
    const nota = estado === 'RECHAZADA' ? prompt('Motivo (lo verá el residente):') : '';
    if (nota === null) return;
    run(
      async () => {
        ok(await db.models.Reserva.update({ id: r.id, estado, nota: nota || r.nota }));
        await adminCall('avisar', {
          condominioId: condo!.id,
          unidadId: r.unidadId,
          titulo: `Tu reserva de ${r.amenidad} (${fecha(r.fecha)}) fue ${estado === 'APROBADA' ? 'aprobada' : 'rechazada'}`,
          texto: nota,
          tipo: 'RESERVA',
        }).catch(() => undefined);
        setFichaR(null);
        reload();
      },
      estado === 'APROBADA' ? 'Reserva aprobada' : 'Reserva rechazada',
    );
  };
  const borrarGasto = (e: Egreso) =>
    confirm(`¿Eliminar el gasto "${e.concepto}" por ${money(e.monto)}? Se regresa al fondo de amenidades.`) &&
    run(() => adminCall('egresos.borrar', { id: e.id }).then(() => (setFichaG(null), reload())), 'Gasto eliminado');
  /** Estado de una reserva para su insignia y el color de su tarjeta. */
  const estadoReserva = (r: ReservaFin): { insignia: React.ReactNode; tono: Tono } => {
    if (comprobanteDe(r, datos.pagos)) return { insignia: <Badge estado="EN_REVISION">Comprobante por aprobar</Badge>, tono: 'warn' };
    if (r.estado === 'PENDIENTE_PAGO') return { insignia: <Badge estado="PENDIENTE">Esperando pago</Badge>, tono: 'warn' };
    if (r.estado === 'SOLICITADA') return { insignia: <Badge estado="EN_REVISION">Por aprobar</Badge>, tono: 'warn' };
    return { insignia: <Badge estado={r.estado} />, tono: r.estado === 'APROBADA' ? 'ok' : r.estado === 'RECHAZADA' ? 'mal' : 'neutro' };
  };
  const reservaF = reservas.find((r) => r.id === fichaR);
  const gastoF = datos.egresos.find((e) => e.id === fichaG);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Fondo de amenidades · {nombreMes(mes)}</h2>
          {gestiona && (
            <button className="btn-app" onClick={() => setGasto({ fecha: mes === periodoActual() ? hoy() : `${mes}-01` })}>
              <Icon name="plus" />
              Registrar gasto del fondo
            </button>
          )}
        </div>
        <Mes value={mes} onChange={setMes} />
        <div className="grid-cards" style={{ marginTop: 14 }}>
          <div className="stat">
            <div className="stat-label">Saldo del mes anterior</div>
            <div className="stat-value">{money(delMes.inicial)}</div>
            <div className="small muted">Se arrastra mes con mes</div>
          </div>
          <div className="stat">
            <div className="stat-label">Ingresos del mes</div>
            <div className="stat-value is-ok">{money(delMes.ingresos)}</div>
            <div className="small muted">
              {delMes.reservas} reserva{delMes.reservas === 1 ? '' : 's'} pagada{delMes.reservas === 1 ? '' : 's'} y aprobada{delMes.reservas === 1 ? '' : 's'}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Gastos del fondo</div>
            <div className="stat-value is-alert">{money(delMes.gastos)}</div>
            <div className="small muted">
              {gastosMes.length} gasto{gastosMes.length === 1 ? '' : 's'} con evidencia
            </div>
          </div>
          <div className="stat" style={{ background: 'var(--teal-dark)', borderColor: 'var(--teal-dark)' }}>
            <div className="stat-label" style={{ color: '#cff3ef' }}>
              Saldo disponible
            </div>
            <div className="stat-value" style={{ color: '#fff' }}>
              {money(delMes.final)}
            </div>
            <div className="small" style={{ color: '#cff3ef' }}>
              Ahorro de amenidades al cierre del mes
            </div>
          </div>
        </div>
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          Desde {nombreMes(fondo.desde).toLowerCase()}: recaudado {money(fondo.totalIngresos)} · gastado {money(fondo.totalGastos)} · ahorro actual{' '}
          <strong>{money(fondo.saldo)}</strong>. Los residentes lo ven en su portal, en Amenidades.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            Solicitudes de reservación{' '}
            {pendientes.length > 0 && (
              <span className="badge" style={{ background: 'var(--danger)', color: '#fff' }}>
                {pendientes.length} por aprobar
              </span>
            )}
          </h2>
        </div>
        <Seg
          value={filtro}
          onChange={setFiltro}
          options={[
            ['pendientes', 'Pendientes'],
            ['todas', 'Todas'],
          ]}
        />
        {lista.length ? (
          <Tarjetas>
            {lista.map((r) => {
              const cargo = montoDe(r);
              const e = estadoReserva(r);
              return (
                <Tarjeta
                  key={r.id}
                  tono={e.tono}
                  onClick={() => setFichaR(r.id)}
                  media={<TarjetaIcono name="calendar" />}
                  titulo={r.amenidad}
                  sub={`${etiqueta(r.unidadId)} · ${fecha(r.fecha, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${r.horaInicio}–${r.horaFin}`}
                  lado={
                    <>
                      <strong>{cargo ? money(cargo.monto) : 'Sin costo'}</strong>
                      {e.insignia}
                    </>
                  }
                />
              );
            })}
          </Tarjetas>
        ) : (
          <Empty icon="calendar">{filtro === 'pendientes' ? 'No hay solicitudes pendientes.' : 'Sin reservaciones.'}</Empty>
        )}
      </section>

      <section className="panel">
        <h2>En qué se usó el fondo · {nombreMes(mes)}</h2>
        {gastosMes.length ? (
          <Tarjetas>
            {gastosMes.map((e) => (
              <Tarjeta
                key={e.id}
                tono={evidenciasDe(e).length ? 'ok' : 'warn'}
                onClick={() => setFichaG(e.id)}
                media={<TarjetaIcono name="file" />}
                titulo={e.concepto}
                sub={[fecha(e.fecha), e.categoria, e.proveedor].filter(Boolean).join(' · ')}
                lado={<strong>{money(e.monto)}</strong>}
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="money">Sin gastos del fondo en {nombreMes(mes).toLowerCase()}.</Empty>
        )}
      </section>

      {fondo.meses.length > 0 && (
        <section className="panel">
          <h2>Historial del fondo</h2>
          <Tarjetas>
            {[...fondo.meses]
              .reverse()
              .slice(0, 12)
              .map((x) => (
                <Tarjeta
                  key={x.periodo}
                  tono={x.periodo === mes ? 'info' : x.final < 0 ? 'mal' : 'neutro'}
                  onClick={() => setMes(x.periodo)}
                  label={`Ver ${nombreMes(x.periodo)}`}
                  titulo={mesCorto(x.periodo)}
                  sub={`Anterior ${money(x.inicial)} · Ingresos ${money(x.ingresos)} · Gastos ${money(x.gastos)}`}
                  lado={<strong>{money(x.final)}</strong>}
                />
              ))}
          </Tarjetas>
        </section>
      )}

      {reservaF && (
        <Modal title={`${reservaF.amenidad} · ${etiqueta(reservaF.unidadId)}`} onClose={() => setFichaR(null)}>
          <div className="stack">
            <div className="row-actions">
              {estadoReserva(reservaF).insignia}
              <strong>{montoDe(reservaF) ? money(montoDe(reservaF)!.monto) : 'Sin costo'}</strong>
            </div>
            <Datos
              items={[
                ['Fecha', fecha(reservaF.fecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
                ['Horario', `${reservaF.horaInicio}–${reservaF.horaFin}`],
                ['Invitados', reservaF.invitados || null],
                ['Solicitada', fechaHora(reservaF.createdAt)],
                ['Pago', montoDe(reservaF)?.estado === 'PAGADO' ? 'Pagada' : null],
                ['Nota', reservaF.nota],
              ]}
            />
            {(() => {
              const comp = comprobanteDe(reservaF, datos.pagos);
              const botones = [];
              if (comp) botones.push(<Archivo key="c" path={comp.comprobantePath} origen={{ model: 'Pago', id: comp.id }} label={`Ver comprobante (${money(comp.monto)})`} />);
              if (comp && apruebaPagos)
                botones.push(
                  <button key="a" className="btn-app" disabled={busy} onClick={() => aprobarPago(comp, true)}>
                    <Icon name="check" />
                    Aprobar pago
                  </button>,
                  <button key="r" className="btn-app danger" disabled={busy} onClick={() => aprobarPago(comp, false)}>
                    Rechazar pago
                  </button>,
                );
              if (reservaF.estado === 'SOLICITADA' && apruebaReservas)
                botones.push(
                  <button key="ar" className="btn-app" disabled={busy} onClick={() => resolver(reservaF, 'APROBADA')}>
                    <Icon name="check" />
                    Aprobar reserva
                  </button>,
                  <button key="rr" className="btn-app danger" disabled={busy} onClick={() => resolver(reservaF, 'RECHAZADA')}>
                    Rechazar reserva
                  </button>,
                );
              return botones.length ? <Acciones>{botones}</Acciones> : null;
            })()}
          </div>
        </Modal>
      )}
      {gastoF && (
        <Modal title={gastoF.concepto} onClose={() => setFichaG(null)}>
          <div className="stack">
            <strong>{money(gastoF.monto)}</strong>
            <Datos
              items={[
                ['Fecha', fecha(gastoF.fecha)],
                ['Categoría', gastoF.categoria],
                ['Proveedor', gastoF.proveedor],
              ]}
            />
            <div className="stack" style={{ gap: 6 }}>
              <span className="acciones-titulo">Evidencia</span>
              <div className="row-actions" style={{ gap: 10 }}>
                {evidenciasDe(gastoF).map((ev) => (
                  <VerEvidencia key={ev.path} egresoId={gastoF.id} ev={ev} />
                ))}
              </div>
            </div>
            <Firma item={gastoF} altaAntes={gastoF.registradoPorNombre || gastoF.registradoPor} />
            {gestiona && (
              <Acciones>
                <button className="btn-app secondary" onClick={() => (setGasto(gastoF), setFichaG(null))}>
                  Editar
                </button>
                <button className="btn-app danger" onClick={() => borrarGasto(gastoF)}>
                  <Icon name="trash" />
                  Eliminar
                </button>
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {gasto && (
        <EditarEgreso
          e={gasto}
          fondo
          onClose={() => setGasto(null)}
          onDone={(f) => {
            setGasto(null);
            setMes(f.slice(0, 7));
            reload();
          }}
        />
      )}
    </>
  );
}
