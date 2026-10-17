import { useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { Recibo, type ReciboData } from '../Recibo';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, fecha, hoy, money, periodoActual, useAction, useLoad } from '../ui';
import { ModuloInactivo, useAdmin } from './AdminApp';
import { BalanceMensual, EgresosAdmin } from './Egresos';
import { AmenidadesFinanzas, reservasPorAprobar, type ReservaFin } from './AmenidadesFinanzas';
import { TIPOS_CARGO_MANUAL, etiquetaIngreso, tipoDeCargo } from '../../../amplify/functions/shared/finanzas';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Egreso = Schema['Egreso']['type'];
type SaldoMensual = Schema['SaldoMensual']['type'];

// Finanzas en tres vistas: Ingresos (comprobantes, pagos, cargos y saldos por unidad), Egresos (gastos del
// condominio con evidencia) y Balance mensual (saldo inicial, ingresos por tipo, egresos y Excel del mes).

/** `inicio`: subpestaña de Ingresos con la que abre (notificación de comprobante → «Por aprobar»). */
export function FinanzasAdmin({ inicio }: { inicio?: 'revision' } = {}) {
  const { condo, etiqueta, unidades, puede, tiene } = useAdmin();
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
  const [cargo, setCargo] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
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
    run(() => adminCall('validarPago', { pagoId: p.id, aprobar, nota }).then(() => reload(true)), aprobar ? 'Pago aprobado y recibo emitido; se notificó al residente' : 'Pago rechazado; se notificó al residente');
  };
  const cancelarCargo = (c: Cargo) =>
    confirm(`¿Cancelar el cargo "${c.concepto}" de ${etiqueta(c.unidadId)}?`) &&
    run(async () => {
      ok(await db.models.Cargo.update({ id: c.id, estado: 'CANCELADO' }));
      reload(true);
    }, 'Cargo cancelado');
  const verRecibo = (p: Pago) => {
    const u = unidades.find((x) => x.id === p.unidadId);
    setRecibo({
      pago: { id: p.id, folio: p.folio ?? '', monto: p.monto, fecha: p.fecha ?? undefined, referencia: p.referencia ?? undefined, validadoEn: p.validadoEn ?? undefined },
      cargos: cargos.filter((c) => (p.cargoIds ?? []).includes(c.id)).map((c) => ({ id: c.id, concepto: c.concepto, monto: c.monto })),
      condominio: { nombre: condo!.nombre, direccion: condo!.direccion ?? undefined },
      unidad: { etiqueta: u?.etiqueta ?? '', propietario: u?.propietario ?? undefined },
    });
  };

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
          <button className="btn-app" onClick={() => setGenerar(true)}>
            <Icon name="money" />
            Generar cuotas del mes
          </button>
        )}
      </PageHead>
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
            <ul className="list">
              {revision.map((p) => (
                <li key={p.id}>
                  <div className="list-main">
                    <strong>
                      {etiqueta(p.unidadId)} · {money(p.monto)}
                    </strong>
                    <div className="list-sub">
                      Pagado el {fecha(p.fecha)} {p.referencia && `· Ref. ${p.referencia}`} · Enviado {fecha(p.createdAt)}
                    </div>
                    <div className="list-sub">
                      Cubre:{' '}
                      {(p.cargoIds ?? []).length
                        ? cargos.filter((c) => (p.cargoIds ?? []).includes(c.id)).map((c) => `${c.concepto} (${money(c.monto)})`).join(', ')
                        : 'pago a cuenta'}
                    </div>
                    <Archivo path={p.comprobantePath} origen={{ model: 'Pago', id: p.id }} label="Ver comprobante" />
                  </div>
                  {valida && (
                    <div className="row-actions">
                      <button className="btn-app sm" disabled={busy} onClick={() => validar(p, true)}>
                        <Icon name="check" />
                        Aprobar
                      </button>
                      <button className="btn-app sm danger" disabled={busy} onClick={() => validar(p, false)}>
                        Rechazar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="check">No hay comprobantes pendientes de aprobar.</Empty>
          )}
        </section>
      )}

      {vista === 'ingresos' && tab === 'pagos' && (
        <section className="panel">
          {procesados.length ? (
            <div className="table-wrap">
              <table className="tbl tbl-tarjetas">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Unidad</th>
                    <th>Fecha</th>
                    <th className="num">Monto</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {procesados.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Folio">{p.folio ?? '—'}</td>
                      <td className="tt-titulo">{etiqueta(p.unidadId)}</td>
                      <td data-label="Fecha">{fecha(p.fecha)}</td>
                      <td className="num" data-label="Monto">{money(p.monto)}</td>
                      <td data-label="Estado">
                        <Badge estado={p.estado} />
                      </td>
                      <td className="tt-acciones">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Archivo path={p.comprobantePath} origen={{ model: 'Pago', id: p.id }} label="Comprobante" />
                          {p.estado === 'VALIDADO' && (
                            <button className="linklike" onClick={() => verRecibo(p)}>
                              Recibo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="table-wrap">
              <table className="tbl tbl-tarjetas">
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th>Concepto</th>
                    <th>Tipo</th>
                    <th>Vence</th>
                    <th className="num">Monto</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cargosVista.map((c) => {
                    const vencido = c.estado === 'PENDIENTE' && c.vence && c.vence < hoyStr;
                    return (
                      <tr key={c.id}>
                        <td className="tt-titulo">{etiqueta(c.unidadId)}</td>
                        <td data-label="Concepto">{c.concepto}</td>
                        <td className="small" data-label="Tipo">{etiquetaIngreso(tipoDeCargo(c))}</td>
                        <td data-label="Vence">{fecha(c.vence)}</td>
                        <td className="num" data-label="Monto">{money(c.monto)}</td>
                        <td data-label="Estado">
                          <Badge estado={vencido ? 'VENCIDO' : c.estado}>{vencido ? 'Vencido' : undefined}</Badge>
                        </td>
                        <td className="tt-acciones">
                          {gestiona && c.estado === 'PENDIENTE' && (
                            <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => cancelarCargo(c)}>
                              Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="money">Sin cargos. Genera las cuotas del mes.</Empty>
          )}
        </section>
      )}

      {vista === 'ingresos' && tab === 'saldos' && (
        <section className="panel">
          <div className="table-wrap">
            <table className="tbl tbl-tarjetas">
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Propietario</th>
                  <th className="num">Saldo</th>
                  <th className="num">Vencido</th>
                </tr>
              </thead>
              <tbody>
                {saldos.map(({ u, saldo, vencido }) => (
                  <tr key={u.id}>
                    <td className="tt-titulo">{u.etiqueta}</td>
                    <td data-label="Propietario">{u.propietario ?? '—'}</td>
                    <td className="num" data-label="Saldo">{money(saldo)}</td>
                    <td className="num" data-label="Vencido" style={{ color: vencido ? 'var(--danger)' : undefined }}>
                      {money(vencido)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
  const { condo, unidades } = useAdmin();
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

/** Ingresos › Residentes: cada casa o departamento con su residente y su historial de pagos en PDF. */
function ResidentesFinanzas({ pagos, cargos }: { pagos: Pago[]; cargos: Cargo[] }) {
  const { condo, unidades } = useAdmin();
  const contactos = useLoad(
    () => adminCall<Record<string, { nombre: string | null; telefono: string | null; email: string }[]>>('finanzas.contactos', { condominioId: condo!.id }),
    [condo!.id],
  );
  const [buscar, setBuscar] = useState('');
  const [bajando, setBajando] = useState<string | null>(null);
  const { run } = useAction();
  const nombre = (u: (typeof unidades)[number]) =>
    (contactos.data?.[u.id] ?? []).map((x) => x.nombre || x.email).join(', ') || u.propietario || '';
  const q = buscar.trim().toLowerCase();
  const lista = unidades.filter((u) => !q || `${u.etiqueta} ${nombre(u)}`.toLowerCase().includes(q));

  const historial = (u: (typeof unidades)[number]) =>
    run(async () => {
      setBajando(u.id);
      try {
        const { descargarHistorial } = await import('../historialPdf');
        await descargarHistorial({
          condominio: condo!.nombre,
          direccion: condo!.direccion,
          unidad: u.etiqueta,
          residente: nombre(u),
          cargos: cargos.filter((c) => c.unidadId === u.id),
          pagos: pagos.filter((p) => p.unidadId === u.id),
          hoy: hoy(),
        });
      } finally {
        setBajando(null);
      }
    }, `Historial de ${u.etiqueta} descargado`);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Residentes</h2>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Buscar casa o nombre…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      {contactos.loading && !contactos.data ? (
        <Loading />
      ) : lista.length ? (
        <ul className="list">
          {lista.map((u) => (
            <li key={u.id}>
              <div className="list-main">
                <strong>{u.etiqueta}</strong>
                <div className="list-sub">{nombre(u) || 'Sin residente registrado'}</div>
              </div>
              <button className="btn-app sm secondary" disabled={bajando === u.id} onClick={() => historial(u)}>
                <Icon name="download" />
                {bajando === u.id ? 'Generando…' : 'Historial de pagos (PDF)'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="building">{q ? 'Sin resultados.' : 'El condominio no tiene casas o departamentos.'}</Empty>
      )}
    </section>
  );
}
