// Residentes de un condominio: sus casas o departamentos con quién vive en cada uno, el personal de caseta
// y las solicitudes de acceso. Alta uno por uno o masiva con el machote de Excel.
import { useMemo, useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, Seg, errMsg, fecha, useAction, useLoad } from '../ui';
import { claveUnidad, etiquetaUnidad, prefijoUnidad } from '../../../amplify/functions/shared/unidades';
import { useAdmin, type Unidad } from './AdminApp';
import { descargarMachote, leerMachote, type FilaActual, type FilaMachote } from './excel';
import { ChatUnidad } from './Comunicacion';

type Perfil = Schema['Perfil']['type'];
type Cuenta = { status?: string; enabled?: boolean; creado?: string };
type Resultado = { etiqueta: string; unidad?: 'creada' | 'existente'; acceso?: boolean; cambios?: string[]; error?: string };
type Filtro = 'todas' | 'sin' | 'invitados' | 'suspendidos';

const correoValido = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const digitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');
/** Residentes de una unidad que cuentan para el machote (los rechazados no). */
const residentesDe = (perfiles: Perfil[], unidadId?: string) =>
  unidadId ? perfiles.filter((p) => p.rol === 'RESIDENTE' && p.unidadId === unidadId && p.estado !== 'RECHAZADO') : [];

export function Residentes({ irAGenerales }: { irAGenerales: () => void }) {
  const { condo, unidades, reloadUnidades, puede, tiene } = useAdmin();
  const c = condo!;
  const veUsuarios = puede('usuarios');
  const gestionaUsuarios = puede('usuarios', 'editar');
  const gestionaUnidades = puede('condominios', 'editar');
  const veChat = puede('chat');
  const perfiles = useLoad(
    () => (veUsuarios ? all<Perfil>((o) => db.models.Perfil.list(o)) : Promise.resolve([] as Perfil[])),
    [veUsuarios],
  );
  const cuentas = useLoad(() => (veUsuarios ? adminCall<Record<string, Cuenta>>('estadoCuentas') : Promise.resolve({} as Record<string, Cuenta>)), [veUsuarios]);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [buscar, setBuscar] = useState('');
  const [modal, setModal] = useState<
    | { t: 'residente' }
    | { t: 'masiva' }
    | { t: 'vigilante' }
    | { t: 'unidad'; u: Unidad }
    | { t: 'asignar'; p: Perfil }
    | { t: 'persona'; p: Perfil }
    | { t: 'contrasena'; p: Perfil }
    | { t: 'chat'; p: Perfil }
    | null
  >(null);
  const { run, busy } = useAction();

  const delCondo = useMemo(() => (perfiles.data ?? []).filter((p) => p.condominioId === c.id && (p.rol === 'RESIDENTE' || p.rol === 'VIGILANTE' || !p.rol)), [perfiles.data, c.id]);
  const sinPrimerIngreso = (p: Perfil) => p.estado === 'APROBADO' && cuentas.data?.[p.userId]?.status === 'FORCE_CHANGE_PASSWORD';
  const solicitudes = delCondo.filter((p) => p.estado === 'PENDIENTE');
  const vigilantes = delCondo.filter((p) => p.rol === 'VIGILANTE' && p.estado !== 'PENDIENTE');
  const residentes = delCondo.filter((p) => p.rol === 'RESIDENTE' && p.estado !== 'PENDIENTE');
  const porUnidad = (id: string) => residentes.filter((p) => p.unidadId === id);
  const huerfanos = residentes.filter((p) => !unidades.some((u) => u.id === p.unidadId));

  const q = buscar.trim().toLowerCase();
  const filas = unidades
    .map((u) => ({ u, rs: porUnidad(u.id) }))
    .filter(({ u, rs }) =>
      filtro === 'sin'
        ? !rs.some((p) => p.estado === 'APROBADO')
        : filtro === 'invitados'
          ? rs.some(sinPrimerIngreso)
          : filtro === 'suspendidos'
            ? rs.some((p) => p.estado === 'SUSPENDIDO' || p.estado === 'RECHAZADO')
            : true,
    )
    .filter(({ u, rs }) => !q || `${u.etiqueta} ${u.propietario ?? ''} ${rs.map((p) => `${p.nombre} ${p.email} ${p.telefono ?? ''}`).join(' ')}`.toLowerCase().includes(q));

  const recargar = () => {
    perfiles.reload(true);
    cuentas.reload(true);
    reloadUnidades();
  };
  const accion = (a: string, p: Perfil, msg: string, extra: object = {}) => run(() => adminCall(a, { userId: p.userId, ...extra }).then(recargar), msg);
  const borrarUnidad = (u: Unidad) =>
    confirm(`¿Eliminar ${u.etiqueta}? Sus cargos e historial se conservan pero quedarán sin unidad.`) &&
    run(async () => {
      ok(await db.models.Unidad.delete({ id: u.id }));
      reloadUnidades();
    }, 'Unidad eliminada');

  /** Una fila por unidad con su residente principal (el más antiguo), para el machote ya lleno. */
  const filasActuales = (): FilaActual[] =>
    unidades.map((u) => {
      const p = residentesDe(delCondo, u.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
      return [u.etiqueta, p?.nombre ?? '', p?.telefono ?? '', p?.email ?? '', u.fechaEntrega ?? ''];
    });

  const sinTipo = !c.tipoUnidad;
  // Crear unidades pide «Gestionar» en Condominios; si la fila trae correo, el servidor pide además «Gestionar» en Usuarios.
  const puedeAlta = gestionaUnidades;

  /** Acciones de un residente o vigilante según su estado. */
  const acciones = (p: Perfil) =>
    (gestionaUsuarios || veChat) && (
      <div className="row-actions">
        {veChat && p.rol === 'RESIDENTE' && p.estado === 'APROBADO' && p.unidadId && (
          <button className="btn-app sm secondary" onClick={() => setModal({ t: 'chat', p })}>
            <Icon name="chat" />
            Chat
          </button>
        )}
        {gestionaUsuarios && (
          <>
        {(p.estado === 'PENDIENTE' || p.estado === 'RECHAZADO') && (
          <button className="btn-app sm" onClick={() => setModal({ t: 'asignar', p })}>
            Autorizar
          </button>
        )}
        {p.estado === 'PENDIENTE' && (
          <button
            className="btn-app sm danger"
            disabled={busy}
            onClick={() => {
              const nota = prompt('Motivo del rechazo:');
              if (nota !== null) accion('rechazar', p, 'Solicitud rechazada', { nota });
            }}
          >
            Rechazar
          </button>
        )}
        {p.rol === 'VIGILANTE' && (p.estado === 'APROBADO' || p.estado === 'SUSPENDIDO') && (
          <button className="btn-app sm secondary" onClick={() => setModal({ t: 'persona', p })}>
            Editar
          </button>
        )}
        {p.estado === 'APROBADO' && (
          <>
            {p.rol === 'RESIDENTE' && !unidades.some((u) => u.id === p.unidadId) && (
              <button className="btn-app sm" onClick={() => setModal({ t: 'asignar', p })}>
                Asignar unidad
              </button>
            )}
            <button className="btn-app sm secondary" disabled={busy} onClick={() => setModal({ t: 'contrasena', p })}>
              <Icon name="shield" />
              Contraseña
            </button>
            <button className="btn-app sm danger" disabled={busy} onClick={() => confirm(`¿Suspender el acceso de ${p.email}?`) && accion('suspender', p, 'Acceso suspendido')}>
              Suspender
            </button>
          </>
        )}
        {p.estado === 'SUSPENDIDO' && (
          <button className="btn-app sm secondary" disabled={busy} onClick={() => accion('reactivar', p, 'Acceso reactivado')}>
            Reactivar
          </button>
        )}
        {tiene('usuarios.eliminar') && p.estado !== 'APROBADO' && (
          <button
            className="btn-app sm danger"
            disabled={busy}
            onClick={() => confirm(`¿Eliminar definitivamente la cuenta de ${p.email}?`) && accion('eliminarUsuario', p, 'Cuenta eliminada')}
          >
            Eliminar
          </button>
        )}
          </>
        )}
      </div>
    );

  const persona = (p: Perfil) => (
    <div key={p.userId} style={{ padding: '8px 0 0' }}>
      <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <strong>{p.nombre || p.email}</strong> {p.estado !== 'APROBADO' && <Badge estado={p.estado} />}{' '}
          {sinPrimerIngreso(p) && <Badge estado="PENDIENTE">Sin primer ingreso</Badge>}
          <div className="list-sub" style={{ overflowWrap: 'anywhere' }}>
            {p.email}
            {p.telefono && ` · ${p.telefono}`}
            {p.estado === 'PENDIENTE' && p.unidadSolicitada && ` · solicitó: ${p.unidadSolicitada}`}
          </div>
          {p.nota && <div className="small">{p.nota}</div>}
        </div>
        {acciones(p)}
      </div>
    </div>
  );

  if (veUsuarios && perfiles.loading && !perfiles.data) return <Loading />;
  if (perfiles.error) return <ErrorBox error={perfiles.error} retry={perfiles.reload} />;

  return (
    <div className="stack">
      {sinTipo && (
        <div className="alert">
          Antes de dar de alta residentes indica si {c.nombre} es de casas o de departamentos.{' '}
          <button className="linklike" onClick={irAGenerales}>
            Ir a Datos generales
          </button>
        </div>
      )}

      {solicitudes.length > 0 && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Solicitudes de acceso ({solicitudes.length})</h2>
          {solicitudes.map(persona)}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1.1rem' }}>
            {prefijoUnidad(c.tipoUnidad) === 'Depto' ? 'Departamentos' : 'Casas'} y residentes
          </h2>
          {puedeAlta && !sinTipo && (
            <div className="row-actions">
              <button className="btn-app sm secondary" onClick={() => descargarMachote({ condominio: c.nombre, filas: filasActuales() }).catch((e) => alert(errMsg(e)))}>
                <Icon name="download" />
                Descargar machote
              </button>
              <button className="btn-app sm secondary" onClick={() => setModal({ t: 'masiva' })}>
                <Icon name="upload" />
                Alta masiva (Excel)
              </button>
              <button className="btn-app sm" onClick={() => setModal({ t: 'residente' })}>
                <Icon name="plus" />
                Agregar
              </button>
            </div>
          )}
        </div>
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          {veUsuarios && (
            <Seg
              value={filtro}
              onChange={setFiltro}
              options={[
                ['todas', `Todas (${unidades.length})`],
                ['sin', 'Sin residente'],
                ['invitados', 'Sin primer ingreso'],
                ['suspendidos', 'Suspendidos'],
              ]}
            />
          )}
          <input className="input" style={{ maxWidth: 280, marginBottom: 16 }} placeholder="Buscar número, nombre o correo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        {filas.length ? (
          <ul className="list">
            {filas.map(({ u, rs }) => (
              <li key={u.id} style={{ display: 'block' }}>
                <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong style={{ color: 'var(--slate)' }}>{u.etiqueta}</strong>
                    <span className="list-sub">
                      {u.fechaEntrega ? ` · entrega ${fecha(u.fechaEntrega)}` : ''}
                      {u.propietario ? ` · propietario: ${u.propietario}` : ''}
                    </span>
                  </div>
                  {(gestionaUnidades || gestionaUsuarios) && (
                    <div className="row-actions">
                      <button className="linklike" onClick={() => setModal({ t: 'unidad', u })}>
                        Editar
                      </button>
                      {gestionaUnidades && !rs.length && (
                        <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => borrarUnidad(u)}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {veUsuarios && (rs.length ? rs.map(persona) : <div className="list-sub">Sin residente con acceso</div>)}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="building">
            {unidades.length ? 'Sin resultados con ese filtro.' : 'Descarga el machote, llénalo y súbelo con «Alta masiva», o agrega las unidades una por una.'}
          </Empty>
        )}
        {huerfanos.length > 0 && filtro === 'todas' && !q && (
          <>
            <h3 style={{ fontSize: '1rem' }}>Residentes sin unidad</h3>
            {huerfanos.map(persona)}
          </>
        )}
      </section>

      {veUsuarios && (
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: '1.1rem' }}>Caseta (vigilantes)</h2>
            {gestionaUsuarios && (
              <button className="btn-app sm secondary" onClick={() => setModal({ t: 'vigilante' })}>
                <Icon name="plus" />
                Agregar vigilante
              </button>
            )}
          </div>
          {vigilantes.length ? vigilantes.map(persona) : <Empty icon="shield">Sin vigilantes dados de alta.</Empty>}
        </section>
      )}

      {modal?.t === 'residente' && <AgregarResidente perfiles={perfiles.data ?? []} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'masiva' && <AltaMasiva perfiles={perfiles.data ?? []} actuales={filasActuales} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'vigilante' && <AgregarVigilante onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'unidad' && (
        <EditarUnidad u={modal.u} residentes={residentesDe(delCondo, modal.u.id)} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />
      )}
      {modal?.t === 'contrasena' && (
        <Contrasena p={modal.p} sinPrimerIngreso={sinPrimerIngreso(modal.p)} onClose={() => (setModal(null), cuentas.reload(true))} />
      )}
      {modal?.t === 'persona' && <EditarPersona p={modal.p} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'chat' && (
        <Modal title={`Chat con ${unidades.find((u) => u.id === modal.p.unidadId)?.etiqueta ?? ''} · ${modal.p.nombre || modal.p.email}`} onClose={() => setModal(null)} wide>
          <ChatUnidad unidadId={modal.p.unidadId!} />
        </Modal>
      )}
      {modal?.t === 'asignar' && <AsignarUnidad perfil={modal.p} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
    </div>
  );
}

/** Envía filas al servidor en grupos de 20 (crea unidades y da de alta residentes). */
async function importar(condominioId: string, filas: Omit<FilaMachote, 'linea'>[], avance?: (r: Resultado[]) => void) {
  const out: Resultado[] = [];
  for (let i = 0; i < filas.length; i += 20) {
    const r = await adminCall<Resultado[]>('residentes.importar', { condominioId, filas: filas.slice(i, i + 20) });
    out.push(...r);
    avance?.([...out]);
  }
  return out;
}

function AgregarResidente({ perfiles, onClose, onDone }: { perfiles: Perfil[]; onClose: () => void; onDone: () => void }) {
  const { condo, unidades } = useAdmin();
  const [f, setF] = useState({ numero: '', nombre: '', telefono: '', correo: '', fechaEntrega: '' });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const etiqueta = etiquetaUnidad(f.numero, condo!.tipoUnidad);
  const existe = unidades.find((u) => claveUnidad(u.etiqueta) === claveUnidad(etiqueta));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const correo = f.correo.trim().toLowerCase();
    const okk = await run(
      async () => {
        if (f.nombre.trim() && !correo) throw new Error('Escribe el correo del residente para enviarle sus accesos.');
        if (correo && perfiles.some((p) => p.email === correo)) throw new Error('Ya existe un usuario con ese correo.');
        const [r] = await importar(condo!.id, [{ ...f, correo }]);
        if (r?.error) throw new Error(r.error);
      },
      correo ? `${etiqueta} lista; enviamos los accesos a ${correo}.` : `${etiqueta} dada de alta.`,
    );
    if (okk) onDone();
  }
  return (
    <Modal title={`Agregar ${prefijoUnidad(condo!.tipoUnidad) === 'Depto' ? 'departamento' : 'casa'} o residente`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label={`Número de ${prefijoUnidad(condo!.tipoUnidad) === 'Depto' ? 'departamento' : 'casa'}`} hint={f.numero ? `${etiqueta}${existe ? ' (ya existe: se le agrega el residente)' : ' (nueva)'}` : undefined}>
            <input required maxLength={50} list="unidades-condo" value={f.numero} onChange={set('numero')} placeholder="A-101" />
            <datalist id="unidades-condo">
              {unidades.map((u) => (
                <option key={u.id} value={u.etiqueta} />
              ))}
            </datalist>
          </Field>
          <Field label="Fecha de entrega">
            <input type="date" value={f.fechaEntrega} onChange={set('fechaEntrega')} />
          </Field>
        </div>
        <Field label="Nombre del residente">
          <input maxLength={120} value={f.nombre} onChange={set('nombre')} />
        </Field>
        <div className="form-2">
          <Field label="Teléfono de contacto">
            <input type="tel" maxLength={20} value={f.telefono} onChange={set('telefono')} />
          </Field>
          <Field label="Correo electrónico" hint="Le enviamos su usuario y una contraseña temporal.">
            <input type="email" value={f.correo} onChange={set('correo')} />
          </Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Sin nombre ni correo solo se da de alta la {prefijoUnidad(condo!.tipoUnidad) === 'Depto' ? 'unidad' : 'casa'}; el residente se puede agregar después.
        </p>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : f.correo ? 'Guardar y enviar accesos' : 'Guardar'}
        </button>
      </form>
    </Modal>
  );
}

type FilaRevisada = FilaMachote & { etiqueta: string; error?: string; ignorada?: boolean; cambios: string[]; envio?: Omit<FilaMachote, 'linea'>; resultado?: Resultado };

/**
 * Compara cada fila con lo que ya existe. Una fila por casa o departamento: si el número se repite en el
 * archivo, esas filas se ignoran. Solo se envían las filas con cambios; lo que no cambió (o viene vacío) no se toca.
 */
function revisar(leidas: FilaMachote[], fechasInvalidas: number[], unidades: Unidad[], perfiles: Perfil[], tipoUnidad?: string | null): FilaRevisada[] {
  const porClave = new Map(unidades.map((u) => [claveUnidad(u.etiqueta), u]));
  const veces = new Map<string, number>();
  const clave = (f: FilaMachote) => claveUnidad(etiquetaUnidad(f.numero, tipoUnidad));
  leidas.forEach((f) => f.numero && veces.set(clave(f), (veces.get(clave(f)) ?? 0) + 1));
  const correosNuevos = new Set<string>();
  return leidas.map((f) => {
    const etiqueta = etiquetaUnidad(f.numero, tipoUnidad);
    const r: FilaRevisada = { ...f, etiqueta, cambios: [] };
    const u = porClave.get(clave(f));
    const otro = (correo: string, salvo?: Perfil) => perfiles.some((p) => p.email === correo && p.userId !== salvo?.userId);
    if (!f.numero) return { ...r, error: 'Falta el número' };
    if ((veces.get(clave(f)) ?? 0) > 1) return { ...r, ignorada: true, error: 'Número repetido en el archivo: no se toma en cuenta' };
    if (f.correo && !correoValido(f.correo)) return { ...r, error: 'Correo no válido' };
    if (fechasInvalidas.includes(f.linea)) return { ...r, error: 'Fecha no válida (usa día/mes/año)' };

    const envio = { numero: f.numero, nombre: '', telefono: '', correo: f.correo, fechaEntrega: '' };
    if (!u) r.cambios.push('unidad nueva');
    if (f.fechaEntrega && f.fechaEntrega !== (u?.fechaEntrega ?? '')) {
      envio.fechaEntrega = f.fechaEntrega;
      if (u) r.cambios.push('fecha de entrega');
    }
    const suyos = residentesDe(perfiles, u?.id);
    if (f.correo) {
      const mismo = suyos.find((p) => p.email === f.correo) ?? (suyos.length === 1 ? suyos[0] : undefined);
      if (mismo) {
        if (f.correo !== mismo.email) {
          if (otro(f.correo, mismo) || correosNuevos.has(f.correo)) return { ...r, error: 'Ya existe un usuario con ese correo' };
          if (mismo.estado !== 'APROBADO' && mismo.estado !== 'SUSPENDIDO') return { ...r, error: 'El residente aún no está autorizado' };
          r.cambios.push('correo (se envían accesos nuevos)');
        }
        if (f.nombre && f.nombre !== mismo.nombre) {
          envio.nombre = f.nombre;
          r.cambios.push('nombre');
        }
        if (f.telefono && digitos(f.telefono) !== digitos(mismo.telefono)) {
          envio.telefono = f.telefono;
          r.cambios.push('teléfono');
        }
      } else if (suyos.length) {
        return { ...r, error: 'La unidad tiene varios residentes; cámbialos desde la lista' };
      } else {
        if (otro(f.correo) || correosNuevos.has(f.correo)) return { ...r, error: 'Ya existe un usuario con ese correo' };
        Object.assign(envio, { nombre: f.nombre, telefono: f.telefono });
        r.cambios.push('residente nuevo (se envían accesos)');
      }
      correosNuevos.add(f.correo);
    } else if (f.nombre && !suyos.length) {
      return { ...r, error: 'Falta el correo del residente' };
    }
    return r.cambios.length ? { ...r, envio } : r;
  });
}

function AltaMasiva({ perfiles, actuales, onClose, onDone }: { perfiles: Perfil[]; actuales: () => FilaActual[]; onClose: () => void; onDone: () => void }) {
  const { condo, unidades } = useAdmin();
  const [filas, setFilas] = useState<FilaRevisada[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState('');
  const delCondo = perfiles.filter((p) => p.condominioId === condo!.id);

  async function cargar(file?: File) {
    if (!file) return;
    setErrorArchivo('');
    setLeyendo(true);
    try {
      const { filas: leidas, fechasInvalidas } = await leerMachote(file);
      if (!leidas.length) throw new Error('El archivo no tiene filas con datos. Usa el machote y llena la hoja «Residentes».');
      // Correos de todo el sistema para detectar duplicados; residentes solo de este condominio.
      const revisadas = revisar(leidas, fechasInvalidas, unidades, delCondo, condo!.tipoUnidad).map((r) =>
        !r.error && r.correo && perfiles.some((p) => p.email === r.correo && p.condominioId !== condo!.id)
          ? { ...r, cambios: [], envio: undefined, error: 'Ya existe un usuario con ese correo' }
          : r,
      );
      setFilas(revisadas);
      setArchivo(file.name);
    } catch (e) {
      setErrorArchivo(errMsg(e));
    } finally {
      setLeyendo(false);
    }
  }

  async function enviar() {
    if (!filas) return;
    setEnviando(true);
    const pendientes = filas.filter((f) => f.envio && !f.error && !f.resultado);
    try {
      await importar(
        condo!.id,
        pendientes.map((f) => f.envio!),
        (rs) => setFilas((prev) => prev && prev.map((f) => (pendientes.indexOf(f) >= 0 && rs[pendientes.indexOf(f)] ? { ...f, resultado: rs[pendientes.indexOf(f)] } : f))),
      );
    } catch (e) {
      setErrorArchivo(errMsg(e));
    }
    setEnviando(false);
  }

  const porGuardar = filas?.filter((f) => f.envio && !f.error && !f.resultado).length ?? 0;
  const procesadas = filas?.filter((f) => f.resultado).length ?? 0;
  const sinCambios = filas?.filter((f) => !f.error && !f.cambios.length).length ?? 0;
  const ignoradas = filas?.filter((f) => f.ignorada).length ?? 0;
  const conError = filas?.filter((f) => (f.error && !f.ignorada) || f.resultado?.error).length ?? 0;
  const estado = (f: FilaRevisada) => {
    if (f.resultado?.error) return <Badge estado="RECHAZADO">{f.resultado.error}</Badge>;
    if (f.resultado) return <Badge estado="APROBADO">{f.resultado.acceso ? 'Guardado · accesos enviados' : 'Guardado'}</Badge>;
    if (f.ignorada) return <Badge estado="CANCELADO">{f.error}</Badge>;
    if (f.error) return <Badge estado="RECHAZADO">{f.error}</Badge>;
    if (!f.cambios.length) return <span className="small muted">Sin cambios</span>;
    return <Badge estado="PROGRAMADA">{f.cambios.join(', ').replace(/^./, (x) => x.toUpperCase())}</Badge>;
  };
  const tipo = prefijoUnidad(condo!.tipoUnidad) === 'Depto' ? 'departamento' : 'casa';

  return (
    <Modal title={`Alta masiva · ${condo!.nombre}`} onClose={procesadas ? onDone : onClose} wide>
      <div className="form">
        {!filas ? (
          <>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                Descarga el machote: viene lleno con los {tipo}s y residentes actuales de {condo!.nombre}.{' '}
                <button type="button" className="linklike" onClick={() => descargarMachote({ condominio: condo!.nombre, filas: actuales() }).catch((e) => setErrorArchivo(errMsg(e)))}>
                  Descargar machote
                </button>
              </li>
              <li>Corrige lo que necesites y agrega filas nuevas: una sola fila por {tipo} (número, nombre del residente, teléfono, correo y fecha de entrega).</li>
              <li>Súbelo aquí. Te mostramos qué cambia antes de guardar; lo que no cambió no se toca.</li>
            </ol>
            <Field label="Archivo de Excel" hint="Formatos .xlsx, .xls o .csv.">
              <input type="file" accept=".xlsx,.xls,.csv" disabled={leyendo} onChange={(e) => cargar(e.target.files?.[0])} />
            </Field>
            {leyendo && <Loading />}
          </>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>
              <strong>{archivo}</strong> · {filas.length} fila(s) · <strong>{porGuardar} con cambios</strong> · {sinCambios} sin cambios
              {ignoradas ? ` · ${ignoradas} ignorada(s) por número repetido` : ''}
              {conError ? ` · ${conError} con error` : ''}.{' '}
              {!enviando && !procesadas && (
                <button type="button" className="linklike" onClick={() => setFilas(null)}>
                  Cambiar archivo
                </button>
              )}
            </p>
            <div className="table-wrap" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Unidad</th>
                    <th>Residente</th>
                    <th>Correo</th>
                    <th>Entrega</th>
                    <th>Qué cambia</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.linea} style={!f.cambios.length && !f.error ? { opacity: 0.6 } : undefined}>
                      <td>{f.linea}</td>
                      <td>
                        <strong>{f.etiqueta || '—'}</strong>
                      </td>
                      <td>
                        {f.nombre || '—'}
                        {f.telefono && <div className="list-sub">{f.telefono}</div>}
                      </td>
                      <td style={{ overflowWrap: 'anywhere' }}>{f.correo || '—'}</td>
                      <td>{f.fechaEntrega ? fecha(f.fechaEntrega) : '—'}</td>
                      <td>{estado(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-actions">
              {porGuardar > 0 && (
                <button type="button" className="btn-app" disabled={enviando} onClick={enviar}>
                  <Icon name="upload" />
                  {enviando ? `Guardando… (${procesadas} de ${procesadas + porGuardar})` : `Guardar ${porGuardar} cambio(s)`}
                </button>
              )}
              {(procesadas > 0 || !porGuardar) && !enviando && (
                <button type="button" className="btn-app secondary" onClick={procesadas ? onDone : onClose}>
                  Terminar
                </button>
              )}
            </div>
            {conError > 0 && (
              <p className="small muted" style={{ margin: 0 }}>
                Las filas con error no se guardan. Corrígelas en el archivo y vuelve a subirlo: lo que ya se guardó aparecerá como «Sin cambios».
              </p>
            )}
          </>
        )}
        {errorArchivo && <div className="alert error">{errorArchivo}</div>}
      </div>
    </Modal>
  );
}

function AgregarVigilante({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condoId } = useAdmin();
  const [f, setF] = useState({ email: '', nombre: '', telefono: '' });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(() => adminCall('crearUsuario', { ...f, rol: 'VIGILANTE', condominioId: condoId }), `Alta realizada; enviamos los accesos a ${f.email}.`);
    if (okk) onDone();
  }
  return (
    <Modal title="Agregar vigilante" onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Correo electrónico" hint="Le enviamos su usuario y una contraseña temporal para la app de caseta.">
          <input required type="email" value={f.email} onChange={set('email')} />
        </Field>
        <div className="form-2">
          <Field label="Nombre completo">
            <input required maxLength={120} value={f.nombre} onChange={set('nombre')} />
          </Field>
          <Field label="Teléfono">
            <input type="tel" maxLength={20} value={f.telefono} onChange={set('telefono')} />
          </Field>
        </div>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Dar de alta y enviar accesos'}
        </button>
      </form>
    </Modal>
  );
}

type DatosPersona = { nombre: string; telefono: string; email: string };
const datosDe = (p: Perfil): DatosPersona => ({ nombre: p.nombre ?? '', telefono: p.telefono ?? '', email: p.email });

/** Guarda nombre, teléfono y correo si cambiaron. Si cambia el correo, el servidor envía accesos nuevos. */
async function guardarPersona(p: Perfil, d: DatosPersona) {
  const antes = datosDe(p);
  const cambia = (k: keyof DatosPersona) => d[k].trim() !== antes[k];
  if (!cambia('nombre') && !cambia('telefono') && !cambia('email')) return false;
  if (!d.email.trim()) throw new Error('El correo no puede quedar vacío.');
  await adminCall('residentes.editar', { userId: p.userId, nombre: d.nombre, telefono: d.telefono, email: d.email });
  return cambia('email');
}

function CamposPersona({ d, onChange, disabled }: { d: DatosPersona; onChange: (d: DatosPersona) => void; disabled?: boolean }) {
  const set = (k: keyof DatosPersona) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...d, [k]: e.target.value });
  return (
    <>
      <Field label="Nombre">
        <input required maxLength={120} value={d.nombre} onChange={set('nombre')} disabled={disabled} />
      </Field>
      <div className="form-2">
        <Field label="Teléfono">
          <input type="tel" maxLength={20} value={d.telefono} onChange={set('telefono')} disabled={disabled} />
        </Field>
        <Field label="Correo electrónico" hint="Es su usuario. Si lo cambias, le enviamos accesos nuevos a ese correo.">
          <input required type="email" value={d.email} onChange={set('email')} disabled={disabled} />
        </Field>
      </div>
    </>
  );
}

function EditarUnidad({ u, residentes, onClose, onDone }: { u: Unidad; residentes: Perfil[]; onClose: () => void; onDone: () => void }) {
  const { puede, unidades, condoId } = useAdmin();
  const gestionaUnidad = puede('condominios', 'editar');
  const gestionaUsuarios = puede('usuarios', 'editar');
  const [f, setF] = useState({ etiqueta: u.etiqueta, fechaEntrega: u.fechaEntrega ?? '', propietario: u.propietario ?? '', notas: u.notas ?? '' });
  const [personas, setPersonas] = useState<DatosPersona[]>(() => residentes.map(datosDe));
  // Casa o departamento de cada residente: cambiarla aquí lo mueve de unidad.
  const [destino, setDestino] = useState<string[]>(() => residentes.map((p) => p.unidadId ?? u.id));
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    let accesos = 0;
    let movidos = 0;
    const okk = await run(async () => {
      const unidadCambia =
        f.etiqueta.trim() !== u.etiqueta || f.fechaEntrega !== (u.fechaEntrega ?? '') || f.propietario !== (u.propietario ?? '') || f.notas !== (u.notas ?? '');
      if (gestionaUnidad && unidadCambia) {
        ok(
          await db.models.Unidad.update({
            id: u.id,
            etiqueta: f.etiqueta.trim(),
            fechaEntrega: f.fechaEntrega || null,
            propietario: f.propietario || null,
            notas: f.notas || null,
          }),
        );
      }
      if (gestionaUsuarios) for (const [i, p] of residentes.entries()) if (await guardarPersona(p, personas[i])) accesos++;
      if (gestionaUsuarios)
        for (const [i, p] of residentes.entries()) {
          if (destino[i] && destino[i] !== (p.unidadId ?? u.id)) {
            await adminCall('aprobar', { userId: p.userId, rol: 'RESIDENTE', condominioId: condoId, unidadId: destino[i] });
            movidos++;
          }
        }
    }, 'Cambios guardados');
    if (okk) {
      if (accesos) alert('Enviamos accesos nuevos al correo actualizado.');
      if (movidos) alert(`${movidos === 1 ? 'El residente cambió' : 'Los residentes cambiaron'} de casa o departamento.`);
      onDone();
    }
  }
  return (
    <Modal title={`Editar ${u.etiqueta}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Identificador">
            <input required maxLength={60} value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })} disabled={!gestionaUnidad} />
          </Field>
          <Field label="Fecha de entrega">
            <input type="date" value={f.fechaEntrega} onChange={(e) => setF({ ...f, fechaEntrega: e.target.value })} disabled={!gestionaUnidad} />
          </Field>
        </div>
        {residentes.map((p, i) => (
          <fieldset key={p.userId} className="fld" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, margin: 0, display: 'grid', gap: 12 }}>
            <span>Residente{residentes.length > 1 ? ` ${i + 1}` : ''}</span>
            <CamposPersona d={personas[i]} onChange={(d) => setPersonas(personas.map((x, j) => (j === i ? d : x)))} disabled={!gestionaUsuarios} />
            {p.estado === 'APROBADO' && (
              <Field label="Casa o departamento" hint="Para mover al residente a otra unidad del condominio.">
                <select value={destino[i]} onChange={(e) => setDestino(destino.map((x, j) => (j === i ? e.target.value : x)))} disabled={!gestionaUsuarios}>
                  {unidades.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.etiqueta}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </fieldset>
        ))}
        <Field label="Propietario" hint="Si es distinto del residente (por ejemplo, unidad rentada).">
          <input maxLength={120} value={f.propietario} onChange={(e) => setF({ ...f, propietario: e.target.value })} disabled={!gestionaUnidad} />
        </Field>
        <Field label="Notas">
          <textarea maxLength={500} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} disabled={!gestionaUnidad} />
        </Field>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </Modal>
  );
}

function EditarPersona({ p, onClose, onDone }: { p: Perfil; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(datosDe(p));
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    let nuevoCorreo = false;
    const okk = await run(async () => {
      nuevoCorreo = await guardarPersona(p, d);
    }, 'Datos guardados');
    if (okk) {
      if (nuevoCorreo) alert(`Enviamos accesos nuevos a ${d.email}.`);
      onDone();
    }
  }
  return (
    <Modal title={`Editar ${p.nombre || p.email}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <CamposPersona d={d} onChange={setD} />
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </Modal>
  );
}

/** Dos formas de dar acceso: reenviarlo al correo registrado o generar una contraseña para compartirla. */
export function Contrasena({ p, sinPrimerIngreso, onClose }: { p: Perfil; sinPrimerIngreso: boolean; onClose: () => void }) {
  const [escribir, setEscribir] = useState(false);
  const [pass, setPass] = useState('');
  const [generada, setGenerada] = useState('');
  const [copiado, setCopiado] = useState(false);
  const reglas: [string, boolean][] = [
    ['8 caracteres o más', pass.length >= 8],
    ['Una mayúscula', /[A-Z]/.test(pass)],
    ['Una minúscula', /[a-z]/.test(pass)],
    ['Un número', /\d/.test(pass)],
    ['Un símbolo (por ejemplo - $ ! # ?)', /[^A-Za-z0-9\s]/.test(pass)],
    ['Sin espacios', !!pass && !/\s/.test(pass)],
  ];
  const valida = reglas.every(([, ok]) => ok);
  const { run, busy } = useAction();
  const nombre = p.nombre || p.email;
  const aviso = sinPrimerIngreso ? '' : ' Su contraseña actual dejará de funcionar.';

  const reenviar = async () => {
    if (!confirm(`¿Enviar un acceso nuevo a ${p.email}?${aviso}`)) return;
    if (await run(() => adminCall('reenviarAcceso', { userId: p.userId }), `Accesos enviados a ${p.email}`)) onClose();
  };
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valida) return;
    if (!confirm(`¿Asignar esta contraseña a ${nombre}?${aviso} Se cerrará su sesión en sus dispositivos.`)) return;
    if (await run(() => adminCall('generarContrasena', { userId: p.userId, password: pass }), 'Contraseña asignada')) setGenerada(pass);
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(generada);
      setCopiado(true);
    } catch {
      /* el texto queda visible para copiarlo a mano */
    }
  };
  const tel = (p.telefono ?? '').replace(/\D/g, '');
  const mensaje = `Hola ${p.nombre ?? ''}. Tus datos para entrar al portal SIIA (${location.origin}/portal/):\nUsuario: ${p.email}\nContraseña: ${generada}`;

  return (
    <Modal title={`Contraseña de ${nombre}`} onClose={onClose}>
      {generada ? (
        <div className="form">
          <p style={{ margin: 0 }}>Comparte estos datos con {nombre}. Es su contraseña definitiva para entrar al portal.</p>
          <div className="alert" style={{ display: 'grid', gap: 6 }}>
            <div>
              Usuario: <strong style={{ overflowWrap: 'anywhere' }}>{p.email}</strong>
            </div>
            <div>
              Contraseña: <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '1.25rem', letterSpacing: 1 }}>{generada}</strong>
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="btn-app" onClick={copiar}>
              <Icon name="check" />
              {copiado ? 'Copiada' : 'Copiar contraseña'}
            </button>
            <a
              className="btn-app secondary"
              href={`https://wa.me/${tel.length === 10 ? `52${tel}` : tel}?text=${encodeURIComponent(mensaje)}`}
              target="_blank"
              rel="noopener"
            >
              <Icon name="chat" />
              Enviar por WhatsApp
            </a>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Por seguridad no volveremos a mostrarla. Si se pierde, asigna otra.
          </p>
          <button type="button" className="btn-app secondary" onClick={onClose}>
            Listo
          </button>
        </div>
      ) : escribir ? (
        <form className="form" onSubmit={guardar}>
          <Field label={`Nueva contraseña para ${nombre}`} hint="Escríbela tal como se la vas a compartir. Será su contraseña para entrar al portal.">
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              style={{ fontFamily: 'Consolas, monospace', fontSize: '1.1rem' }}
            />
          </Field>
          <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 2 }}>
            {reglas.map(([t, ok]) => (
              <li key={t} style={{ color: ok ? 'var(--teal-dark)' : 'var(--muted)' }}>
                {ok ? '✓' : '○'} {t}
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button className="btn-app" disabled={!valida || busy}>
              {busy ? 'Guardando…' : 'Asignar contraseña'}
            </button>
            <button type="button" className="btn-app secondary" disabled={busy} onClick={() => setEscribir(false)}>
              Regresar
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <section className="panel" style={{ margin: 0 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Reenviar acceso al correo</h3>
            <p className="small muted">
              Enviamos a <strong>{p.email}</strong> su usuario y una contraseña temporal; al entrar por primera vez crea la suya.
            </p>
            <button type="button" className="btn-app secondary" disabled={busy} onClick={reenviar}>
              <Icon name="mail" />
              Reenviar acceso
            </button>
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Generar contraseña</h3>
            <p className="small muted">
              Para quien no revisa o no tiene correo: tú escribes la contraseña, se la compartes (en persona o por WhatsApp) y con ella entra
              directo al portal.
            </p>
            <button type="button" className="btn-app" disabled={busy} onClick={() => setEscribir(true)}>
              <Icon name="shield" />
              Generar contraseña
            </button>
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Autorizar una solicitud o cambiar de unidad a un residente (dentro del mismo condominio). */
function AsignarUnidad({ perfil, onClose, onDone }: { perfil: Perfil; onClose: () => void; onDone: () => void }) {
  const { condoId, unidades } = useAdmin();
  const sugerida = perfil.unidadSolicitada ? unidades.find((u) => claveUnidad(u.etiqueta).endsWith(claveUnidad(perfil.unidadSolicitada!))) : undefined;
  const [rol, setRol] = useState(perfil.rol === 'VIGILANTE' ? 'VIGILANTE' : 'RESIDENTE');
  const [unidadId, setUnidadId] = useState(perfil.unidadId ?? sugerida?.id ?? '');
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(
      () => adminCall('aprobar', { userId: perfil.userId, rol, condominioId: condoId, unidadId: rol === 'RESIDENTE' ? unidadId : null }),
      perfil.estado === 'APROBADO' ? 'Unidad actualizada' : 'Acceso autorizado',
    );
    if (okk) onDone();
  }
  return (
    <Modal title={perfil.estado === 'APROBADO' ? `Cambiar unidad de ${perfil.nombre || perfil.email}` : `Autorizar a ${perfil.nombre || perfil.email}`} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <div className="alert small">
          {perfil.email}
          {perfil.unidadSolicitada && (
            <>
              {' '}
              · Solicitó: <strong>{perfil.unidadSolicitada}</strong>
            </>
          )}
          {perfil.telefono && ` · Tel. ${perfil.telefono}`}
        </div>
        {perfil.estado !== 'APROBADO' && (
          <Field label="Rol">
            <select value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="RESIDENTE">Residente</option>
              <option value="VIGILANTE">Vigilante (caseta)</option>
            </select>
          </Field>
        )}
        {rol === 'RESIDENTE' && (
          <Field label="Unidad">
            <select required value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
              <option value="">{unidades.length ? 'Selecciona…' : 'Este condominio no tiene unidades'}</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : perfil.estado === 'APROBADO' ? 'Guardar' : 'Autorizar acceso'}
        </button>
      </form>
    </Modal>
  );
}
