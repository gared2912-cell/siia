import { useMemo, useState } from 'react';
import { adminCall, all, client, type Schema } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, errMsg, fecha, useAction, useLoad } from '../ui';
import { useAdmin, type Unidad } from './AdminApp';

type Perfil = Schema['Perfil']['type'];
type Cuenta = { status?: string; enabled?: boolean; creado?: string };
const ROLES: [string, string][] = [
  ['RESIDENTE', 'Residente'],
  ['VIGILANTE', 'Vigilante (caseta)'],
  ['ADMIN', 'Administrador'],
];
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function Usuarios() {
  const { condos } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => all<Perfil>((o) => client.models.Perfil.list(o)));
  const cuentas = useLoad(() => adminCall<Record<string, Cuenta>>('estadoCuentas'));
  const [tab, setTab] = useState<'ACTIVOS' | 'INVITADOS' | 'PENDIENTE' | 'OTROS'>('ACTIVOS');
  const [buscar, setBuscar] = useState('');
  const [asignar, setAsignar] = useState<Perfil | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [masiva, setMasiva] = useState(false);
  const { run, busy } = useAction();

  const unidadesCache = useLoad(async () => {
    const r: Record<string, string> = {};
    for (const c of condos) {
      const us = await all<Unidad>((o) => client.models.Unidad.unidadesPorCondominio({ condominioId: c.id }, o));
      us.forEach((u) => (r[u.id] = u.etiqueta));
    }
    return r;
  }, [condos.length]);

  const sinPrimerIngreso = (p: Perfil) => cuentas.data?.[p.userId]?.status === 'FORCE_CHANGE_PASSWORD';
  const nombreCondo = (id?: string | null) => condos.find((c) => c.id === id)?.nombre ?? '—';
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (data ?? [])
      .filter((p) =>
        tab === 'ACTIVOS'
          ? p.estado === 'APROBADO' && !sinPrimerIngreso(p)
          : tab === 'INVITADOS'
            ? p.estado === 'APROBADO' && sinPrimerIngreso(p)
            : tab === 'PENDIENTE'
              ? p.estado === 'PENDIENTE'
              : ['RECHAZADO', 'SUSPENDIDO'].includes(p.estado ?? ''),
      )
      .filter((p) => !q || `${p.nombre} ${p.email} ${p.unidadSolicitada} ${unidadesCache.data?.[p.unidadId ?? ''] ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, buscar, cuentas.data, unidadesCache.data]);
  const n = (f: (p: Perfil) => boolean) => (data ?? []).filter(f).length;
  const pendientes = n((p) => p.estado === 'PENDIENTE');
  const invitados = n((p) => p.estado === 'APROBADO' && sinPrimerIngreso(p));

  const recargar = () => {
    reload(true);
    cuentas.reload(true);
  };
  const accion = (a: string, p: Perfil, msg: string, extra: object = {}) =>
    run(() => adminCall(a, { userId: p.userId, ...extra }).then(recargar), msg);
  const reenviar = (p: Perfil) => {
    const aviso = sinPrimerIngreso(p)
      ? `¿Reenviar los accesos a ${p.email}? Recibirá una contraseña temporal nueva.`
      : `${p.email} ya activó su cuenta. Si reenvías el acceso, su contraseña actual dejará de funcionar y recibirá una temporal nueva. ¿Continuar?`;
    if (confirm(aviso)) accion('reenviarAcceso', p, `Accesos enviados a ${p.email}`);
  };

  const tabs: [typeof tab, string][] = [
    ['ACTIVOS', 'Activos'],
    ['INVITADOS', `Sin primer ingreso (${invitados})`],
    ...(pendientes ? [['PENDIENTE', `Solicitudes (${pendientes})`] as [typeof tab, string]] : []),
    ['OTROS', 'Suspendidos / rechazados'],
  ];

  return (
    <div className="stack">
      <PageHead icon="users" title="Usuarios" sub="La administración da de alta a cada usuario; sus accesos se envían por correo.">
        <button className="btn-app secondary" onClick={() => setMasiva(true)}>
          <Icon name="users" />
          Alta masiva
        </button>
        <button className="btn-app" onClick={() => setNuevo(true)}>
          <Icon name="plus" />
          Dar de alta
        </button>
      </PageHead>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <Seg value={tab} onChange={setTab} options={tabs} />
        <input className="input" style={{ maxWidth: 280, marginBottom: 16 }} placeholder="Buscar nombre, correo o unidad" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      {tab === 'INVITADOS' && (
        <div className="alert small">
          Recibieron su correo de acceso pero aún no entran por primera vez. La contraseña temporal vence a los 7 días; usa «Reenviar acceso» si
          no la recibieron o venció.
        </div>
      )}
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <section className="panel">
          {lista.length ? (
            <ul className="list">
              {lista.map((p) => (
                <li key={p.userId}>
                  <div className="list-main">
                    <strong>{p.nombre || p.email}</strong> <Badge estado={p.estado} /> {p.rol && <Badge>{ROLES.find((r) => r[0] === p.rol)?.[1]}</Badge>}{' '}
                    {p.estado === 'APROBADO' && sinPrimerIngreso(p) && <Badge estado="PENDIENTE">Sin primer ingreso</Badge>}
                    <div className="list-sub">
                      {p.email} {p.telefono && `· ${p.telefono}`}
                    </div>
                    <div className="list-sub">
                      {p.rol === 'ADMIN' ? 'Todos los condominios' : nombreCondo(p.condominioId)}
                      {p.unidadId ? ` · ${unidadesCache.data?.[p.unidadId] ?? '…'}` : p.unidadSolicitada ? ` · solicitó: ${p.unidadSolicitada}` : ''} · alta{' '}
                      {fecha(p.createdAt)}
                    </div>
                    {p.nota && <div className="small">{p.nota}</div>}
                  </div>
                  <div className="row-actions">
                    {p.estado === 'PENDIENTE' && (
                      <>
                        <button className="btn-app sm" onClick={() => setAsignar(p)}>
                          Autorizar
                        </button>
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
                      </>
                    )}
                    {p.estado === 'APROBADO' && (
                      <>
                        <button className="btn-app sm secondary" disabled={busy} onClick={() => reenviar(p)}>
                          <Icon name="mail" />
                          Reenviar acceso
                        </button>
                        <button className="btn-app sm secondary" onClick={() => setAsignar(p)}>
                          Cambiar asignación
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
                    {p.estado === 'RECHAZADO' && (
                      <button className="btn-app sm secondary" onClick={() => setAsignar(p)}>
                        Autorizar
                      </button>
                    )}
                    {p.estado !== 'APROBADO' && (
                      <button
                        className="btn-app sm danger"
                        disabled={busy}
                        onClick={() => confirm(`¿Eliminar definitivamente la cuenta de ${p.email}?`) && accion('eliminarUsuario', p, 'Cuenta eliminada')}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="users">Sin usuarios en esta lista.</Empty>
          )}
        </section>
      )}
      {asignar && <Asignar perfil={asignar} onClose={() => setAsignar(null)} onDone={() => (setAsignar(null), recargar())} />}
      {nuevo && <Asignar onClose={() => setNuevo(false)} onDone={() => (setNuevo(false), setTab('INVITADOS'), recargar())} />}
      {masiva && <AltaMasiva onClose={() => setMasiva(false)} onDone={() => (setMasiva(false), setTab('INVITADOS'), recargar())} />}
    </div>
  );
}

/** Autorizar solicitud, cambiar asignación o dar de alta un usuario nuevo (sin `perfil`). */
function Asignar({ perfil, onClose, onDone }: { perfil?: Perfil; onClose: () => void; onDone: () => void }) {
  const { condos, condoId } = useAdmin();
  const [f, setF] = useState({
    email: perfil?.email ?? '',
    nombre: perfil?.nombre ?? '',
    telefono: perfil?.telefono ?? '',
    rol: perfil?.rol ?? 'RESIDENTE',
    condominioId: perfil?.condominioId ?? condoId,
    unidadId: perfil?.unidadId ?? '',
  });
  const unidades = useLoad(
    () => (f.condominioId ? all<Unidad>((o) => client.models.Unidad.unidadesPorCondominio({ condominioId: f.condominioId! }, o)) : Promise.resolve([])),
    [f.condominioId],
  );
  const orden = [...(unidades.data ?? [])].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
  const sugerida = perfil?.unidadSolicitada ? orden.find((u) => norm(u.etiqueta) === norm(perfil.unidadSolicitada!)) : undefined;
  const unidadId = f.unidadId || sugerida?.id || '';
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, ...(k === 'condominioId' ? { unidadId: '' } : {}) });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...f, unidadId };
    const okk = perfil
      ? await run(() => adminCall('aprobar', { userId: perfil.userId, ...payload }), 'Acceso autorizado')
      : await run(() => adminCall('crearUsuario', payload), `Alta realizada; enviamos los accesos a ${f.email}.`);
    if (okk) onDone();
  }

  return (
    <Modal title={perfil ? `Autorizar a ${perfil.nombre || perfil.email}` : 'Dar de alta usuario'} onClose={onClose}>
      <form className="form" onSubmit={guardar}>
        {perfil ? (
          <div className="alert small">
            {perfil.email} {perfil.unidadSolicitada && <>· Solicitó: <strong>{perfil.unidadSolicitada}</strong></>} {perfil.telefono && `· Tel. ${perfil.telefono}`}
          </div>
        ) : (
          <>
            <Field label="Correo electrónico" hint="Le enviaremos por correo su usuario y una contraseña temporal para su primer ingreso.">
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
          </>
        )}
        <Field label="Rol">
          <select value={f.rol} onChange={set('rol')}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {f.rol !== 'ADMIN' && (
          <Field label="Condominio">
            <select required value={f.condominioId ?? ''} onChange={set('condominioId')}>
              <option value="">Selecciona…</option>
              {condos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Field>
        )}
        {f.rol === 'RESIDENTE' && (
          <Field label="Unidad" hint={sugerida && !f.unidadId ? `Sugerida por coincidencia con “${perfil?.unidadSolicitada}”.` : undefined}>
            <select required value={unidadId} onChange={set('unidadId')}>
              <option value="">{unidades.loading ? 'Cargando…' : orden.length ? 'Selecciona…' : 'Este condominio no tiene unidades'}</option>
              {orden.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </Field>
        )}
        {f.rol === 'ADMIN' && <div className="alert small">Los administradores tienen acceso total a /admin y a todos los condominios.</div>}
        <button className="btn-app" disabled={busy}>
          {busy ? 'Guardando…' : perfil ? 'Autorizar acceso' : 'Dar de alta y enviar accesos'}
        </button>
      </form>
    </Modal>
  );
}

type Fila = { linea: number; email: string; nombre: string; unidad: string; telefono: string; unidadId?: string; error?: string; resultado?: string };

/** Alta de varios residentes pegando una lista (correo, nombre, unidad, teléfono). */
function AltaMasiva({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { condos, condoId, unidades: unidadesCondo } = useAdmin();
  const [cid, setCid] = useState(condoId);
  const unidades = useLoad(
    () => (cid === condoId ? Promise.resolve(unidadesCondo) : all<Unidad>((o) => client.models.Unidad.unidadesPorCondominio({ condominioId: cid }, o))),
    [cid],
  );
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [enviando, setEnviando] = useState(false);

  function revisar() {
    const porEtiqueta = new Map((unidades.data ?? []).map((u) => [norm(u.etiqueta), u.id]));
    const vistos = new Set<string>();
    const r: Fila[] = texto
      .split('\n')
      .map((l, i) => ({ l: l.trim(), i: i + 1 }))
      .filter(({ l }) => l && !/^correo/i.test(l))
      .map(({ l, i }) => {
        const [email = '', nombre = '', unidad = '', telefono = ''] = l.split(/[,;\t]/).map((s) => s.trim());
        const fila: Fila = { linea: i, email: email.toLowerCase(), nombre, unidad, telefono };
        let id = porEtiqueta.get(norm(unidad));
        if (!id && /^\d+[a-z]?$/i.test(unidad)) id = [...porEtiqueta.entries()].find(([k]) => k.endsWith(norm(unidad)))?.[1];
        fila.unidadId = id;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fila.email)) fila.error = 'Correo no válido';
        else if (vistos.has(fila.email)) fila.error = 'Correo repetido en la lista';
        else if (!nombre) fila.error = 'Falta el nombre';
        else if (!id) fila.error = `No existe la unidad «${unidad}»`;
        vistos.add(fila.email);
        return fila;
      });
    setFilas(r);
  }

  async function enviar() {
    if (!filas) return;
    setEnviando(true);
    const r = [...filas];
    for (const f of r) {
      if (f.error || f.resultado) continue;
      try {
        await adminCall('crearUsuario', { email: f.email, nombre: f.nombre, telefono: f.telefono, rol: 'RESIDENTE', condominioId: cid, unidadId: f.unidadId });
        f.resultado = 'Accesos enviados';
      } catch (e) {
        f.error = errMsg(e);
      }
      setFilas([...r]);
    }
    setEnviando(false);
  }

  const validas = filas?.filter((f) => !f.error && !f.resultado).length ?? 0;
  const enviadas = filas?.filter((f) => f.resultado).length ?? 0;

  return (
    <Modal title="Alta masiva de residentes" onClose={enviadas ? onDone : onClose} wide>
      <div className="form">
        <Field label="Condominio">
          <select value={cid} onChange={(e) => (setCid(e.target.value), setFilas(null))} disabled={enviando}>
            {condos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Residentes" hint="Una línea por residente: correo, nombre completo, unidad, teléfono (opcional). Puedes copiar y pegar desde Excel.">
          <textarea
            rows={8}
            value={texto}
            disabled={enviando}
            onChange={(e) => (setTexto(e.target.value), setFilas(null))}
            placeholder={'ana.lopez@correo.com, Ana López Ruiz, Casa 12, 442 123 4567\njuan.perez@correo.com, Juan Pérez Soto, Casa 13'}
            style={{ fontFamily: 'Consolas, monospace', fontSize: '0.9rem' }}
          />
        </Field>
        {!filas ? (
          <div>
            <button className="btn-app secondary" disabled={!texto.trim() || unidades.loading} onClick={revisar}>
              Revisar lista
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Correo</th>
                    <th>Nombre</th>
                    <th>Unidad</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.linea}>
                      <td>{f.linea}</td>
                      <td>{f.email}</td>
                      <td>{f.nombre}</td>
                      <td>{f.unidad}</td>
                      <td>{f.resultado ? <Badge estado="APROBADO">{f.resultado}</Badge> : f.error ? <Badge estado="RECHAZADO">{f.error}</Badge> : <Badge estado="PROGRAMADA">Lista para enviar</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-actions">
              <button className="btn-app" disabled={!validas || enviando} onClick={enviar}>
                <Icon name="mail" />
                {enviando ? `Enviando… (${enviadas})` : `Dar de alta y enviar ${validas} acceso(s)`}
              </button>
              {enviadas > 0 && !enviando && (
                <button className="btn-app secondary" onClick={onDone}>
                  Terminar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
