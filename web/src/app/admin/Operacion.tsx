import { useState } from 'react';
import { adminCall, all, client, ok, type Schema } from '../api';
import { Archivo, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, etiquetaEstado, fecha, fechaHora, hoy, money, useAction, useLoad } from '../ui';
import { ModuloInactivo, useAdmin } from './AdminApp';

type Incidente = Schema['Incidente']['type'];
type Mantenimiento = Schema['Mantenimiento']['type'];
type Amenidad = Schema['Amenidad']['type'];
type Reserva = Schema['Reserva']['type'];
type Visita = Schema['Visita']['type'];
type Mascota = Schema['Mascota']['type'];

const avisar = (condominioId: string, unidadId: string, titulo: string, texto?: string | null, tipo = 'ADMIN') =>
  adminCall('avisar', { condominioId, unidadId, titulo, texto, tipo }).catch(() => undefined);

const porFecha = <T extends { createdAt: string }>(a: T, b: T) => String(b.createdAt).localeCompare(String(a.createdAt));

// ---------- Incidentes ----------
export function IncidentesAdmin() {
  const { condo, etiqueta } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Incidente>((o) => client.models.Incidente.incidentesPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [filtro, setFiltro] = useState<'abiertos' | 'todos'>('abiertos');
  const [atender, setAtender] = useState<Incidente | null>(null);

  const lista = (data ?? []).filter((i) => filtro === 'todos' || i.estado === 'ABIERTO' || i.estado === 'EN_PROCESO').sort(porFecha);
  return (
    <div className="stack">
      <ModuloInactivo modulo="incidentes" />
      <PageHead icon="alert" title="Incidentes" sub="Reportes de los residentes." />
      <Seg value={filtro} onChange={setFiltro} options={[['abiertos', 'Abiertos'], ['todos', 'Todos']]} />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <ul className="list">
              {lista.map((i) => (
                <li key={i.id}>
                  <Archivo path={i.fotoPath} thumb />
                  <div className="list-main">
                    <strong>{i.titulo}</strong> <Badge estado={i.estado} />
                    <div className="list-sub">
                      {etiqueta(i.unidadId)} · {i.categoria} · {fechaHora(i.createdAt)} {i.ubicacion && `· ${i.ubicacion}`}
                    </div>
                    {i.descripcion && <div className="small pre">{i.descripcion}</div>}
                    {i.respuesta && <div className="small muted">Respuesta: {i.respuesta}</div>}
                    <Archivo path={i.fotoPath} label="Ver foto" />
                  </div>
                  <button className="btn-app sm secondary" onClick={() => setAtender(i)}>
                    Atender
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="alert">Sin incidentes {filtro === 'abiertos' ? 'abiertos' : ''}.</Empty>
          )}
        </section>
      )}
      {atender && <Atender i={atender} onClose={() => setAtender(null)} onDone={() => (setAtender(null), reload(true))} />}
    </div>
  );
}

function Atender({ i, onClose, onDone }: { i: Incidente; onClose: () => void; onDone: () => void }) {
  const [estado, setEstado] = useState(i.estado ?? 'ABIERTO');
  const [respuesta, setRespuesta] = useState(i.respuesta ?? '');
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      ok(await client.models.Incidente.update({ id: i.id, estado, respuesta: respuesta || null }));
      await avisar(i.condominioId, i.unidadId, `Tu reporte "${i.titulo}" está ${etiquetaEstado(estado).toLowerCase()}`, respuesta, 'INCIDENTE');
    }, 'Incidente actualizado; se avisó al residente.');
    if (okk) onDone();
  }
  return (
    <Modal title={i.titulo} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Estado">
          <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            {['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO'].map((s) => (
              <option key={s} value={s}>
                {etiquetaEstado(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Respuesta para el residente">
          <textarea maxLength={2000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        </Field>
        <button className="btn-app" disabled={busy}>
          Guardar y avisar
        </button>
      </form>
    </Modal>
  );
}

// ---------- Mantenimientos ----------
export function MantenimientosAdmin() {
  const { condo } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Mantenimiento>((o) => client.models.Mantenimiento.mantenimientosPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [editar, setEditar] = useState<Partial<Mantenimiento> | null>(null);
  const { run } = useAction();
  const borrar = (m: Mantenimiento) =>
    confirm(`¿Eliminar "${m.titulo}"?`) &&
    run(async () => {
      ok(await client.models.Mantenimiento.delete({ id: m.id }));
      reload(true);
    }, 'Eliminado');
  const lista = [...(data ?? [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  return (
    <div className="stack">
      <ModuloInactivo modulo="mantenimientos" />
      <PageHead icon="tools" title="Mantenimientos" sub="Programa de mantenimientos preventivos y correctivos (visible para residentes).">
        <button className="btn-app" onClick={() => setEditar({ tipo: 'PREVENTIVO', estado: 'PROGRAMADO', fecha: hoy() })}>
          <Icon name="plus" />
          Programar
        </button>
      </PageHead>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Mantenimiento</th>
                    <th>Tipo</th>
                    <th>Proveedor</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((m) => (
                    <tr key={m.id}>
                      <td>{fecha(m.fecha)}</td>
                      <td>
                        <strong>{m.titulo}</strong>
                        {m.area && <div className="small muted">{m.area}</div>}
                      </td>
                      <td>{etiquetaEstado(m.tipo)}</td>
                      <td>{m.proveedor ?? '—'}</td>
                      <td>
                        <Badge estado={m.estado} />
                      </td>
                      <td>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="linklike" onClick={() => setEditar(m)}>
                            Editar
                          </button>
                          <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(m)}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="tools">Sin mantenimientos programados.</Empty>
          )}
        </section>
      )}
      {editar && <EditarMant m={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), reload(true))} />}
    </div>
  );
}

function EditarMant({ m, onClose, onDone }: { m: Partial<Mantenimiento>; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({
    titulo: m.titulo ?? '',
    tipo: m.tipo ?? 'PREVENTIVO',
    area: m.area ?? '',
    fecha: m.fecha ?? hoy(),
    estado: m.estado ?? 'PROGRAMADO',
    proveedor: m.proveedor ?? '',
    notas: m.notas ?? '',
  });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { ...f, tipo: f.tipo as 'PREVENTIVO' | 'CORRECTIVO', estado: f.estado as 'PROGRAMADO' | 'EN_PROCESO' | 'TERMINADO' };
    const okk = await run(async () => {
      if (m.id) ok(await client.models.Mantenimiento.update({ id: m.id, ...datos }));
      else ok(await client.models.Mantenimiento.create({ condominioId: condoId, ...datos }));
    }, 'Mantenimiento guardado');
    if (okk) onDone();
  }
  return (
    <Modal title={m.id ? 'Editar mantenimiento' : 'Programar mantenimiento'} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Actividad">
          <input required maxLength={140} value={f.titulo} onChange={set('titulo')} placeholder="Ej. Mantenimiento de bombas" />
        </Field>
        <div className="form-2">
          <Field label="Tipo">
            <select value={f.tipo} onChange={set('tipo')}>
              <option value="PREVENTIVO">Preventivo</option>
              <option value="CORRECTIVO">Correctivo</option>
            </select>
          </Field>
          <Field label="Estado">
            <select value={f.estado} onChange={set('estado')}>
              <option value="PROGRAMADO">Programado</option>
              <option value="EN_PROCESO">En proceso</option>
              <option value="TERMINADO">Terminado</option>
            </select>
          </Field>
          <Field label="Fecha">
            <input required type="date" value={f.fecha} onChange={set('fecha')} />
          </Field>
          <Field label="Área">
            <input maxLength={120} value={f.area} onChange={set('area')} />
          </Field>
        </div>
        <Field label="Proveedor">
          <input maxLength={120} value={f.proveedor} onChange={set('proveedor')} />
        </Field>
        <Field label="Notas (visibles para residentes)">
          <textarea maxLength={2000} value={f.notas} onChange={set('notas')} />
        </Field>
        <button className="btn-app" disabled={busy}>
          Guardar
        </button>
      </form>
    </Modal>
  );
}

// ---------- Amenidades y reservas ----------
export function AmenidadesAdmin() {
  const { condo, etiqueta } = useAdmin();
  const cid = condo!.id;
  const { data, error, loading, reload } = useLoad(async () => {
    const [amenidades, reservas] = await Promise.all([
      all<Amenidad>((o) => client.models.Amenidad.amenidadesPorCondominio({ condominioId: cid }, o)),
      all<Reserva>((o) => client.models.Reserva.reservasPorCondominio({ condominioId: cid }, o)),
    ]);
    return { amenidades, reservas };
  }, [cid]);
  const [editar, setEditar] = useState<Partial<Amenidad> | null>(null);
  const [tab, setTab] = useState<'reservas' | 'amenidades'>('reservas');
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { amenidades, reservas } = data!;
  const nombre = (id: string) => amenidades.find((a) => a.id === id)?.nombre ?? '—';
  const h = hoy();
  const proximas = reservas
    .filter((r) => r.fecha >= h && r.estado !== 'CANCELADA')
    .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio));

  const resolver = (r: Reserva, estado: 'APROBADA' | 'RECHAZADA') => {
    const nota = estado === 'RECHAZADA' ? prompt('Motivo (lo verá el residente):') : '';
    if (nota === null) return;
    run(async () => {
      ok(await client.models.Reserva.update({ id: r.id, estado, nota: nota || r.nota }));
      await avisar(cid, r.unidadId, `Tu reserva de ${nombre(r.amenidadId)} (${fecha(r.fecha)}) fue ${estado === 'APROBADA' ? 'aprobada' : 'rechazada'}`, nota, 'RESERVA');
      reload(true);
    }, estado === 'APROBADA' ? 'Reserva aprobada' : 'Reserva rechazada');
  };

  return (
    <div className="stack">
      <ModuloInactivo modulo="amenidades" />
      <PageHead icon="calendar" title="Amenidades" sub="Solo las amenidades dadas de alta y activas pueden reservarse.">
        <button className="btn-app" onClick={() => setEditar({ activa: true, requiereAprobacion: true })}>
          <Icon name="plus" />
          Nueva amenidad
        </button>
      </PageHead>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ['reservas', `Próximas reservas (${proximas.length})`],
          ['amenidades', `Amenidades (${amenidades.length})`],
        ]}
      />
      {tab === 'reservas' ? (
        <section className="panel">
          {proximas.length ? (
            <ul className="list">
              {proximas.map((r) => (
                <li key={r.id}>
                  <div className="list-main">
                    <strong>{nombre(r.amenidadId)}</strong> <Badge estado={r.estado} />
                    <div className="list-sub">
                      {etiqueta(r.unidadId)} · {fecha(r.fecha, { weekday: 'short', day: 'numeric', month: 'short' })} · {r.horaInicio}–{r.horaFin}
                      {r.invitados ? ` · ${r.invitados} invitados` : ''}
                    </div>
                    {r.nota && <div className="small">{r.nota}</div>}
                  </div>
                  {r.estado === 'SOLICITADA' && (
                    <div className="row-actions">
                      <button className="btn-app sm" disabled={busy} onClick={() => resolver(r, 'APROBADA')}>
                        Aprobar
                      </button>
                      <button className="btn-app sm danger" disabled={busy} onClick={() => resolver(r, 'RECHAZADA')}>
                        Rechazar
                      </button>
                    </div>
                  )}
                  {r.estado === 'APROBADA' && (
                    <button className="btn-app sm danger" disabled={busy} onClick={() => resolver(r, 'RECHAZADA')}>
                      Cancelar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="calendar">Sin reservas próximas.</Empty>
          )}
        </section>
      ) : (
        <div className="grid-cards">
          {amenidades.map((a) => (
            <article key={a.id} className="panel" style={{ marginTop: 0 }}>
              <div className="panel-head">
                <h3>{a.nombre}</h3>
                <Badge estado={a.activa === false ? 'CANCELADA' : 'APROBADA'}>{a.activa === false ? 'Inactiva' : 'Activa'}</Badge>
              </div>
              <p className="small muted">
                {a.horaApertura ?? '—'}–{a.horaCierre ?? '—'} {a.maxHoras ? `· máx. ${a.maxHoras} h` : ''} {a.capacidad ? `· ${a.capacidad} pers.` : ''}{' '}
                {a.costo ? `· ${money(a.costo)}` : ''} {a.requiereAprobacion ? '· requiere aprobación' : '· confirmación automática'}
              </p>
              <button className="btn-app sm secondary" onClick={() => setEditar(a)}>
                Editar
              </button>
            </article>
          ))}
          {!amenidades.length && (
            <section className="panel">
              <Empty icon="calendar">Da de alta salón de fiestas, asadores, alberca, etc.</Empty>
            </section>
          )}
        </div>
      )}
      {editar && <EditarAmenidad a={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), setTab('amenidades'), reload(true))} />}
    </div>
  );
}

function EditarAmenidad({ a, onClose, onDone }: { a: Partial<Amenidad>; onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({
    nombre: a.nombre ?? '',
    descripcion: a.descripcion ?? '',
    horaApertura: a.horaApertura ?? '09:00',
    horaCierre: a.horaCierre ?? '22:00',
    maxHoras: a.maxHoras != null ? String(a.maxHoras) : '4',
    capacidad: a.capacidad != null ? String(a.capacidad) : '',
    costo: a.costo != null ? String(a.costo) : '',
    reglas: a.reglas ?? '',
    requiereAprobacion: a.requiereAprobacion !== false,
    activa: a.activa !== false,
  });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v === '' ? null : Number(v));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { ...f, maxHoras: num(f.maxHoras), capacidad: num(f.capacidad), costo: num(f.costo) };
    const okk = await run(async () => {
      if (a.id) ok(await client.models.Amenidad.update({ id: a.id, ...datos }));
      else ok(await client.models.Amenidad.create({ condominioId: condoId, ...datos }));
    }, 'Amenidad guardada');
    if (okk) onDone();
  }
  return (
    <Modal title={a.id ? `Editar ${a.nombre}` : 'Nueva amenidad'} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Nombre">
          <input required maxLength={80} value={f.nombre} onChange={set('nombre')} placeholder="Salón de usos múltiples" />
        </Field>
        <Field label="Descripción">
          <input maxLength={300} value={f.descripcion} onChange={set('descripcion')} />
        </Field>
        <div className="form-2">
          <Field label="Abre">
            <input type="time" value={f.horaApertura} onChange={set('horaApertura')} />
          </Field>
          <Field label="Cierra">
            <input type="time" value={f.horaCierre} onChange={set('horaCierre')} />
          </Field>
          <Field label="Máximo de horas por reserva">
            <input type="number" min="1" value={f.maxHoras} onChange={set('maxHoras')} />
          </Field>
          <Field label="Capacidad (personas)">
            <input type="number" min="1" value={f.capacidad} onChange={set('capacidad')} />
          </Field>
          <Field label="Costo (MXN)">
            <input type="number" min="0" step="0.01" value={f.costo} onChange={set('costo')} />
          </Field>
        </div>
        <Field label="Reglas de uso">
          <textarea maxLength={2000} value={f.reglas} onChange={set('reglas')} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.requiereAprobacion} onChange={(e) => setF({ ...f, requiereAprobacion: e.target.checked })} />
          Cada reserva requiere aprobación de la administración
        </label>
        <label className="check">
          <input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} />
          Disponible para reservar
        </label>
        <button className="btn-app" disabled={busy}>
          Guardar
        </button>
      </form>
    </Modal>
  );
}

// ---------- Visitas (bitácora) ----------
export function VisitasAdmin() {
  const { condo, etiqueta } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Visita>((o) => client.models.Visita.visitasPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [dia, setDia] = useState(hoy());
  const lista = (data ?? [])
    .filter((v) => v.fecha === dia || (v.fecha <= dia && (v.fechaFin ?? v.fecha) >= dia) || (v.entradaEn ?? '').slice(0, 10) === dia)
    .sort((a, b) => String(b.entradaEn ?? b.createdAt).localeCompare(String(a.entradaEn ?? a.createdAt)));
  return (
    <div className="stack">
      <ModuloInactivo modulo="visitas" />
      <PageHead icon="qr" title="Bitácora de visitas" sub="Pases generados por residentes y registros de caseta.">
        <input className="input" type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={{ width: 180 }} />
      </PageHead>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Unidad</th>
                    <th>Tipo</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <strong>{v.nombre}</strong>
                        <div className="small muted">
                          {v.origen === 'CASETA' ? 'Registrada en caseta' : `Pase ${v.codigo ?? ''}`} {v.placas && `· ${v.placas}`}
                        </div>
                      </td>
                      <td>{etiqueta(v.unidadId)}</td>
                      <td>{etiquetaEstado(v.tipo)}</td>
                      <td>{v.entradaEn ? fechaHora(v.entradaEn) : '—'}</td>
                      <td>{v.salidaEn ? fechaHora(v.salidaEn) : '—'}</td>
                      <td>
                        <Badge estado={v.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="qr">Sin movimientos ese día.</Empty>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- Mascotas ----------
export function MascotasAdmin() {
  const { condo, etiqueta } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Mascota>((o) => client.models.Mascota.mascotasPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const { run, busy } = useAction();
  const resolver = (m: Mascota, estado: 'APROBADA' | 'RECHAZADA') => {
    const nota = estado === 'RECHAZADA' ? prompt('Motivo (lo verá el residente):') : '';
    if (nota === null) return;
    run(async () => {
      ok(await client.models.Mascota.update({ id: m.id, estado, notas: nota || m.notas }));
      await avisar(m.condominioId, m.unidadId, `El registro de ${m.nombre} fue ${estado === 'APROBADA' ? 'aprobado' : 'rechazado'}`, nota, 'MASCOTA');
      reload(true);
    }, estado === 'APROBADA' ? 'Mascota aprobada' : 'Registro rechazado');
  };
  const lista = [...(data ?? [])].sort((a, b) => (a.estado === 'PENDIENTE' ? -1 : 0) - (b.estado === 'PENDIENTE' ? -1 : 0) || porFecha(a, b));
  return (
    <div className="stack">
      <ModuloInactivo modulo="mascotas" />
      <PageHead icon="paw" title="Mascota segura" sub="Valida el registro de mascotas de los residentes." />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <ul className="list">
              {lista.map((m) => (
                <li key={m.id}>
                  <Archivo path={m.fotoPath} thumb />
                  <div className="list-main">
                    <strong>{m.nombre}</strong> <Badge estado={m.estado} /> {m.extraviada && <Badge estado="RECHAZADO">Extraviada</Badge>}
                    <div className="list-sub">
                      {etiqueta(m.unidadId)} · {[m.especie, m.raza, m.color].filter(Boolean).join(' · ')}
                    </div>
                    <div className="list-sub">Vacuna antirrábica: {fecha(m.vacunaAntirrabica)}</div>
                    {m.notas && <div className="small">{m.notas}</div>}
                  </div>
                  {m.estado === 'PENDIENTE' && (
                    <div className="row-actions">
                      <button className="btn-app sm" disabled={busy} onClick={() => resolver(m, 'APROBADA')}>
                        Aprobar
                      </button>
                      <button className="btn-app sm danger" disabled={busy} onClick={() => resolver(m, 'RECHAZADA')}>
                        Rechazar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="paw">Sin mascotas registradas.</Empty>
          )}
        </section>
      )}
    </div>
  );
}
