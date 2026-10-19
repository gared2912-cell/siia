// Solo superadministrador: roles de administración (qué secciones y acciones puede usar un ADMIN)
// y cuentas de administración (rol + condominios asignados).
import { useMemo, useState } from 'react';
import { adminCall, all, db, type Schema } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, fecha, useAction, useLoad } from '../ui';
import { Firma } from './Firma';
import { useAdmin } from './AdminApp';
import { Contrasena } from './Residentes';
import { EXTRAS, NIVELES, SECCIONES_PERMISO, type Nivel, type Permisos } from '../../../amplify/functions/shared/permisos';

type Perfil = Schema['Perfil']['type'];
export type RolAdmin = { id: string; nombre: string; descripcion: string; permisos: Permisos; asignados: number };

const ETIQUETA_NIVEL: Record<Nivel, string> = { ninguno: 'Sin acceso', ver: 'Solo ver', editar: 'Gestionar' };

export function Administradores() {
  const [tab, setTab] = useState<'cuentas' | 'roles'>('cuentas');
  const roles = useLoad(() => adminCall<RolAdmin[]>('roles.lista'));
  return (
    <div className="stack">
      <PageHead icon="shield" title="Administradores" sub="Define roles de administración y asigna a cada administrador su rol y sus condominios." />
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ['cuentas', 'Cuentas de administración'],
          ['roles', `Roles (${roles.data?.length ?? '…'})`],
        ]}
      />
      {roles.error ? (
        <ErrorBox error={roles.error} retry={roles.reload} />
      ) : tab === 'roles' ? (
        <Roles roles={roles.data} loading={roles.loading} reload={() => roles.reload(true)} />
      ) : (
        <Cuentas roles={roles.data ?? []} onRoles={() => setTab('roles')} />
      )}
    </div>
  );
}

// ---------- roles ----------
function resumen(p: Permisos) {
  const secs = SECCIONES_PERMISO.filter((s) => p.secciones[s.key] !== 'ninguno');
  if (!secs.length) return 'Sin acceso a ninguna sección';
  return secs.map((s) => `${s.label.split(' (')[0]}: ${ETIQUETA_NIVEL[p.secciones[s.key]].toLowerCase()}`).join(' · ');
}

function Roles({ roles, loading, reload }: { roles?: RolAdmin[]; loading: boolean; reload: () => void }) {
  const [editar, setEditar] = useState<Partial<RolAdmin> | null>(null);
  const { run, busy } = useAction();
  if (loading && !roles) return <Loading />;
  const borrar = (r: RolAdmin) =>
    confirm(`¿Eliminar el rol «${r.nombre}»?`) && run(() => adminCall('roles.eliminar', { id: r.id }).then(reload), 'Rol eliminado');
  return (
    <>
      <div className="row-actions">
        <button className="btn-app" onClick={() => setEditar({ permisos: { secciones: {}, extras: [] } })}>
          <Icon name="plus" />
          Nuevo rol
        </button>
        <button
          className="btn-app secondary"
          disabled={busy}
          onClick={() => run(() => adminCall('roles.sugeridos').then(reload), 'Roles sugeridos listos')}
        >
          Agregar roles sugeridos
        </button>
      </div>
      {roles?.length ? (
        <div className="grid-cards">
          {roles.map((r) => (
            <article key={r.id} className="panel" style={{ marginTop: 0 }}>
              <div className="panel-head">
                <h3>{r.nombre}</h3>
                <Badge>{r.asignados === 1 ? '1 administrador' : `${r.asignados} administradores`}</Badge>
              </div>
              {r.descripcion && (
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  {r.descripcion}
                </p>
              )}
              <p className="small" style={{ margin: '0 0 8px' }}>
                {resumen(r.permisos)}
              </p>
              {r.permisos.extras.length > 0 && (
                <p className="small muted" style={{ margin: '0 0 12px' }}>
                  Además: {r.permisos.extras.map((e) => EXTRAS.find((x) => x.key === e)?.label.toLowerCase()).join('; ')}.
                </p>
              )}
              <div className="row-actions">
                <button className="btn-app sm secondary" onClick={() => setEditar(r)}>
                  Editar permisos
                </button>
                <button
                  className="btn-app sm danger"
                  disabled={busy || r.asignados > 0}
                  title={r.asignados ? 'Está asignado a administradores' : undefined}
                  onClick={() => borrar(r)}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty icon="shield">
            Aún no hay roles. Crea uno o agrega los roles sugeridos (Administrador general, Contador, Gerente de operación y Solo consulta).
          </Empty>
        </section>
      )}
      {editar && <EditarRol r={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), reload())} />}
    </>
  );
}

function EditarRol({ r, onClose, onDone }: { r: Partial<RolAdmin>; onClose: () => void; onDone: () => void }) {
  const [nombre, setNombre] = useState(r.nombre ?? '');
  const [descripcion, setDescripcion] = useState(r.descripcion ?? '');
  const [secciones, setSecciones] = useState<Record<string, Nivel>>(() =>
    Object.fromEntries(SECCIONES_PERMISO.map((s) => [s.key, r.permisos?.secciones[s.key] ?? 'ninguno'])),
  );
  const [extras, setExtras] = useState<string[]>(r.permisos?.extras ?? []);
  const { run, busy } = useAction();

  const nivel = (k: string, v: Nivel) => {
    setSecciones({ ...secciones, [k]: v });
    if (v === 'ninguno') setExtras(extras.filter((e) => !e.startsWith(`${k}.`)));
  };
  const toggle = (e: string) => setExtras(extras.includes(e) ? extras.filter((x) => x !== e) : [...extras, e]);
  const todo = (v: Nivel) => setSecciones(Object.fromEntries(SECCIONES_PERMISO.map((s) => [s.key, s.soloVer && v === 'editar' ? 'ver' : v])));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(() => adminCall('roles.guardar', { id: r.id, nombre, descripcion, permisos: { secciones, extras } }), 'Rol guardado');
    if (okk) onDone();
  }

  return (
    <Modal title={r.id ? `Permisos de «${r.nombre}»` : 'Nuevo rol de administración'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Nombre del rol">
            <input required maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Contador, Gerente, Comité…" />
          </Field>
          <Field label="Descripción">
            <input maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </Field>
        </div>
        {r.asignados ? <div className="alert small">Los cambios aplican de inmediato a los {r.asignados} administrador(es) con este rol.</div> : null}
        <div className="row-actions small">
          Marcar todo como:
          {NIVELES.map(([v, l]) => (
            <button key={v} type="button" className="linklike" onClick={() => todo(v)}>
              {l}
            </button>
          ))}
        </div>
        <ul className="list permisos">
          {SECCIONES_PERMISO.map((s) => {
            const actual = secciones[s.key];
            const extrasSec = EXTRAS.filter((x) => x.seccion === s.key);
            return (
              <li key={s.key} style={{ display: 'block' }}>
                <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="list-main">
                    <strong>{s.label}</strong>
                    <div className="list-sub">
                      {s.soloVer ? 'Solo consulta (la caseta registra las visitas).' : `Gestionar: ${s.editar.toLowerCase()}.`}
                    </div>
                  </div>
                  <select
                    aria-label={`Permiso en ${s.label}`}
                    value={actual}
                    onChange={(e) => nivel(s.key, e.target.value as Nivel)}
                    style={{ minWidth: 150 }}
                  >
                    {NIVELES.filter(([v]) => !(s.soloVer && v === 'editar')).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                {extrasSec.length > 0 && (
                  <div className="checks" style={{ marginTop: 8 }}>
                    {extrasSec.map((x) => (
                      <label key={x.key} className="check" style={{ opacity: actual === 'ninguno' ? 0.5 : 1 }}>
                        <input type="checkbox" disabled={actual === 'ninguno'} checked={extras.includes(x.key)} onChange={() => toggle(x.key)} />
                        {x.label}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar rol'}
        </button>
      </form>
    </Modal>
  );
}

// ---------- cuentas de administración ----------
function Cuentas({ roles, onRoles }: { roles: RolAdmin[]; onRoles: () => void }) {
  const { condos, yo } = useAdmin();
  const perfiles = useLoad(() => all<Perfil>((o) => db.models.Perfil.list(o)));
  const cuentas = useLoad(() => adminCall<Record<string, { status?: string }>>('estadoCuentas'));
  const [editar, setEditar] = useState<Perfil | 'nuevo' | null>(null);
  const [contrasena, setContrasena] = useState<Perfil | null>(null);
  const sinPrimerIngreso = (p: Perfil) => cuentas.data?.[p.userId]?.status === 'FORCE_CHANGE_PASSWORD';
  const admins = useMemo(
    () =>
      (perfiles.data ?? [])
        .filter((p) => p.rol === 'ADMIN' || p.rol === 'SUPERADMIN')
        .sort((a, b) => (a.rol === b.rol ? String(a.email).localeCompare(String(b.email)) : a.rol === 'SUPERADMIN' ? -1 : 1)),
    [perfiles.data],
  );
  const condosDe = (p: Perfil) => {
    if (p.rol === 'SUPERADMIN') return 'Todos los condominios y la configuración de administradores';
    const ids = (p.condominiosAdmin ?? []).filter(Boolean) as string[];
    if (ids.includes('*')) return 'Todos los condominios';
    if (!ids.length) return 'Sin condominios asignados';
    return ids.map((id) => condos.find((c) => c.id === id)?.nombre ?? 'Condominio eliminado').join(', ');
  };

  if (perfiles.loading && !perfiles.data) return <Loading />;
  if (perfiles.error) return <ErrorBox error={perfiles.error} retry={perfiles.reload} />;
  return (
    <>
      <div className="row-actions">
        <button className="btn-app" onClick={() => setEditar('nuevo')} disabled={!roles.length}>
          <Icon name="plus" />
          Dar de alta administrador
        </button>
        {!roles.length && (
          <button className="linklike" onClick={onRoles}>
            Primero crea un rol de administración
          </button>
        )}
      </div>
      <section className="panel">
        {admins.length ? (
          <ul className="list">
            {admins.map((p) => (
              <li key={p.userId}>
                <div className="list-main">
                  <strong>{p.nombre || p.email}</strong> <Badge estado={p.estado} />{' '}
                  <Badge>{p.rol === 'SUPERADMIN' ? 'Superadministrador' : (roles.find((r) => r.id === p.rolAdminId)?.nombre ?? 'Sin rol')}</Badge>
                  {sinPrimerIngreso(p) && <Badge estado="PENDIENTE">Sin primer ingreso</Badge>}
                  <div className="list-sub">
                    {p.email} · alta {fecha(p.createdAt)}
                  </div>
                  <div className="list-sub">{condosDe(p)}</div>
                  <Firma item={p} alta="Alta por" />
                </div>
                <div className="row-actions">
                  <button className="btn-app sm secondary" onClick={() => setEditar(p)}>
                    Cambiar rol y condominios
                  </button>
                  {/* La propia contraseña se cambia con «¿Olvidaste tu contraseña?»: asignarla aquí cerraría tu sesión. */}
                  {p.email !== yo && p.estado === 'APROBADO' && (
                    <button className="btn-app sm secondary" onClick={() => setContrasena(p)}>
                      <Icon name="shield" />
                      Contraseña
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="shield">Sin cuentas de administración.</Empty>
        )}
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          Con «Contraseña» reenvías el acceso a su correo con una contraseña temporal, o le asignas la contraseña que tú elijas.
        </p>
      </section>
      {contrasena && (
        <Contrasena p={contrasena} sinPrimerIngreso={sinPrimerIngreso(contrasena)} onClose={() => (setContrasena(null), cuentas.reload(true))} />
      )}
      {editar && (
        <AsignarAdmin
          perfil={editar === 'nuevo' ? undefined : editar}
          roles={roles}
          onClose={() => setEditar(null)}
          onDone={() => (setEditar(null), perfiles.reload(true))}
        />
      )}
    </>
  );
}

/** Alta de un administrador o cambio de su rol y condominios (también se usa desde Usuarios). */
export function AsignarAdmin({ perfil, roles, onClose, onDone }: { perfil?: Perfil; roles: RolAdmin[]; onClose: () => void; onDone: () => void }) {
  const { condos, yo } = useAdmin();
  const actuales = ((perfil?.condominiosAdmin ?? []).filter(Boolean) as string[]) ?? [];
  const [f, setF] = useState({
    email: perfil?.email ?? '',
    nombre: perfil?.nombre ?? '',
    telefono: perfil?.telefono ?? '',
    rol: (perfil?.rol === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN') as 'ADMIN' | 'SUPERADMIN',
    rolAdminId: perfil?.rolAdminId ?? roles[0]?.id ?? '',
  });
  const [todos, setTodos] = useState(actuales.includes('*'));
  const [elegidos, setElegidos] = useState<string[]>(actuales.filter((x) => x !== '*'));
  const { run, busy } = useAction();
  const soyYo = !!perfil && perfil.email === yo;
  const rol = roles.find((r) => r.id === f.rolAdminId);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...f, condominiosAdmin: todos ? ['*'] : elegidos };
    const okk = perfil
      ? await run(() => adminCall('aprobar', { userId: perfil.userId, ...payload }), 'Administrador actualizado')
      : await run(() => adminCall('crearUsuario', payload), `Alta realizada; enviamos los accesos a ${f.email}.`);
    if (okk) onDone();
  }

  return (
    <Modal title={perfil ? `Administración: ${perfil.nombre || perfil.email}` : 'Dar de alta administrador'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        {perfil ? (
          <div className="alert small">{perfil.email}</div>
        ) : (
          <>
            <Field label="Correo electrónico" hint="Le enviaremos por correo su usuario y una contraseña temporal.">
              <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <div className="form-2">
              <Field label="Nombre completo">
                <input required maxLength={120} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
              </Field>
              <Field label="Teléfono">
                <input type="tel" maxLength={20} value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />
              </Field>
            </div>
          </>
        )}
        <Field label="Tipo de cuenta">
          <select value={f.rol} disabled={soyYo} onChange={(e) => setF({ ...f, rol: e.target.value as typeof f.rol })}>
            <option value="ADMIN">Administrador (según su rol)</option>
            <option value="SUPERADMIN">Superadministrador (acceso total)</option>
          </select>
        </Field>
        {soyYo && <div className="alert small">No puedes cambiar el tipo de tu propia cuenta.</div>}
        {f.rol === 'SUPERADMIN' ? (
          <div className="alert small">
            El superadministrador ve y gestiona todo, incluidos los roles de administración y las demás cuentas de administración. Asígnalo solo a
            personas de máxima confianza.
          </div>
        ) : (
          <>
            <Field label="Rol de administración">
              <select required value={f.rolAdminId} onChange={(e) => setF({ ...f, rolAdminId: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </Field>
            {rol && (
              <p className="small muted" style={{ margin: 0 }}>
                {resumen(rol.permisos)}
              </p>
            )}
            <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Condominios que atiende</span>
              <label className="check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
                Todos los condominios (incluye los que se den de alta después)
              </label>
              {!todos && (
                <div className="checks" style={{ marginTop: 6 }}>
                  {condos.map((c) => (
                    <label key={c.id} className="check">
                      <input
                        type="checkbox"
                        checked={elegidos.includes(c.id)}
                        onChange={() => setElegidos(elegidos.includes(c.id) ? elegidos.filter((x) => x !== c.id) : [...elegidos, c.id])}
                      />
                      {c.nombre}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </>
        )}
        <button className="btn-app" disabled={busy || (f.rol === 'ADMIN' && !todos && !elegidos.length)}>
          {busy ? 'Guardando…' : perfil ? 'Guardar cambios' : 'Dar de alta y enviar accesos'}
        </button>
      </form>
    </Modal>
  );
}
