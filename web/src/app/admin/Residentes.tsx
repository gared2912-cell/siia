// Residentes de un condominio: sus casas o departamentos con quién vive en cada uno, el personal de caseta
// y las solicitudes de acceso. Alta uno por uno o masiva con el machote de Excel.
import { useMemo, useState } from 'react';
import { adminCall, all, db, ok, type Schema } from '../api';
import { Firma } from './Firma';
import { Acciones, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, Seg, Tarjeta, TarjetaIcono, Tarjetas, errMsg, fecha, useAction, useLoad, useToast, type Tono } from '../ui';
import { claveUnidad, etiquetaUnidad, prefijoUnidad } from '../../../amplify/functions/shared/unidades';
import { useAdmin, type Unidad } from './AdminApp';
import { descargarMachote, leerMachote, type FilaActual, type FilaMachote } from './excel';
import { ChatUnidad } from './Comunicacion';

type Perfil = Schema['Perfil']['type'];
type Cuenta = { status?: string; enabled?: boolean; creado?: string };
type Resultado = { etiqueta: string; unidad?: 'creada' | 'existente'; acceso?: boolean; correo?: boolean; cambios?: string[]; error?: string };
type Alta = { correoEnviado?: boolean; correoPedido?: boolean };

/** ¿Se pidió enviar correo? (formularios con dos botones: «… y enviar accesos» / «… sin enviar correo»). */
export const conCorreo = (e: React.FormEvent) => ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value !== 'sin-correo';

/** Aviso después de dar de alta una cuenta, según si salió el correo con sus accesos. */
export function avisoAlta(r: Alta, email: string) {
  if (r.correoEnviado) return `Alta realizada; enviamos los accesos a ${email}.`;
  if (r.correoPedido)
    return `Alta realizada, pero no se envió el correo: se alcanzó el límite de correos de hoy. Envíale sus accesos mañana o asígnale una contraseña con el botón «Contraseña».`;
  return `Alta realizada sin enviar correo. Cuando quieras, envíale sus accesos o asígnale una contraseña con el botón «Contraseña».`;
}
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
    | { t: 'ficha-u'; id: string }
    | { t: 'ficha-p'; id: string }
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
    .filter(({ u, rs }) => !q || `${u.etiqueta} ${u.propietario ?? ''} ${rs.map((p) => `${p.nombre} ${p.email} ${p.telefono ?? ''} ${p.telefono2 ?? ''}`).join(' ')}`.toLowerCase().includes(q));

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
      return [u.etiqueta, p?.nombre ?? '', p?.telefono ?? '', p?.telefono2 ?? '', p?.email ?? '', u.fechaEntrega ?? ''];
    });

  const sinTipo = !c.tipoUnidad;
  // Crear unidades pide «Gestionar» en Condominios; si la fila trae correo, el servidor pide además «Gestionar» en Usuarios.
  const puedeAlta = gestionaUnidades;

  /** Acciones de un residente o vigilante según su estado. */
  const acciones = (p: Perfil) =>
    (gestionaUsuarios || veChat) && (
      <Acciones>
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
      </Acciones>
    );

  /** Color de la tarjeta de una persona: verde con acceso, ámbar por activar o solicitud, rojo suspendido. */
  const tonoPersona = (p: Perfil): Tono =>
    p.estado === 'SUSPENDIDO' || p.estado === 'RECHAZADO' ? 'mal' : p.estado === 'PENDIENTE' || sinPrimerIngreso(p) || p.accesoSinEnviar ? 'warn' : p.estado === 'APROBADO' ? 'ok' : 'neutro';
  const insignias = (p: Perfil) => (
    <>
      {p.estado !== 'APROBADO' && <Badge estado={p.estado} />}
      {sinPrimerIngreso(p) && <Badge estado="PENDIENTE">Sin primer ingreso</Badge>}
      {p.estado === 'APROBADO' && p.accesoSinEnviar && <Badge estado="PENDIENTE">Accesos sin enviar</Badge>}
      {p.estado === 'APROBADO' && !sinPrimerIngreso(p) && !p.accesoSinEnviar && <Badge estado="APROBADO">Con acceso</Badge>}
    </>
  );
  const tarjetaPersona = (p: Perfil) => (
    <Tarjeta
      key={p.userId}
      tono={tonoPersona(p)}
      onClick={() => setModal({ t: 'ficha-p', id: p.userId })}
      media={<TarjetaIcono name={p.rol === 'VIGILANTE' ? 'shield' : 'users'} />}
      titulo={p.nombre || p.email}
      sub={[p.email, p.telefono, p.estado === 'PENDIENTE' && p.unidadSolicitada ? `solicitó: ${p.unidadSolicitada}` : ''].filter(Boolean).join(' · ')}
      lado={insignias(p)}
    />
  );
  /** Color de la tarjeta de una unidad según sus residentes. */
  const tonoUnidad = (rs: Perfil[]): Tono => {
    if (!rs.length) return 'neutro';
    if (rs.some((p) => p.estado === 'SUSPENDIDO' || p.estado === 'RECHAZADO')) return 'mal';
    if (rs.some((p) => sinPrimerIngreso(p) || p.accesoSinEnviar)) return 'warn';
    return rs.some((p) => p.estado === 'APROBADO') ? 'ok' : 'neutro';
  };

  const persona = (p: Perfil) => (
    <div className="stack" key={p.userId}>
      <div className="row-actions">{insignias(p)}</div>
      <Datos
        items={[
          ['Correo', p.email],
          ['Teléfono', [p.telefono, p.telefono2].filter(Boolean).join(' · ')],
          ['Casa o departamento', unidades.find((u) => u.id === p.unidadId)?.etiqueta],
          ['Solicitó', p.estado === 'PENDIENTE' ? p.unidadSolicitada : null],
          ['Nota', p.nota],
        ]}
      />
      <Firma item={p} alta="Alta por" />
      {acciones(p)}
    </div>
  );
  const fichaU = modal?.t === 'ficha-u' ? unidades.find((u) => u.id === modal.id) : undefined;
  const fichaP = modal?.t === 'ficha-p' ? delCondo.find((p) => p.userId === modal.id) : undefined;

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
          <Tarjetas>{solicitudes.map(tarjetaPersona)}</Tarjetas>
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
          <Tarjetas>
            {filas.map(({ u, rs }) => (
              <Tarjeta
                key={u.id}
                tono={veUsuarios ? tonoUnidad(rs) : 'neutro'}
                onClick={() => setModal({ t: 'ficha-u', id: u.id })}
                media={<TarjetaIcono name="building" />}
                titulo={u.etiqueta}
                sub={
                  veUsuarios
                    ? rs.map((p) => p.nombre || p.email).join(', ') || 'Sin residente con acceso'
                    : [u.propietario && `Propietario: ${u.propietario}`, u.fechaEntrega && `Entrega ${fecha(u.fechaEntrega)}`].filter(Boolean).join(' · ') || undefined
                }
                lado={
                  veUsuarios
                    ? rs.length
                      ? rs.some((p) => p.estado === 'SUSPENDIDO' || p.estado === 'RECHAZADO')
                        ? <Badge estado="SUSPENDIDO">Suspendido</Badge>
                        : rs.some((p) => sinPrimerIngreso(p) || p.accesoSinEnviar)
                          ? <Badge estado="PENDIENTE">Por activar</Badge>
                          : <Badge estado="APROBADO">Con acceso</Badge>
                      : <Badge>Sin residente</Badge>
                    : undefined
                }
              />
            ))}
          </Tarjetas>
        ) : (
          <Empty icon="building">
            {unidades.length ? 'Sin resultados con ese filtro.' : 'Descarga el machote, llénalo y súbelo con «Alta masiva», o agrega las unidades una por una.'}
          </Empty>
        )}
        {huerfanos.length > 0 && filtro === 'todas' && !q && (
          <>
            <h3 style={{ fontSize: '1rem' }}>Residentes sin unidad</h3>
            <Tarjetas>{huerfanos.map(tarjetaPersona)}</Tarjetas>
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
          {vigilantes.length ? <Tarjetas>{vigilantes.map(tarjetaPersona)}</Tarjetas> : <Empty icon="shield">Sin vigilantes dados de alta.</Empty>}
        </section>
      )}

      {modal?.t === 'residente' && <AgregarResidente perfiles={perfiles.data ?? []} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'masiva' && <AltaMasiva perfiles={perfiles.data ?? []} actuales={filasActuales} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'vigilante' && <AgregarVigilante onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
      {modal?.t === 'unidad' && (
        <EditarUnidad u={modal.u} residentes={residentesDe(delCondo, modal.u.id)} perfiles={perfiles.data ?? []} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />
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
      {fichaU && (
        <Modal title={fichaU.etiqueta} onClose={() => setModal(null)}>
          <div className="stack">
            <Datos
              items={[
                ['Propietario', fichaU.propietario],
                ['Fecha de entrega', fichaU.fechaEntrega ? fecha(fichaU.fechaEntrega) : null],
              ]}
            />
            {veUsuarios && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="acciones-titulo">Residentes</span>
                {porUnidad(fichaU.id).length ? (
                  <Tarjetas>{porUnidad(fichaU.id).map(tarjetaPersona)}</Tarjetas>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    Sin residente con acceso.
                  </p>
                )}
              </div>
            )}
            {(gestionaUnidades || gestionaUsuarios) && (
              <Acciones>
                <button className="btn-app secondary" onClick={() => setModal({ t: 'unidad', u: fichaU })}>
                  Editar {prefijoUnidad(c.tipoUnidad) === 'Depto' ? 'departamento' : 'casa'} y residente
                </button>
                {gestionaUnidades && !porUnidad(fichaU.id).length && (
                  <button className="btn-app danger" onClick={() => (setModal(null), borrarUnidad(fichaU))}>
                    <Icon name="trash" />
                    Eliminar
                  </button>
                )}
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {fichaP && (
        <Modal title={fichaP.nombre || fichaP.email || 'Residente'} onClose={() => setModal(null)}>
          {persona(fichaP)}
        </Modal>
      )}
      {modal?.t === 'asignar' && <AsignarUnidad perfil={modal.p} onClose={() => setModal(null)} onDone={() => (setModal(null), recargar())} />}
    </div>
  );
}

/** Envía filas al servidor en grupos de 20 (crea unidades y da de alta residentes). */
async function importar(condominioId: string, filas: (Omit<FilaMachote, 'linea'> & { unidadId?: string })[], enviarCorreo: boolean, avance?: (r: Resultado[]) => void) {
  const out: Resultado[] = [];
  for (let i = 0; i < filas.length; i += 20) {
    const r = await adminCall<Resultado[]>('residentes.importar', { condominioId, filas: filas.slice(i, i + 20), enviarCorreo });
    out.push(...r);
    avance?.([...out]);
  }
  return out;
}

/** «¿Se envían los accesos por correo?»: un botón para cada respuesta. */
export function BotonesAlta({ busy, disabled, texto = 'Guardar' }: { busy: boolean; disabled?: boolean; texto?: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="small">¿Le enviamos sus accesos (usuario y contraseña temporal) por correo?</span>
      <div className="row-actions">
        <button className="btn-app" value="con-correo" disabled={busy || disabled}>
          <Icon name="mail" />
          {busy ? 'Guardando…' : `Sí, ${texto.toLowerCase()} y enviar correo`}
        </button>
        <button className="btn-app secondary" value="sin-correo" disabled={busy || disabled}>
          {busy ? 'Guardando…' : `No, solo ${texto.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

function AgregarResidente({ perfiles, onClose, onDone }: { perfiles: Perfil[]; onClose: () => void; onDone: () => void }) {
  const { condo, unidades } = useAdmin();
  const toast = useToast();
  const [f, setF] = useState({ numero: '', nombre: '', telefono: '', telefono2: '', correo: '', fechaEntrega: '' });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const etiqueta = etiquetaUnidad(f.numero, condo!.tipoUnidad);
  const existe = unidades.find((u) => claveUnidad(u.etiqueta) === claveUnidad(etiqueta));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const correo = f.correo.trim().toLowerCase();
    const enviar = conCorreo(e);
    let r: Resultado | undefined;
    const okk = await run(async () => {
      if (f.nombre.trim() && !correo) throw new Error('Escribe el correo del residente: es su usuario para entrar al portal.');
      if (correo && perfiles.some((p) => p.email === correo)) throw new Error('Ya existe un usuario con ese correo.');
      [r] = await importar(condo!.id, [{ ...f, correo }], enviar);
      if (r?.error) throw new Error(r.error);
    });
    if (okk) {
      if (r?.acceso) alert(`${etiqueta}: ${avisoAlta({ correoEnviado: r.correo, correoPedido: enviar }, correo)}`);
      else toast(`${etiqueta} guardada.`);
      onDone();
    }
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
          <Field label="Teléfono 2">
            <input type="tel" maxLength={20} value={f.telefono2} onChange={set('telefono2')} />
          </Field>
        </div>
        <Field label="Correo electrónico" hint="Es su usuario. Puedes enviarle ahora su contraseña temporal por correo o hacerlo después.">
          <input type="email" value={f.correo} onChange={set('correo')} />
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          Sin nombre ni correo solo se da de alta la {prefijoUnidad(condo!.tipoUnidad) === 'Depto' ? 'unidad' : 'casa'}; el residente se puede agregar después.
        </p>
        {f.correo.trim() ? (
          <BotonesAlta busy={busy} />
        ) : (
          <button className="btn-app" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        )}
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

    const envio = { numero: f.numero, nombre: '', telefono: '', telefono2: '', correo: f.correo, fechaEntrega: '' };
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
          r.cambios.push('correo (accesos nuevos)');
        }
        if (f.nombre && f.nombre !== mismo.nombre) {
          envio.nombre = f.nombre;
          r.cambios.push('nombre');
        }
        if (f.telefono && digitos(f.telefono) !== digitos(mismo.telefono)) {
          envio.telefono = f.telefono;
          r.cambios.push('teléfono');
        }
        if (f.telefono2 && digitos(f.telefono2) !== digitos(mismo.telefono2)) {
          envio.telefono2 = f.telefono2;
          r.cambios.push('teléfono 2');
        }
      } else if (suyos.length) {
        return { ...r, error: 'La unidad tiene varios residentes; cámbialos desde la lista' };
      } else {
        if (otro(f.correo) || correosNuevos.has(f.correo)) return { ...r, error: 'Ya existe un usuario con ese correo' };
        Object.assign(envio, { nombre: f.nombre, telefono: f.telefono, telefono2: f.telefono2 });
        r.cambios.push('residente nuevo (accesos)');
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
  const [conCorreoMasivo, setConCorreoMasivo] = useState(true);
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

  async function enviar(enviarCorreo: boolean) {
    if (!filas) return;
    setEnviando(true);
    setConCorreoMasivo(enviarCorreo);
    const pendientes = filas.filter((f) => f.envio && !f.error && !f.resultado);
    try {
      await importar(
        condo!.id,
        pendientes.map((f) => f.envio!),
        enviarCorreo,
        (rs) => setFilas((prev) => prev && prev.map((f) => (pendientes.indexOf(f) >= 0 && rs[pendientes.indexOf(f)] ? { ...f, resultado: rs[pendientes.indexOf(f)] } : f))),
      );
    } catch (e) {
      setErrorArchivo(errMsg(e));
    }
    setEnviando(false);
  }

  const porGuardar = filas?.filter((f) => f.envio && !f.error && !f.resultado).length ?? 0;
  // Altas nuevas o cambios de correo: a estos se les puede enviar su acceso por correo.
  const conAcceso = filas?.filter((f) => f.envio && !f.error && !f.resultado && f.cambios.some((c) => c.includes('accesos'))).length ?? 0;
  const sinCorreoEnviado = filas?.filter((f) => f.resultado?.acceso && !f.resultado.correo).length ?? 0;
  const procesadas = filas?.filter((f) => f.resultado).length ?? 0;
  const sinCambios = filas?.filter((f) => !f.error && !f.cambios.length).length ?? 0;
  const ignoradas = filas?.filter((f) => f.ignorada).length ?? 0;
  const conError = filas?.filter((f) => (f.error && !f.ignorada) || f.resultado?.error).length ?? 0;
  const estado = (f: FilaRevisada) => {
    if (f.resultado?.error) return <Badge estado="RECHAZADO">{f.resultado.error}</Badge>;
    if (f.resultado)
      return (
        <Badge estado="APROBADO">
          {f.resultado.acceso || f.resultado.correo !== undefined ? (f.resultado.correo ? 'Guardado · accesos enviados' : 'Guardado · sin enviar correo') : 'Guardado'}
        </Badge>
      );
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
              <li>Corrige lo que necesites y agrega filas nuevas: una sola fila por {tipo} (número, nombre del residente, teléfono, teléfono 2, correo y fecha de entrega).</li>
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
              <table className="tbl tbl-tarjetas">
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
                      <td data-label="Fila">{f.linea}</td>
                      <td className="tt-titulo">
                        <strong>{f.etiqueta || '—'}</strong>
                      </td>
                      <td data-label="Residente">
                        {f.nombre || '—'}
                        {(f.telefono || f.telefono2) && <div className="list-sub">{[f.telefono, f.telefono2].filter(Boolean).join(' · ')}</div>}
                      </td>
                      <td data-label="Correo" style={{ overflowWrap: 'anywhere' }}>{f.correo || '—'}</td>
                      <td data-label="Entrega">{f.fechaEntrega ? fecha(f.fechaEntrega) : '—'}</td>
                      <td data-label="Qué cambia">{estado(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {porGuardar > 0 && !enviando && conAcceso > 0 && (
              <div className="alert small" style={{ margin: 0 }}>
                <strong>¿Quieres que se envíen por correo los accesos a {conAcceso === 1 ? 'el residente' : `los ${conAcceso} residentes`} pendientes de recibir su contraseña?</strong> Si eliges
                «No», igual se dan de alta todos los del archivo; después puedes enviarles sus accesos o asignarles una contraseña con el botón «Contraseña».
              </div>
            )}
            {sinCorreoEnviado > 0 && !enviando && (
              <div className="alert small" style={{ margin: 0 }}>
                {sinCorreoEnviado} residente(s) quedaron dados de alta <strong>sin correo</strong>
                {conCorreoMasivo ? ' porque se alcanzó el límite de correos de hoy' : ''}. Aparecen como «Accesos sin enviar» en la lista: envíales sus accesos después o
                asígnales una contraseña con «Contraseña».
              </div>
            )}
            <div className="row-actions">
              {porGuardar > 0 &&
                (enviando ? (
                  <button type="button" className="btn-app" disabled>
                    <Icon name="upload" />
                    Guardando… ({procesadas} de {procesadas + porGuardar})
                  </button>
                ) : conAcceso > 0 ? (
                  <>
                    <button type="button" className="btn-app" onClick={() => enviar(true)}>
                      <Icon name="mail" />
                      Sí, guardar {porGuardar} cambio(s) y enviar correos
                    </button>
                    <button type="button" className="btn-app secondary" onClick={() => enviar(false)}>
                      <Icon name="upload" />
                      No, solo guardar {porGuardar} cambio(s)
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-app" onClick={() => enviar(false)}>
                    <Icon name="upload" />
                    Guardar {porGuardar} cambio(s)
                  </button>
                ))}
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
    let r: Alta = {};
    const enviarCorreo = conCorreo(e);
    const okk = await run(async () => {
      r = await adminCall<Alta>('crearUsuario', { ...f, rol: 'VIGILANTE', condominioId: condoId, enviarCorreo });
    });
    if (okk) {
      alert(avisoAlta(r, f.email));
      onDone();
    }
  }
  return (
    <Modal title="Agregar vigilante" onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        <Field label="Correo electrónico" hint="Es su usuario para la app de caseta.">
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
        <BotonesAlta busy={busy} texto="Dar de alta" />
      </form>
    </Modal>
  );
}

type DatosPersona = { nombre: string; telefono: string; telefono2: string; email: string };
const datosDe = (p: Perfil): DatosPersona => ({ nombre: p.nombre ?? '', telefono: p.telefono ?? '', telefono2: p.telefono2 ?? '', email: p.email });

/** Guarda nombre, teléfonos y correo si cambiaron. Si cambia el correo, el servidor envía accesos nuevos. */
async function guardarPersona(p: Perfil, d: DatosPersona) {
  const antes = datosDe(p);
  const cambia = (k: keyof DatosPersona) => d[k].trim() !== antes[k];
  if (!cambia('nombre') && !cambia('telefono') && !cambia('telefono2') && !cambia('email')) return false;
  if (!d.email.trim()) throw new Error('El correo no puede quedar vacío.');
  // Correo nuevo de una cuenta autorizada: se pregunta si se le envían accesos nuevos a ese correo.
  const enviarCorreo =
    cambia('email') && p.estado === 'APROBADO'
      ? confirm(`¿Enviar accesos nuevos (contraseña temporal) a ${d.email.trim()}?\n\nAceptar: se envía el correo.\nCancelar: solo se cambia el correo, sin enviar nada.`)
      : false;
  const r = await adminCall<{ correoEnviado?: boolean }>('residentes.editar', {
    userId: p.userId,
    nombre: d.nombre,
    telefono: d.telefono,
    telefono2: d.telefono2,
    email: d.email,
    enviarCorreo,
  });
  if (!cambia('email') || p.estado !== 'APROBADO') return false;
  return r.correoEnviado ? 'enviado' : enviarCorreo ? 'sin-cupo' : 'sin-correo';
}
const avisoCorreo = (r: 'enviado' | 'sin-cupo' | 'sin-correo', email: string) =>
  r === 'enviado'
    ? `Enviamos accesos nuevos a ${email}.`
    : r === 'sin-cupo'
      ? `El correo se cambió, pero no se enviaron los accesos: se alcanzó el límite de correos de hoy. Envíalos mañana o asígnale una contraseña con «Contraseña».`
      : `El correo se cambió sin enviar accesos. Su contraseña sigue igual; si la necesita, envíale accesos o asígnale una contraseña con «Contraseña».`;

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
        <Field label="Teléfono 2">
          <input type="tel" maxLength={20} value={d.telefono2} onChange={set('telefono2')} disabled={disabled} />
        </Field>
      </div>
      <Field label="Correo electrónico" hint="Es su usuario. Si lo cambias, te preguntamos si le enviamos accesos nuevos a ese correo.">
        <input required type="email" value={d.email} onChange={set('email')} disabled={disabled} />
      </Field>
    </>
  );
}

function EditarUnidad({ u, residentes, perfiles, onClose, onDone }: { u: Unidad; residentes: Perfil[]; perfiles: Perfil[]; onClose: () => void; onDone: () => void }) {
  const { puede, unidades, condoId } = useAdmin();
  const gestionaUnidad = puede('condominios', 'editar');
  const gestionaUsuarios = puede('usuarios', 'editar');
  const [f, setF] = useState({ etiqueta: u.etiqueta, fechaEntrega: u.fechaEntrega ?? '', propietario: u.propietario ?? '', notas: u.notas ?? '' });
  const [personas, setPersonas] = useState<DatosPersona[]>(() => residentes.map(datosDe));
  // Casa o departamento de cada residente: cambiarla aquí lo mueve de unidad.
  const [destino, setDestino] = useState<string[]>(() => residentes.map((p) => p.unidadId ?? u.id));
  // Unidad dada de alta sin residente: aquí se le agrega.
  const agregaResidente = gestionaUsuarios && !residentes.length;
  const [nuevo, setNuevo] = useState<DatosPersona>({ nombre: '', telefono: '', telefono2: '', email: '' });
  const setN = (k: keyof DatosPersona) => (e: React.ChangeEvent<HTMLInputElement>) => setNuevo({ ...nuevo, [k]: e.target.value });
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const correos: string[] = [];
    let movidos = 0;
    const enviar = conCorreo(e);
    const correoNuevo = nuevo.email.trim().toLowerCase();
    let alta: Resultado | undefined;
    const okk = await run(async () => {
      if (agregaResidente && (nuevo.nombre.trim() || correoNuevo)) {
        if (!correoNuevo) throw new Error('Escribe el correo del residente: es su usuario para entrar al portal.');
        if (!correoValido(correoNuevo)) throw new Error('Revisa el correo del residente.');
        if (perfiles.some((p) => p.email === correoNuevo)) throw new Error('Ya existe un usuario con ese correo.');
      }
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
      if (gestionaUsuarios)
        for (const [i, p] of residentes.entries()) {
          const r = await guardarPersona(p, personas[i]);
          if (r) correos.push(avisoCorreo(r, personas[i].email.trim()));
        }
      if (gestionaUsuarios)
        for (const [i, p] of residentes.entries()) {
          if (destino[i] && destino[i] !== (p.unidadId ?? u.id)) {
            await adminCall('aprobar', { userId: p.userId, rol: 'RESIDENTE', condominioId: condoId, unidadId: destino[i] });
            movidos++;
          }
        }
      if (agregaResidente && correoNuevo) {
        [alta] = await importar(
          condoId!,
          [{ numero: u.etiqueta, unidadId: u.id, nombre: nuevo.nombre, telefono: nuevo.telefono, telefono2: nuevo.telefono2, correo: correoNuevo, fechaEntrega: '' }],
          enviar,
        );
        if (alta?.error) throw new Error(alta.error);
      }
    }, 'Cambios guardados');
    if (okk) {
      if (alta?.acceso) alert(`${f.etiqueta.trim() || u.etiqueta}: ${avisoAlta({ correoEnviado: alta.correo, correoPedido: enviar }, correoNuevo)}`);
      if (correos.length) alert(correos.join('\n\n'));
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
        {agregaResidente && (
          <fieldset className="fld" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, margin: 0, display: 'grid', gap: 12 }}>
            <span>Residente</span>
            <Field label="Nombre">
              <input maxLength={120} value={nuevo.nombre} onChange={setN('nombre')} />
            </Field>
            <div className="form-2">
              <Field label="Teléfono">
                <input type="tel" maxLength={20} value={nuevo.telefono} onChange={setN('telefono')} />
              </Field>
              <Field label="Teléfono 2">
                <input type="tel" maxLength={20} value={nuevo.telefono2} onChange={setN('telefono2')} />
              </Field>
            </div>
            <Field label="Correo electrónico" hint="Es su usuario para entrar al portal. Déjalo vacío si aún no tienes sus datos.">
              <input type="email" value={nuevo.email} onChange={setN('email')} />
            </Field>
          </fieldset>
        )}
        <Field label="Propietario" hint="Si es distinto del residente (por ejemplo, unidad rentada).">
          <input maxLength={120} value={f.propietario} onChange={(e) => setF({ ...f, propietario: e.target.value })} disabled={!gestionaUnidad} />
        </Field>
        <Field label="Notas">
          <textarea maxLength={500} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} disabled={!gestionaUnidad} />
        </Field>
        {agregaResidente && nuevo.email.trim() ? (
          <BotonesAlta busy={busy} />
        ) : (
          <button className="btn-app" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </form>
    </Modal>
  );
}

function EditarPersona({ p, onClose, onDone }: { p: Perfil; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(datosDe(p));
  const { run, busy } = useAction();
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    let nuevoCorreo: Awaited<ReturnType<typeof guardarPersona>> = false;
    const okk = await run(async () => {
      nuevoCorreo = await guardarPersona(p, d);
    }, 'Datos guardados');
    if (okk) {
      if (nuevoCorreo) alert(avisoCorreo(nuevoCorreo, d.email.trim()));
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
  // Las cuentas de administración entran al panel; residentes y vigilantes, al portal.
  const esAdmin = p.rol === 'ADMIN' || p.rol === 'SUPERADMIN';
  const destino = esAdmin ? 'al panel de administración' : 'al portal';
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
  // El enlace va solo en su renglón: WhatsApp toma como parte de la liga cualquier signo pegado a ella.
  const mensaje = `Hola ${p.nombre ?? ''}. Tus datos para entrar ${destino} SIIA:\n\n${location.origin}/${esAdmin ? 'admin' : 'portal'}\n\nUsuario: ${p.email}\nContraseña: ${generada}`;

  return (
    <Modal title={`Contraseña de ${nombre}`} onClose={onClose}>
      {generada ? (
        <div className="form">
          <p style={{ margin: 0 }}>Comparte estos datos con {nombre}. Es su contraseña definitiva para entrar {destino}.</p>
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
          <Field label={`Nueva contraseña para ${nombre}`} hint={`Escríbela tal como se la vas a compartir. Será su contraseña para entrar ${destino}.`}>
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
              directo {destino}.
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
          {perfil.telefono2 && ` · ${perfil.telefono2}`}
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
