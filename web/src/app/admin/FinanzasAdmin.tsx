import { useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { Recibo, type ReciboData } from '../Recibo';
import { Acciones, Archivo, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, Tarjeta, Tarjetas, fecha, hoy, money, periodoActual, tonoDe, useAction, useLoad } from '../ui';
import { Firma } from './Firma';
import { HistorialVista } from '../HistorialVista';
import type { DatosHistorial } from '../historialPdf';
import { ModuloInactivo, useAdmin } from './AdminApp';
import { BalanceMensual, EgresosAdmin } from './Egresos';
import { fechaIngreso } from './balance';
import { AmenidadesFinanzas, reservasPorAprobar, type ReservaFin } from './AmenidadesFinanzas';
import { TIPOS_CARGO_MANUAL, etiquetaIngreso, tipoDeCargo } from '../../../amplify/functions/shared/finanzas';
import { edicionesDe } from '../../../amplify/functions/shared/ediciones';
import { AVISO_BLOQUEO, CamposMotivo, HistorialEdiciones, PedirMotivo, motivoVacio, useBloqueoEdicion, type Motivo } from './Ediciones';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Egreso = Schema['Egreso']['type'];
type SaldoMensual = Schema['SaldoMensual']['type'];

// Finanzas en tres vistas: Ingresos (comprobantes, pagos, cargos y saldos por unidad), Egresos (gastos del
// condominio con evidencia) y Balance mensual (saldo inicial, ingresos por tipo, egresos y Excel del mes).

/** `inicio`: subpestaña de Ingresos con la que abre (notificación de comprobante → «Por aprobar»). */
export function FinanzasAdmin({ inicio }: { inicio?: 'revision' } = {}) {
  const { condo, etiqueta, unidades, puede, tiene, firmaReporte } = useAdmin();
  const id = condo!.id;
  const gestiona = puede('finanzas', 'editar');
  const valida = tiene('finanzas.validarPagos');
  const { data, error, loading, reload } = useLoad(async () => {
    const [pagos, cargos, egresos, saldos, reservas] = await Promise.all([
      all<Pago>((o) => db.models.Pago.pagosPorCondominio({ condominioId: id }, o)),
      all<Cargo>((o) => db.models.Cargo.cargosPorCondominio({ condominioId: id }, o)),
      all<Egreso>((o) => db.models.Egreso.egresosPorCondominio({ condominioId: id }, o)),
      all<SaldoMensual>((o) => db.models.SaldoMensual.saldosPorCondominio({ condominioId: id }, o)),
      adminCall<ReservaFin[]>('amenidades.reservas', { condominioId: id }),
    ]);
    return { pagos, cargos, egresos, saldos, reservas };
  }, [id]);
  const [vista, setVista] = useState<'ingresos' | 'egresos' | 'balance'>('ingresos');
  const [tab, setTab] = useState<'residentes' | 'revision' | 'pagos' | 'cargos' | 'saldos' | 'amenidades'>(inicio ?? 'residentes');
  const [generar, setGenerar] = useState(false);
  const [cobranza, setCobranza] = useState(false);
  const [excelPagos, setExcelPagos] = useState(false);
  const [cargo, setCargo] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
  const [fichaPago, setFichaPago] = useState<Pago | null>(null);
  const [fichaCargo, setFichaCargo] = useState<Cargo | null>(null);
  const [editarCargo, setEditarCargo] = useState<Cargo | null>(null);
  const [cancelarCargo, setCancelarCargo] = useState<Cargo | null>(null);
  const bloqueado = useBloqueoEdicion();
  const [historialDe, setHistorialDe] = useState<string | null>(null);
  const [filtroUnidad, setFiltroUnidad] = useState('');
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { pagos, cargos } = data!;
  const hoyStr = hoy();
  const amenidadesPend = reservasPorAprobar(data!.reservas, pagos).length;
  const revision = pagos.filter((p) => p.estado === 'EN_REVISION').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const procesados = pagos.filter((p) => p.estado !== 'EN_REVISION').sort((a, b) => String(b.validadoEn ?? b.createdAt).localeCompare(String(a.validadoEn ?? a.createdAt)));
  const cargosVista = cargos
    .filter((c) => !filtroUnidad || c.unidadId === filtroUnidad)
    .sort((a, b) => String(b.periodo ?? '').localeCompare(String(a.periodo ?? '')) || etiqueta(a.unidadId).localeCompare(etiqueta(b.unidadId), 'es', { numeric: true }));

  const validar = (p: Pago, aprobar: boolean) => {
    const nota = aprobar ? '' : prompt('Motivo del rechazo (lo verá el residente):');
    if (!aprobar && nota === null) return;
    run(() => adminCall('validarPago', { pagoId: p.id, aprobar, nota }).then(() => (setFichaPago(null), reload(true))), aprobar ? 'Pago aprobado y recibo emitido; se notificó al residente' : 'Pago rechazado; se notificó al residente');
  };
  const verRecibo = (p: Pago) => {
    const u = unidades.find((x) => x.id === p.unidadId);
    setRecibo({
      pago: { id: p.id, folio: p.folio ?? '', monto: p.monto, fecha: p.fecha ?? undefined, referencia: p.referencia ?? undefined, validadoEn: p.validadoEn ?? undefined },
      cargos: cargos.filter((c) => (p.cargoIds ?? []).includes(c.id)).map((c) => ({ id: c.id, concepto: c.concepto, monto: c.monto })),
      condominio: { nombre: condo!.nombre, direccion: condo!.direccion ?? undefined },
      unidad: { etiqueta: u?.etiqueta ?? '', propietario: u?.propietario ?? undefined },
    });
  };

  const cubre = (p: Pago) =>
    (p.cargoIds ?? []).length
      ? cargos.filter((c) => (p.cargoIds ?? []).includes(c.id)).map((c) => `${c.concepto} (${money(c.monto)})`).join(', ')
      : 'Pago a cuenta';
  const saldos = unidades
    .map((u) => {
      const pend = cargos.filter((c) => c.unidadId === u.id && c.estado === 'PENDIENTE');
      return { u, saldo: pend.reduce((s, c) => s + c.monto, 0), vencido: pend.filter((c) => c.vence && c.vence < hoyStr).reduce((s, c) => s + c.monto, 0) };
    })
    .sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo);

  return (
    <div className="stack">
      <ModuloInactivo modulo="finanzas" />
      <PageHead icon="money" title="Finanzas" sub="Ingresos, egresos y balance mensual del condominio.">
        {vista === 'ingresos' && (
          <button className="btn-app secondary" onClick={() => setCobranza(true)}>
            <Icon name="download" />
            Reporte de cobranza
          </button>
        )}
        {vista === 'ingresos' && gestiona && (
          <button className="btn-app secondary" onClick={() => setCargo(true)}>
            <Icon name="plus" />
            Cargo extraordinario
          </button>
        )}
        {vista === 'ingresos' && tiene('finanzas.generarCuotas') && (
          // Con la cuota automática activa (Condominios › Cuotas y pagos) no se generan a mano, para no duplicar ni confundir.
          <button
            className="btn-app"
            onClick={() => setGenerar(true)}
            disabled={!!condo?.cuotaAutomatica}
            title={condo?.cuotaAutomatica ? 'Las cuotas se generan automáticamente cada mes' : undefined}
          >
            <Icon name="money" />
            Generar cuotas del mes
          </button>
        )}
      </PageHead>
      {vista === 'ingresos' && tiene('finanzas.generarCuotas') && condo?.cuotaAutomatica && (
        <div className="alert small">
          Las cuotas de mantenimiento se generan automáticamente el día {condo.diaCargo ?? 1} de cada mes, por eso «Generar cuotas del mes» está desactivado. Para
          generarlas a mano, desactiva la cuota automática en Condominios › Cuotas y pagos.
        </div>
      )}
      <div className="vistas" role="tablist">
        {(
          [
            ['ingresos', 'Ingresos', 'money'],
            ['egresos', 'Egresos', 'file'],
            ['balance', 'Balance mensual', 'chart'],
          ] as const
        ).map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => setVista(k)}>
            <Icon name={icon} />
            {label}
            {k === 'ingresos' && revision.length > 0 && <span className="vistas-n">{revision.length}</span>}
          </button>
        ))}
      </div>

      {vista === 'egresos' && <EgresosAdmin datos={data!} reload={() => reload(true)} />}
      {vista === 'balance' && <BalanceMensual datos={data!} reload={() => reload(true)} />}

      {vista === 'ingresos' && (
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ['residentes', 'Residentes'],
          ['revision', `Por aprobar (${revision.length})`],
          ['pagos', 'Pagos procesados'],
          ['cargos', 'Cargos'],
          ['saldos', 'Saldos por unidad'],
          ['amenidades', amenidadesPend ? `Amenidades (${amenidadesPend})` : 'Amenidades'],
        ]}
      />
      )}

      {vista === 'ingresos' && tab === 'residentes' && <ResidentesFinanzas pagos={pagos} cargos={cargos} />}
      {vista === 'ingresos' && tab === 'amenidades' && <AmenidadesFinanzas datos={data!} reservas={data!.reservas} reload={() => reload(true)} />}

      {vista === 'ingresos' && tab === 'revision' && (
        <section className="panel">
          {revision.length ? (
            <Tarjetas>
              {revision.map((p) => (
                <Tarjeta
                  key={p.id}
                  tono="warn"
                  onClick={() => setFichaPago(p)}
                  titulo={etiqueta(p.unidadId)}
                  sub={`Pagado el ${fecha(p.fecha)} · Enviado ${fecha(p.createdAt)} · ${cubre(p)}`}
                  lado={
                    <>
                      <strong>{money(p.monto)}</strong>
                      <Badge estado="EN_REVISION">Por aprobar</Badge>
                    </>
                  }
                />
              ))}
            </Tarjetas>
          ) : (
            <Empty icon="check">No hay comprobantes pendientes de aprobar.</Empty>
          )}
        </section>
      )}

      {vista === 'ingresos' && tab === 'pagos' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Pagos procesados</h2>
            <button className="btn-app sm secondary" disabled={!procesados.length} onClick={() => setExcelPagos(true)}>
              <Icon name="download" />
              Descargar Excel
            </button>
          </div>
          {procesados.length ? (
            <Tarjetas>
              {procesados.map((p) => (
                <Tarjeta
                  key={p.id}
                  tono={tonoDe(p.estado)}
                  onClick={() => setFichaPago(p)}
                  titulo={etiqueta(p.unidadId)}
                  sub={`${p.folio ? `${p.folio} · ` : ''}Pagado el ${fecha(p.fecha)}`}
                  lado={
                    <>
                      <strong>{money(p.monto)}</strong>
                      <Badge estado={p.estado} />
                    </>
                  }
                />
              ))}
            </Tarjetas>
          ) : (
            <Empty icon="money">Sin pagos procesados.</Empty>
          )}
        </section>
      )}

      {vista === 'ingresos' && tab === 'cargos' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Cargos</h2>
            <select className="input" style={{ maxWidth: 220 }} value={filtroUnidad} onChange={(e) => setFiltroUnidad(e.target.value)}>
              <option value="">Todas las unidades</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </div>
          {cargosVista.length ? (
            <Tarjetas>
              {cargosVista.map((c) => {
                const vencido = c.estado === 'PENDIENTE' && !!c.vence && c.vence < hoyStr;
                return (
                  <Tarjeta
                    key={c.id}
                    tono={vencido ? 'mal' : tonoDe(c.estado)}
                    onClick={() => setFichaCargo(c)}
                    titulo={`${etiqueta(c.unidadId)} · ${c.concepto}`}
                    sub={`${etiquetaIngreso(tipoDeCargo(c))} · Vence ${fecha(c.vence)}`}
                    lado={
                      <>
                        <strong>{money(c.monto)}</strong>
                        <Badge estado={vencido ? 'VENCIDO' : c.estado}>{vencido ? 'Vencido' : undefined}</Badge>
                        {edicionesDe(c.ediciones).length > 0 && <span className="badge">Editado</span>}
                      </>
                    }
                  />
                );
              })}
            </Tarjetas>
          ) : (
            <Empty icon="money">Sin cargos. Genera las cuotas del mes.</Empty>
          )}
        </section>
      )}

      {vista === 'ingresos' && tab === 'saldos' && (
        <section className="panel">
          <Tarjetas>
            {saldos.map(({ u, saldo, vencido }) => (
              <Tarjeta
                key={u.id}
                tono={vencido > 0 ? 'mal' : saldo > 0 ? 'warn' : 'ok'}
                onClick={() => setHistorialDe(u.id)}
                label={`Ver historial de pagos de ${u.etiqueta}`}
                titulo={u.etiqueta}
                sub={u.propietario ?? undefined}
                lado={
                  <>
                    <strong>{money(saldo)}</strong>
                    {vencido > 0 ? (
                      <Badge estado="VENCIDO">{`Vencido ${money(vencido)}`}</Badge>
                    ) : (
                      <Badge estado={saldo > 0 ? 'PENDIENTE' : 'PAGADO'}>{saldo > 0 ? 'Por vencer' : 'Al corriente'}</Badge>
                    )}
                  </>
                }
              />
            ))}
          </Tarjetas>
        </section>
      )}

      {historialDe && (
        <HistorialVista
          datos={{
            condominio: condo!.nombre,
            direccion: condo!.direccion,
            unidad: etiqueta(historialDe),
            residente: unidades.find((u) => u.id === historialDe)?.propietario,
            cargos: cargos.filter((c) => c.unidadId === historialDe),
            pagos: pagos.filter((p) => p.unidadId === historialDe),
            hoy: hoyStr,
            generadoPor: firmaReporte,
          }}
          onClose={() => setHistorialDe(null)}
        />
      )}
      {fichaPago && (
        <Modal title={`${fichaPago.estado === 'EN_REVISION' ? 'Comprobante' : 'Pago'} · ${etiqueta(fichaPago.unidadId)}`} onClose={() => setFichaPago(null)}>
          <div className="stack">
            <div className="row-actions">
              <Badge estado={fichaPago.estado} />
              <strong>{money(fichaPago.monto)}</strong>
            </div>
            <Datos
              items={[
                ['Folio de recibo', fichaPago.folio],
                ['Fecha de pago', fecha(fichaPago.fecha)],
                ['Enviado', fecha(fichaPago.createdAt)],
                ['Referencia', fichaPago.referencia],
                ['Cubre', cubre(fichaPago)],
                ['Motivo del rechazo', fichaPago.estado === 'RECHAZADO' ? fichaPago.nota : null],
              ]}
            />
            <Firma
              item={fichaPago}
              alta={false}
              antes={{ verbo: fichaPago.estado === 'RECHAZADO' ? 'Rechazado por' : 'Aprobado por', por: fichaPago.validadoPor, en: fichaPago.validadoEn }}
            />
            <Acciones>
              <Archivo path={fichaPago.comprobantePath} origen={{ model: 'Pago', id: fichaPago.id }} label="Ver comprobante" />
              {fichaPago.estado === 'VALIDADO' && (
                <button className="btn-app secondary" onClick={() => (verRecibo(fichaPago), setFichaPago(null))}>
                  <Icon name="file" />
                  Ver recibo
                </button>
              )}
              {fichaPago.estado === 'EN_REVISION' && valida && (
                <>
                  <button className="btn-app" disabled={busy} onClick={() => validar(fichaPago, true)}>
                    <Icon name="check" />
                    Aprobar
                  </button>
                  <button className="btn-app danger" disabled={busy} onClick={() => validar(fichaPago, false)}>
                    Rechazar
                  </button>
                </>
              )}
            </Acciones>
          </div>
        </Modal>
      )}
      {fichaCargo && (
        <Modal title={`${etiqueta(fichaCargo.unidadId)} · ${fichaCargo.concepto}`} onClose={() => setFichaCargo(null)}>
          <div className="stack">
            <div className="row-actions">
              <Badge estado={fichaCargo.estado === 'PENDIENTE' && fichaCargo.vence && fichaCargo.vence < hoyStr ? 'VENCIDO' : fichaCargo.estado} />
              <strong>{money(fichaCargo.monto)}</strong>
            </div>
            <Datos
              items={[
                ['Tipo', etiquetaIngreso(tipoDeCargo(fichaCargo))],
                ['Periodo', fichaCargo.periodo],
                ['Vence', fecha(fichaCargo.vence)],
              ]}
            />
            <Firma item={fichaCargo} alta="Generado por" />
            <HistorialEdiciones item={fichaCargo} />
            {gestiona && fichaCargo.estado === 'PENDIENTE' &&
              (bloqueado(fichaCargo) ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {AVISO_BLOQUEO}
                </p>
              ) : (
                <Acciones>
                  <button className="btn-app secondary" disabled={busy} onClick={() => (setEditarCargo(fichaCargo), setFichaCargo(null))}>
                    Editar
                  </button>
                  <button className="btn-app danger" disabled={busy} onClick={() => (setCancelarCargo(fichaCargo), setFichaCargo(null))}>
                    Cancelar cargo
                  </button>
                </Acciones>
              ))}
          </div>
        </Modal>
      )}
      {editarCargo && <EditarCargo c={editarCargo} onClose={() => setEditarCargo(null)} onDone={() => (setEditarCargo(null), reload(true))} />}
      {cancelarCargo && (
        <PedirMotivo
          titulo="Cancelar cargo"
          texto={
            <>
              Se cancela <strong>{cancelarCargo.concepto}</strong> de {etiqueta(cancelarCargo.unidadId)} por {money(cancelarCargo.monto)}. Queda en su historial
              con tu nombre y el motivo.
            </>
          }
          boton="Cancelar cargo"
          peligro
          onClose={() => setCancelarCargo(null)}
          onConfirmar={async (m) => {
            await adminCall('cargos.cancelar', { id: cancelarCargo.id, ...m });
            reload(true);
          }}
        />
      )}
      {excelPagos && <ExcelPagos pagos={procesados} cargos={cargos} onClose={() => setExcelPagos(false)} />}
      {cobranza && <ReporteCobranza pagos={pagos} cargos={cargos} onClose={() => setCobranza(false)} />}
      {generar && <GenerarCuotas onClose={() => setGenerar(false)} onDone={() => (setGenerar(false), setTab('cargos'), reload(true))} />}
      {cargo && <NuevoCargo onClose={() => setCargo(false)} onDone={() => (setCargo(false), setTab('cargos'), reload(true))} />}
      {recibo && (
        <Modal title={`Recibo ${recibo.pago.folio}`} onClose={() => setRecibo(null)} wide>
          <Recibo data={recibo} />
        </Modal>
      )}
    </div>
  );
}

function GenerarCuotas({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId, unidades } = useAdmin();
  const p = periodoActual();
  const [f, setF] = useState({ periodo: p, vence: `${p}-10`, concepto: '' });
  const { run, busy } = useAction();
  const conCuota = unidades.filter((u) => (u.cuota ?? 0) > 0).length;
  async function generar(e: React.FormEvent) {
    e.preventDefault();
    let r: { creados: number; omitidos: number } | undefined;
    const okk = await run(async () => {
      r = await adminCall('generarCargos', { condominioId: condoId, ...f });
    });
    if (okk && r) {
      alert(`Cuotas generadas: ${r.creados}. Omitidas (sin cuota o ya generadas): ${r.omitidos}.`);
      onDone();
    }
  }
  return (
    <Modal title="Generar cuotas de mantenimiento" onClose={onClose}>
      <form className="form" onSubmit={generar}>
        <p className="small muted" style={{ margin: 0 }}>
          Se crea un cargo por cada unidad con cuota mensual ({conCuota} de {unidades.length}). Si ya existe la cuota de ese periodo para una
          unidad, se omite.
        </p>
        <div className="form-2">
          <Field label="Periodo">
            <input required type="month" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value, vence: `${e.target.value}-10` })} />
          </Field>
          <Field label="Fecha límite de pago">
            <input required type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
          </Field>
        </div>
        <Field label="Concepto (opcional)">
          <input maxLength={120} placeholder={`Cuota de mantenimiento ${f.periodo}`} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />
        </Field>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Generando…' : 'Generar cuotas'}
        </button>
      </form>
    </Modal>
  );
}

function NuevoCargo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId, unidades } = useAdmin();
  const [f, setF] = useState({ unidadId: '', concepto: '', monto: '', vence: hoy(), todas: false, tipo: 'OTRO' });
  const { run, busy } = useAction();
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const destino = f.todas ? unidades : unidades.filter((u) => u.id === f.unidadId);
    const okk = await run(async () => {
      if (!destino.length) throw new Error('Selecciona la unidad.');
      for (const u of destino) {
        ok(
          await db.models.Cargo.create({
            condominioId: condoId,
            unidadId: u.id,
            concepto: f.concepto,
            monto: Number(f.monto),
            vence: f.vence,
            periodo: f.vence.slice(0, 7),
            estado: 'PENDIENTE',
            tipo: f.tipo,
          }),
        );
      }
    }, `Cargo creado para ${destino.length} unidad(es)`);
    if (okk) onDone();
  }
  return (
    <Modal title="Cargo extraordinario" onClose={onClose}>
      <form className="form" onSubmit={crear}>
        <label className="check">
          <input type="checkbox" checked={f.todas} onChange={(e) => setF({ ...f, todas: e.target.checked })} />
          Aplicar a todas las unidades
        </label>
        {!f.todas && (
          <Field label="Unidad">
            <select required value={f.unidadId} onChange={(e) => setF({ ...f, unidadId: e.target.value })}>
              <option value="">Selecciona…</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Concepto">
          <input required maxLength={120} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Multa, cuota extraordinaria, renta de salón…" />
        </Field>
        <TipoIngreso value={f.tipo} onChange={(tipo) => setF({ ...f, tipo })} />
        <div className="form-2">
          <Field label="Monto (MXN)">
            <input required type="number" min="0.01" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} />
          </Field>
          <Field label="Vence">
            <input required type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
          </Field>
        </div>
        <button className="btn-app" disabled={busy}>
          Crear cargo
        </button>
      </form>
    </Modal>
  );
}

/** Editar un cargo pendiente: monto, concepto, vencimiento y tipo (solo cargos manuales), con su motivo. */
function EditarCargo({ c, onClose, onDone }: { c: Cargo; onClose: () => void; onDone: () => void }) {
  const { etiqueta } = useAdmin();
  const manual = !!c.tipo && (TIPOS_CARGO_MANUAL as readonly string[]).includes(c.tipo);
  const [f, setF] = useState({ concepto: c.concepto, monto: String(c.monto), vence: c.vence ?? '', tipo: c.tipo ?? 'OTRO' });
  const [m, setM] = useState<Motivo>(motivoVacio);
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { id: c.id, concepto: f.concepto, monto: Number(f.monto), vence: f.vence || null, ...(manual ? { tipo: f.tipo } : {}), ...m };
    if (await run(() => adminCall('cargos.editar', datos), 'Cargo actualizado; el cambio quedó en su historial')) onDone();
  }
  return (
    <Modal title={`Editar cargo · ${etiqueta(c.unidadId)}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Concepto">
          <input required maxLength={200} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />
        </Field>
        {manual && <TipoIngreso value={f.tipo} onChange={(tipo) => setF({ ...f, tipo })} />}
        <div className="form-2">
          <Field label={`Monto (antes ${money(c.monto)})`}>
            <input required type="number" min="0.01" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} />
          </Field>
          <Field label="Vence">
            <input type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
          </Field>
        </div>
        <CamposMotivo value={m} onChange={setM} />
        <div className="alert small" style={{ margin: 0 }}>
          El cambio queda registrado con tu nombre, la fecha, el motivo y lo que cambió. Después, solo un superadministrador puede volver a modificar este
          cargo.
        </div>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </Modal>
  );
}

/** Tipo de ingreso del cargo: con él se separan los ingresos en el balance mensual. */
export function TipoIngreso({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Tipo de ingreso" hint="Así se separa en el balance mensual.">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {TIPOS_CARGO_MANUAL.map((t) => (
          <option key={t} value={t}>
            {etiquetaIngreso(t)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Reporte de cobranza en Excel: pagados, por aprobar y sin pago del mes, morosos y estado por unidad. */
function ReporteCobranza({ pagos, cargos, onClose }: { pagos: Pago[]; cargos: Cargo[]; onClose: () => void }) {
  const { condo, unidades, firmaReporte } = useAdmin();
  const [periodo, setPeriodo] = useState(periodoActual());
  const { run, busy } = useAction();
  async function descargar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      const [{ descargarReporteCobranza }, contactos] = await Promise.all([
        import('./reporteCobranza'),
        adminCall<Record<string, { nombre: string | null; telefono: string | null; email: string }[]>>('finanzas.contactos', { condominioId: condo!.id }),
      ]);
      await descargarReporteCobranza({
        condominio: condo!.nombre,
        periodo,
        diaVencimiento: condo!.diaVencimiento,
        hoy: hoy(),
        unidades,
        cargos,
        pagos,
        contactos,
        generadoPor: firmaReporte,
      });
    }, 'Reporte de cobranza descargado');
    if (okk) onClose();
  }
  return (
    <Modal title="Reporte de cobranza" onClose={onClose}>
      <form className="form" onSubmit={descargar}>
        <p className="small muted" style={{ margin: 0 }}>
          Excel con todas las casas o departamentos: lo pagado con recibo aprobado, lo que tiene comprobante por aprobar y lo que no se ha pagado en el mes, con
          sus sumas; la lista de residentes morosos con lo que deben a la fecha, y el estado de cuenta de cada unidad.
        </p>
        <Field label="Mes">
          <input required type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
        </Field>
        <button className="btn-app" disabled={busy}>
          <Icon name="download" />
          {busy ? 'Generando…' : 'Descargar Excel'}
        </button>
      </form>
    </Modal>
  );
}

/** Excel de pagos procesados (aprobados y rechazados) en un rango de meses, con el formato de los reportes SIIA. */
function ExcelPagos({ pagos, cargos, onClose }: { pagos: Pago[]; cargos: Cargo[]; onClose: () => void }) {
  const { condo, unidades, firmaReporte } = useAdmin();
  const hasta0 = periodoActual();
  const primero = pagos.map((p) => fechaIngreso(p).slice(0, 7)).sort()[0] ?? hasta0;
  const [desde, setDesde] = useState(primero < hasta0 ? primero : hasta0);
  const [hasta, setHasta] = useState(hasta0);
  const { run, busy } = useAction();
  async function descargar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      const [{ descargarPagosExcel }, contactos] = await Promise.all([
        import('./excelPagos'),
        adminCall<Record<string, { nombre: string | null; telefono: string | null; email: string }[]>>('finanzas.contactos', { condominioId: condo!.id }),
      ]);
      await descargarPagosExcel({
        condominio: condo!.nombre,
        desde: desde <= hasta ? desde : hasta,
        hasta: desde <= hasta ? hasta : desde,
        hoy: hoy(),
        unidades,
        pagos,
        cargos,
        contactos,
        generadoPor: firmaReporte,
      });
    }, 'Excel de pagos procesados descargado');
    if (okk) onClose();
  }
  return (
    <Modal title="Excel de pagos procesados" onClose={onClose}>
      <form className="form" onSubmit={descargar}>
        <p className="small muted" style={{ margin: 0 }}>
          Cada pago aprobado o rechazado del periodo con su folio, unidad, residente, conceptos, monto y quién lo revisó; además un resumen por mes y otro por casa
          o departamento.
        </p>
        <div className="grid-2">
          <Field label="Desde">
            <input required type="month" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input required type="month" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
        </div>
        <button className="btn-app" disabled={busy}>
          <Icon name="download" />
          {busy ? 'Generando…' : 'Descargar Excel'}
        </button>
      </form>
    </Modal>
  );
}

/** Ingresos › Residentes: cada casa o departamento con su residente; al tocarla se ve su historial de pagos y recibos, y se descargan en PDF. */
function ResidentesFinanzas({ pagos, cargos }: { pagos: Pago[]; cargos: Cargo[] }) {
  const { condo, unidades, firmaReporte } = useAdmin();
  const contactos = useLoad(
    () => adminCall<Record<string, { nombre: string | null; telefono: string | null; email: string }[]>>('finanzas.contactos', { condominioId: condo!.id }),
    [condo!.id],
  );
  const [buscar, setBuscar] = useState('');
  const [historial, setHistorial] = useState<DatosHistorial | null>(null);
  const nombre = (u: (typeof unidades)[number]) =>
    (contactos.data?.[u.id] ?? []).map((x) => x.nombre || x.email).join(', ') || u.propietario || '';
  const q = buscar.trim().toLowerCase();
  const lista = unidades.filter((u) => !q || `${u.etiqueta} ${nombre(u)}`.toLowerCase().includes(q));
  const h = hoy();
  // Lo vencido sin pagar (mismo criterio que Residentes): para saber de un vistazo quién está al corriente.
  const vencidoDe = (id: string) => cargos.filter((c) => c.unidadId === id && c.estado === 'PENDIENTE' && c.vence && c.vence < h).reduce((s, c) => s + c.monto, 0);

  const abrir = (u: (typeof unidades)[number]) =>
    setHistorial({
      condominio: condo!.nombre,
      direccion: condo!.direccion,
      unidad: u.etiqueta,
      residente: nombre(u),
      cargos: cargos.filter((c) => c.unidadId === u.id),
      pagos: pagos.filter((p) => p.unidadId === u.id),
      hoy: h,
      generadoPor: firmaReporte,
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Residentes</h2>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Buscar casa o nombre…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      {contactos.loading && !contactos.data ? (
        <Loading />
      ) : lista.length ? (
        <Tarjetas>
          {lista.map((u) => {
            const vencido = vencidoDe(u.id);
            return (
              <Tarjeta
                key={u.id}
                tono={vencido > 0 ? 'mal' : 'ok'}
                onClick={() => abrir(u)}
                label={`Ver historial de pagos de ${u.etiqueta}`}
                titulo={u.etiqueta}
                sub={nombre(u) || 'Sin residente registrado'}
                lado={<span className={`pill ${vencido > 0 ? 'mal' : 'ok'}`}>{vencido > 0 ? `Debe ${money(vencido)}` : 'Al corriente'}</span>}
              />
            );
          })}
        </Tarjetas>
      ) : (
        <Empty icon="building">{q ? 'Sin resultados.' : 'El condominio no tiene casas o departamentos.'}</Empty>
      )}
      {historial && <HistorialVista datos={historial} onClose={() => setHistorial(null)} />}
    </section>
  );
}
