import { useState } from 'react';
import { adminCall, all, db, ok, urlArchivoAdmin, type Schema } from '../api';
import {
  Archivo,
  Badge,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Loading,
  Modal,
  PageHead,
  Seg,
  etiquetaEstado,
  fecha,
  fechaHora,
  hoy,
  money,
  useAction,
  useLoad,
} from '../ui';
import { ModuloInactivo, useAdmin } from './AdminApp';
import { Documentos } from './Documentos';
import { SLOTS_AMENIDADES } from '../../../amplify/functions/shared/documentos';

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
// Lista compacta; al abrir un incidente se ve su tarjeta de seguimiento: el reporte del residente, cada etapa con
// su descripción y foto de evidencia, y el formulario de la siguiente etapa (En seguimiento → En proceso → Cerrado).
// Lo guardado queda fijo. Cerrado ya no se modifica, salvo por el superadministrador.
type Paso = { estado: string; respuesta?: string | null; fotoPath?: string | null; por?: string; porNombre?: string | null; en: string; reabierto?: boolean };
// Etapas que elige el administrador, en orden (RESUELTO solo existe en registros anteriores).
const ETAPAS = ['EN_SEGUIMIENTO', 'EN_PROCESO', 'CERRADO'];
const ORDEN: Record<string, number> = { ABIERTO: 0, EN_SEGUIMIENTO: 1, EN_PROCESO: 2, RESUELTO: 2, CERRADO: 3 };

function historialDe(i: Incidente): Paso[] {
  let h: unknown = i.historial;
  for (let k = 0; k < 2 && typeof h === 'string'; k++) {
    try {
      h = JSON.parse(h);
    } catch {
      h = [];
    }
  }
  return Array.isArray(h) ? (h as Paso[]) : [];
}

/** Foto de evidencia en miniatura; al tocarla se abre completa (admin-api firma la URL). */
function FotoEvidencia({ incidenteId, path }: { incidenteId: string; path: string }) {
  const url = useLoad(() => adminCall<{ url: string }>('incidentes.evidencia', { incidenteId, path }).then((r) => r.url), [path]);
  if (!url.data) return <span className="photo-thumb" />;
  return (
    <a href={url.data} target="_blank" rel="noopener" title="Ver foto completa">
      <img src={url.data} alt="Evidencia" style={{ width: 160, maxWidth: '100%', height: 120, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
    </a>
  );
}

export function IncidentesAdmin() {
  const { condo, etiqueta } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Incidente>((o) => db.models.Incidente.incidentesPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [filtro, setFiltro] = useState<'abiertos' | 'todos'>('abiertos');
  const [abierto, setAbierto] = useState<string | null>(null);

  const actual = (data ?? []).find((i) => i.id === abierto);
  if (actual) return <Seguimiento i={actual} onBack={() => setAbierto(null)} onCambio={() => reload(true)} />;

  const lista = (data ?? []).filter((i) => filtro === 'todos' || i.estado !== 'CERRADO').sort(porFecha);
  return (
    <div className="stack">
      <ModuloInactivo modulo="incidentes" />
      <PageHead icon="alert" title="Incidentes" sub="Toca un reporte para ver su seguimiento y atenderlo." />
      <Seg
        value={filtro}
        onChange={setFiltro}
        options={[
          ['abiertos', 'Sin cerrar'],
          ['todos', 'Todos'],
        ]}
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <ul className="list">
              {lista.map((i) => (
                <li key={i.id} style={{ padding: 0 }}>
                  <button type="button" className="fila-click" onClick={() => setAbierto(i.id)}>
                    <Archivo path={i.fotoPath} origen={{ model: 'Incidente', id: i.id }} thumb />
                    <span className="list-main">
                      <strong>{i.titulo}</strong> <Badge estado={i.estado} />
                      <span className="list-sub" style={{ display: 'block' }}>
                        {etiqueta(i.unidadId)} · {i.categoria} · {fechaHora(i.createdAt)}
                      </span>
                      {i.descripcion && (
                        <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {i.descripcion}
                        </span>
                      )}
                    </span>
                    <Icon name="arrow" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="alert">Sin incidentes {filtro === 'abiertos' ? 'por cerrar' : ''}.</Empty>
          )}
        </section>
      )}
    </div>
  );
}

function Seguimiento({ i, onBack, onCambio }: { i: Incidente; onBack: () => void; onCambio: () => void }) {
  const { etiqueta, puede, superadmin } = useAdmin();
  const pasos = historialDe(i);
  const cerrado = i.estado === 'CERRADO';
  const [modificar, setModificar] = useState(false);
  const gestiona = puede('incidentes', 'editar');

  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={onBack}>
          <Icon name="back" /> Todos los incidentes
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1.2rem' }}>{i.titulo}</h2>
          <Badge estado={i.estado} />
        </div>
        <p className="list-sub" style={{ marginTop: 0 }}>
          Reporte de {etiqueta(i.unidadId)} · {i.categoria} · {fechaHora(i.createdAt)}
          {i.ubicacion && ` · ${i.ubicacion}`}
        </p>
        {i.descripcion && <p className="pre" style={{ margin: '0 0 12px' }}>{i.descripcion}</p>}
        {i.fotoPath && <FotoReporte i={i} />}
      </section>

      <section className="panel">
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Seguimiento</h2>
        <ol className="etapas">
          <li className="etapa hecha">
            <strong>Reportado</strong> <span className="list-sub">· {fechaHora(i.createdAt)}</span>
          </li>
          {pasos.map((h, k) => (
            <li key={k} className="etapa hecha">
              <strong>{etiquetaEstado(h.estado)}</strong>
              {h.reabierto && <Badge estado="PENDIENTE">Modificado después del cierre</Badge>}{' '}
              <span className="list-sub">
                · {fechaHora(h.en)}
                {superadmin && h.por && ` · ${h.porNombre ? `${h.porNombre} (${h.por})` : h.por}`}
              </span>
              {h.respuesta && <div className="small pre" style={{ margin: '4px 0' }}>{h.respuesta}</div>}
              {h.fotoPath && <FotoEvidencia incidenteId={i.id} path={h.fotoPath} />}
            </li>
          ))}
        </ol>
      </section>

      {gestiona &&
        (!cerrado ? (
          <SiguienteEtapa key={`${i.estado}-${pasos.length}`} i={i} onDone={onCambio} />
        ) : superadmin ? (
          modificar ? (
            <SiguienteEtapa key="modificar" i={i} superadmin onDone={() => (setModificar(false), onCambio())} onCancel={() => setModificar(false)} />
          ) : (
            <div className="row-actions">
              <span className="small muted">Incidente cerrado. Solo el superadministrador puede modificarlo.</span>
              <button
                className="btn-app sm secondary"
                onClick={() => confirm('Este incidente ya está cerrado. ¿Seguro que quieres modificarlo?') && setModificar(true)}
              >
                Modificar
              </button>
            </div>
          )
        ) : (
          <div className="alert small">Incidente cerrado. Ya no se puede modificar.</div>
        ))}
    </div>
  );
}

function FotoReporte({ i }: { i: Incidente }) {
  const url = useLoad(() => urlArchivoAdmin('Incidente', i.id), [i.id]);
  if (!url.data) return <span className="photo-thumb" />;
  return (
    <a href={url.data} target="_blank" rel="noopener" title="Ver foto completa">
      <img src={url.data} alt="Foto del reporte" style={{ width: 280, maxWidth: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
    </a>
  );
}

/** Formulario de la siguiente etapa: el administrador elige cualquiera de las que siguen; lo guardado queda fijo. */
function SiguienteEtapa({ i, superadmin, onDone, onCancel }: { i: Incidente; superadmin?: boolean; onDone: () => void; onCancel?: () => void }) {
  const actual = ORDEN[i.estado ?? 'ABIERTO'] ?? 0;
  const opciones = superadmin ? ETAPAS : ETAPAS.filter((x) => ORDEN[x] > actual);
  const [estado, setEstado] = useState(opciones[0]);
  const [respuesta, setRespuesta] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [vista, setVista] = useState('');
  const { run, busy } = useAction();

  const elegir = (f?: File) => {
    if (vista) URL.revokeObjectURL(vista);
    setFoto(f ?? null);
    setVista(f ? URL.createObjectURL(f) : '');
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const aviso =
      estado === 'CERRADO' && !superadmin
        ? 'Al cerrar el incidente ya no se podrá escribir nada más. ¿Continuar?'
        : 'Una vez guardada, esta etapa ya no se podrá modificar. ¿Continuar?';
    if (!confirm(aviso)) return;
    const okk = await run(async () => {
      if (!foto) throw new Error('Sube la foto de evidencia.');
      const nombre = foto.name || 'evidencia.jpg';
      const r = await adminCall<{ url: string; path: string; contentType: string }>('incidentes.subirEvidencia', {
        incidenteId: i.id,
        nombre: /\.[a-z0-9]+$/i.test(nombre) ? nombre : `${nombre}.jpg`,
        tamano: foto.size,
      });
      const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: foto });
      if (!put.ok) throw new Error('No se pudo subir la foto. Intenta de nuevo.');
      await adminCall('incidentes.atender', { incidenteId: i.id, estado, respuesta, fotoPath: r.path });
    }, estado === 'CERRADO' ? 'Incidente cerrado; se avisó al residente.' : 'Etapa guardada; se avisó al residente.');
    if (okk) onDone();
  }

  return (
    <section className="panel">
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>{superadmin ? 'Modificar incidente cerrado' : 'Siguiente etapa'}</h2>
      <form className="form" onSubmit={guardar}>
        <Field label="Etapa">
          <Seg value={estado} onChange={setEstado} options={opciones.map((x) => [x, etiquetaEstado(x)] as [string, string])} />
        </Field>
        <Field label="Descripción" hint="Qué se está haciendo o por qué se cierra. El residente recibe un aviso.">
          <textarea required maxLength={2000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        </Field>
        <Field
          label="Foto de evidencia (obligatoria)"
          hint={estado === 'CERRADO' ? 'Foto que muestre por qué se cierra el incidente.' : 'Foto que muestre el avance. Puedes tomarla con la cámara.'}
        >
          <input type="file" accept="image/*" capture="environment" onChange={(e) => elegir(e.target.files?.[0])} />
        </Field>
        {vista && <img src={vista} alt="Vista previa de la evidencia" style={{ width: 200, maxWidth: '100%', maxHeight: 160, borderRadius: 10, objectFit: 'cover' }} />}
        <p className="small muted" style={{ margin: 0 }}>
          Al guardar, la etapa queda registrada y ya no se puede modificar.
        </p>
        <div className="row-actions">
          <button className="btn-app" disabled={busy || !foto || !respuesta.trim()}>
            {busy ? 'Guardando…' : estado === 'CERRADO' && !superadmin ? 'Guardar y cerrar incidente' : 'Guardar etapa'}
          </button>
          {onCancel && (
            <button type="button" className="btn-app secondary" disabled={busy} onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------- Mantenimientos ----------
export function MantenimientosAdmin() {
  const { condo, puede } = useAdmin();
  const gestiona = puede('mantenimientos', 'editar');
  const { data, error, loading, reload } = useLoad(
    () => all<Mantenimiento>((o) => db.models.Mantenimiento.mantenimientosPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const [editar, setEditar] = useState<Partial<Mantenimiento> | null>(null);
  const { run } = useAction();
  const borrar = (m: Mantenimiento) =>
    confirm(`¿Eliminar "${m.titulo}"?`) &&
    run(async () => {
      ok(await db.models.Mantenimiento.delete({ id: m.id }));
      reload(true);
    }, 'Eliminado');
  const lista = [...(data ?? [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  return (
    <div className="stack">
      <ModuloInactivo modulo="mantenimientos" />
      <PageHead icon="tools" title="Mantenimientos" sub="Programa de mantenimientos preventivos y correctivos (visible para residentes).">
        {gestiona && (
          <button className="btn-app" onClick={() => setEditar({ tipo: 'PREVENTIVO', estado: 'PROGRAMADO', fecha: hoy() })}>
            <Icon name="plus" />
            Programar
          </button>
        )}
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
                        {gestiona && (
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            <button className="linklike" onClick={() => setEditar(m)}>
                              Editar
                            </button>
                            <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrar(m)}>
                              Eliminar
                            </button>
                          </div>
                        )}
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
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { ...f, tipo: f.tipo as 'PREVENTIVO' | 'CORRECTIVO', estado: f.estado as 'PROGRAMADO' | 'EN_PROCESO' | 'TERMINADO' };
    const okk = await run(async () => {
      if (m.id) ok(await db.models.Mantenimiento.update({ id: m.id, ...datos }));
      else ok(await db.models.Mantenimiento.create({ condominioId: condoId, ...datos }));
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
// La configuración de amenidades (horarios, costos, reglas) vive en la ficha del condominio; aquí, las reservas.
export function AmenidadesAdmin() {
  const { condo, etiqueta, puede } = useAdmin();
  const gestiona = puede('amenidades', 'editar');
  const cid = condo!.id;
  const { data, error, loading, reload } = useLoad(async () => {
    const [amenidades, reservas] = await Promise.all([
      all<Amenidad>((o) => db.models.Amenidad.amenidadesPorCondominio({ condominioId: cid }, o)),
      all<Reserva>((o) => db.models.Reserva.reservasPorCondominio({ condominioId: cid }, o)),
    ]);
    return { amenidades, reservas };
  }, [cid]);
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { amenidades, reservas } = data!;
  const nombre = (id: string) => {
    const a = amenidades.find((x) => x.id === id);
    const padre = a?.parteDeId ? amenidades.find((x) => x.id === a.parteDeId) : undefined;
    return a ? (padre ? `${a.nombre} · ${padre.nombre}` : a.nombre) : '—';
  };
  const h = hoy();
  const proximas = reservas
    .filter((r) => r.fecha >= h && r.estado !== 'CANCELADA')
    .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio));

  const resolver = (r: Reserva, estado: 'APROBADA' | 'RECHAZADA') => {
    const nota = estado === 'RECHAZADA' ? prompt('Motivo (lo verá el residente):') : '';
    if (nota === null) return;
    run(
      async () => {
        ok(await db.models.Reserva.update({ id: r.id, estado, nota: nota || r.nota }));
        await avisar(
          cid,
          r.unidadId,
          `Tu reserva de ${nombre(r.amenidadId)} (${fecha(r.fecha)}) fue ${estado === 'APROBADA' ? 'aprobada' : 'rechazada'}`,
          nota,
          'RESERVA',
        );
        reload(true);
      },
      estado === 'APROBADA' ? 'Reserva aprobada' : 'Reserva rechazada',
    );
  };

  return (
    <div className="stack">
      <ModuloInactivo modulo="amenidades" />
      <PageHead
        icon="calendar"
        title="Reservas de amenidades"
        sub={`${amenidades.length} amenidad(es) configurada(s). Horarios, costos y reglas se configuran en Condominios › Amenidades.`}
      />
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
                {gestiona && r.estado === 'SOLICITADA' && (
                  <div className="row-actions">
                    <button className="btn-app sm" disabled={busy} onClick={() => resolver(r, 'APROBADA')}>
                      Aprobar
                    </button>
                    <button className="btn-app sm danger" disabled={busy} onClick={() => resolver(r, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </div>
                )}
                {gestiona && r.estado === 'PENDIENTE_PAGO' && (
                  <div className="row-actions">
                    <span className="small muted">Se confirma al validar su pago en Finanzas</span>
                    <button className="btn-app sm danger" disabled={busy} onClick={() => resolver(r, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </div>
                )}
                {gestiona && r.estado === 'APROBADA' && (
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
    </div>
  );
}

/**
 * Amenidades del condominio seleccionado: horarios, capacidad, costo, reglas y si requieren aprobación.
 * Una amenidad puede dividirse en secciones (p. ej. Casa club → Parrillas, Terraza, Salón de eventos):
 * se reserva completa o por secciones, y una reserva bloquea a la otra en ese horario.
 */
export function CatalogoAmenidades() {
  const { condo, puede } = useAdmin();
  const gestiona = puede('amenidades', 'editar');
  const cid = condo!.id;
  const { data, error, loading, reload } = useLoad(() => all<Amenidad>((o) => db.models.Amenidad.amenidadesPorCondominio({ condominioId: cid }, o)), [cid]);
  const [editar, setEditar] = useState<Partial<Amenidad> | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const amenidades = [...(data ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const principales = amenidades.filter((a) => !a.parteDeId || !amenidades.some((x) => x.id === a.parteDeId));
  const secciones = (id: string) => amenidades.filter((a) => a.parteDeId === id);
  const datos = (a: Amenidad) => (
    <>
      <strong>{a.costo ? money(a.costo) : 'Sin costo'}</strong>
      {a.costo ? ' por reserva' : ''} · {a.horaApertura ?? '—'}–{a.horaCierre ?? '—'} {a.maxHoras ? `· máx. ${a.maxHoras} h` : ''}{' '}
      {a.capacidad ? `· ${a.capacidad} pers.` : ''} {a.requiereAprobacion ? '· requiere aprobación' : '· confirmación automática'}
    </>
  );

  return (
    <div className="stack">
      <ModuloInactivo modulo="amenidades" />
      <Documentos
        titulo="Reglamento y términos de uso"
        nota="El residente los puede consultar al reservar y, al presionar «Reservar», acepta el reglamento y los términos de uso."
        slots={SLOTS_AMENIDADES}
        seccion="amenidades"
      />
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Solo las amenidades activas pueden reservarse. Para dividir una amenidad (por ejemplo, una casa club), crea cada sección y elige de cuál
          forma parte.
        </p>
        {gestiona && (
          <button className="btn-app sm" onClick={() => setEditar({ activa: true, requiereAprobacion: true })}>
            <Icon name="plus" />
            Nueva amenidad
          </button>
        )}
      </div>
      <div className="grid-cards">
        {principales.map((a) => (
          <article key={a.id} className="panel" style={{ marginTop: 0 }}>
            <div className="panel-head">
              <h3>{a.nombre}</h3>
              <Badge estado={a.activa === false ? 'CANCELADA' : 'APROBADA'}>{a.activa === false ? 'Inactiva' : 'Activa'}</Badge>
            </div>
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              {secciones(a.id).length ? 'Completa: ' : ''}
              {datos(a)}
            </p>
            {secciones(a.id).length > 0 && (
              <ul className="list" style={{ marginBottom: 8 }}>
                {secciones(a.id).map((x) => (
                  <li key={x.id} style={{ padding: '8px 0' }}>
                    <div className="list-main">
                      <span style={{ fontWeight: 700 }}>{x.nombre}</span> {x.activa === false && <Badge estado="CANCELADA">Inactiva</Badge>}
                      <div className="list-sub">{datos(x)}</div>
                    </div>
                    {gestiona && (
                      <button className="linklike" onClick={() => setEditar(x)}>
                        Editar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {gestiona && (
              <div className="row-actions">
                <button className="btn-app sm secondary" onClick={() => setEditar(a)}>
                  Editar
                </button>
                {!a.parteDeId && (
                  <button className="btn-app sm secondary" onClick={() => setEditar({ activa: true, requiereAprobacion: true, parteDeId: a.id })}>
                    <Icon name="plus" />
                    Sección
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {!amenidades.length && (
          <section className="panel">
            <Empty icon="calendar">Da de alta salón de fiestas, asadores, alberca, gimnasio, casa club, etc.</Empty>
          </section>
        )}
      </div>
      {editar && <EditarAmenidad a={editar} amenidades={amenidades} onClose={() => setEditar(null)} onDone={() => (setEditar(null), reload(true))} />}
    </div>
  );
}

function EditarAmenidad({ a, amenidades, onClose, onDone }: { a: Partial<Amenidad>; amenidades: Amenidad[]; onClose: () => void; onDone: () => void }) {
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
    parteDeId: a.parteDeId ?? '',
  });
  const tieneSecciones = !!a.id && amenidades.some((x) => x.parteDeId === a.id);
  const posibles = amenidades.filter((x) => !x.parteDeId && x.id !== a.id);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v === '' ? null : Number(v));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { ...f, maxHoras: num(f.maxHoras), capacidad: num(f.capacidad), costo: num(f.costo), parteDeId: f.parteDeId || null };
    const okk = await run(async () => {
      if (a.id) ok(await db.models.Amenidad.update({ id: a.id, ...datos }));
      else ok(await db.models.Amenidad.create({ condominioId: condoId, ...datos }));
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
        <Field
          label="Forma parte de"
          hint={
            tieneSecciones
              ? 'Esta amenidad tiene secciones, así que es una amenidad principal.'
              : 'Si es una sección (p. ej. Terraza de la Casa club), elige la amenidad completa. Reservar la completa bloquea sus secciones en ese horario y reservar una sección bloquea la completa.'
          }
        >
          <select value={f.parteDeId} disabled={tieneSecciones} onChange={(e) => setF({ ...f, parteDeId: e.target.value })}>
            <option value="">Ninguna (amenidad principal)</option>
            {posibles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </select>
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
    () => all<Visita>((o) => db.models.Visita.visitasPorCondominio({ condominioId: condo!.id }, o)),
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
  const { condo, etiqueta, puede } = useAdmin();
  const { data, error, loading, reload } = useLoad(
    () => all<Mascota>((o) => db.models.Mascota.mascotasPorCondominio({ condominioId: condo!.id }, o)),
    [condo!.id],
  );
  const { run, busy } = useAction();
  const resolver = (m: Mascota, estado: 'APROBADA' | 'RECHAZADA') => {
    const nota = estado === 'RECHAZADA' ? prompt('Motivo (lo verá el residente):') : '';
    if (nota === null) return;
    run(
      async () => {
        ok(await db.models.Mascota.update({ id: m.id, estado, notas: nota || m.notas }));
        await avisar(
          m.condominioId,
          m.unidadId,
          `El registro de ${m.nombre} fue ${estado === 'APROBADA' ? 'aprobado' : 'rechazado'}`,
          nota,
          'MASCOTA',
        );
        reload(true);
      },
      estado === 'APROBADA' ? 'Mascota aprobada' : 'Registro rechazado',
    );
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
                  <Archivo path={m.fotoPath} origen={{ model: 'Mascota', id: m.id }} thumb />
                  <div className="list-main">
                    <strong>{m.nombre}</strong> <Badge estado={m.estado} /> {m.extraviada && <Badge estado="RECHAZADO">Extraviada</Badge>}
                    <div className="list-sub">
                      {etiqueta(m.unidadId)} · {[m.especie, m.raza, m.color].filter(Boolean).join(' · ')}
                    </div>
                    <div className="list-sub">Vacuna antirrábica: {fecha(m.vacunaAntirrabica)}</div>
                    {m.notas && <div className="small">{m.notas}</div>}
                  </div>
                  {puede('mascotas', 'editar') && m.estado === 'PENDIENTE' && (
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
