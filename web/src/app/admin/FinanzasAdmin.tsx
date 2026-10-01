import { useState } from 'react';
import { adminCall, all, client, ok, type Schema } from '../api';
import { Recibo, type ReciboData } from '../Recibo';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, fecha, hoy, money, periodoActual, useAction, useLoad } from '../ui';
import { ModuloInactivo, useAdmin } from './AdminApp';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];

export function FinanzasAdmin() {
  const { condo, etiqueta, unidades } = useAdmin();
  const id = condo!.id;
  const { data, error, loading, reload } = useLoad(async () => {
    const [pagos, cargos] = await Promise.all([
      all<Pago>((o) => client.models.Pago.pagosPorCondominio({ condominioId: id }, o)),
      all<Cargo>((o) => client.models.Cargo.cargosPorCondominio({ condominioId: id }, o)),
    ]);
    return { pagos, cargos };
  }, [id]);
  const [tab, setTab] = useState<'revision' | 'pagos' | 'cargos' | 'saldos'>('revision');
  const [generar, setGenerar] = useState(false);
  const [cargo, setCargo] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
  const [filtroUnidad, setFiltroUnidad] = useState('');
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { pagos, cargos } = data!;
  const hoyStr = hoy();
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
      ok(await client.models.Cargo.update({ id: c.id, estado: 'CANCELADO' }));
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
      <PageHead icon="money" title="Finanzas" sub="Validación de comprobantes, cuotas, cargos y morosidad.">
        <button className="btn-app secondary" onClick={() => setCargo(true)}>
          <Icon name="plus" />
          Cargo extraordinario
        </button>
        <button className="btn-app" onClick={() => setGenerar(true)}>
          <Icon name="money" />
          Generar cuotas del mes
        </button>
      </PageHead>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ['revision', `Por aprobar (${revision.length})`],
          ['pagos', 'Pagos procesados'],
          ['cargos', 'Cargos'],
          ['saldos', 'Saldos por unidad'],
        ]}
      />

      {tab === 'revision' && (
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
                    <Archivo path={p.comprobantePath} label="Ver comprobante" />
                  </div>
                  <div className="row-actions">
                    <button className="btn-app sm" disabled={busy} onClick={() => validar(p, true)}>
                      <Icon name="check" />
                      Aprobar
                    </button>
                    <button className="btn-app sm danger" disabled={busy} onClick={() => validar(p, false)}>
                      Rechazar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="check">No hay comprobantes pendientes de aprobar.</Empty>
          )}
        </section>
      )}

      {tab === 'pagos' && (
        <section className="panel">
          {procesados.length ? (
            <div className="table-wrap">
              <table className="tbl">
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
                      <td>{p.folio ?? '—'}</td>
                      <td>{etiqueta(p.unidadId)}</td>
                      <td>{fecha(p.fecha)}</td>
                      <td className="num">{money(p.monto)}</td>
                      <td>
                        <Badge estado={p.estado} />
                      </td>
                      <td>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Archivo path={p.comprobantePath} label="Comprobante" />
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

      {tab === 'cargos' && (
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
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th>Concepto</th>
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
                        <td>{etiqueta(c.unidadId)}</td>
                        <td>{c.concepto}</td>
                        <td>{fecha(c.vence)}</td>
                        <td className="num">{money(c.monto)}</td>
                        <td>
                          <Badge estado={vencido ? 'VENCIDO' : c.estado}>{vencido ? 'Vencido' : undefined}</Badge>
                        </td>
                        <td>
                          {c.estado === 'PENDIENTE' && (
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

      {tab === 'saldos' && (
        <section className="panel">
          <div className="table-wrap">
            <table className="tbl">
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
                    <td>{u.etiqueta}</td>
                    <td>{u.propietario ?? '—'}</td>
                    <td className="num">{money(saldo)}</td>
                    <td className="num" style={{ color: vencido ? 'var(--danger)' : undefined }}>
                      {money(vencido)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
  const [f, setF] = useState({ unidadId: '', concepto: '', monto: '', vence: hoy(), todas: false });
  const { run, busy } = useAction();
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const destino = f.todas ? unidades : unidades.filter((u) => u.id === f.unidadId);
    const okk = await run(async () => {
      if (!destino.length) throw new Error('Selecciona la unidad.');
      for (const u of destino) {
        ok(
          await client.models.Cargo.create({
            condominioId: condoId,
            unidadId: u.id,
            concepto: f.concepto,
            monto: Number(f.monto),
            vence: f.vence,
            periodo: f.vence.slice(0, 7),
            estado: 'PENDIENTE',
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
