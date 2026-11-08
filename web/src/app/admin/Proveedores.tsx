// Panel › Proveedores: los proveedores que atienden el condominio (jardinería, alberca, fumigación…), los reportes de su
// bitácora de trabajo por proveedor y por mes, y su asistencia (check-in y check-out con foto y hora). Cada proveedor
// tiene un nombre que ven los residentes (p. ej. «Jardinería SIIA») en lugar del nombre de la persona. Los proveedores entran en siia.casa/proveedores (ver shared/proveedores.ts).
import { useState } from 'react';
import { adminCall } from '../api';
import { Acciones, Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, Tarjeta, TarjetaIcono, Tarjetas, fechaHora, hoy, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';
import { BotonesAlta, Contrasena, avisoAlta, conCorreo } from './Residentes';
import { TarjetaReporte } from '../proveedores/ProveedoresApp';
import { ETIQUETA_OTRO, OTRO_SERVICIO, SERVICIOS_PROVEEDOR, type DestinoReporte, type ReporteProveedor } from '../../../amplify/functions/shared/proveedores';
import type { Schema } from '../api';

type Perfil = Schema['Perfil']['type'];
type Proveedor = Perfil & { cuenta?: string | null };

export function ProveedoresAdmin({ inicio }: { inicio?: 'asistencia' } = {}) {
  const { condo, puede } = useAdmin();
  const [tab, setTab] = useState<'reportes' | 'asistencia' | 'proveedores'>(inicio ?? 'reportes');
  const [crear, setCrear] = useState(false);
  const gestiona = puede('proveedores', 'editar');
  const lista = useLoad(() => adminCall<Proveedor[]>('proveedores.lista', { condominioId: condo!.id }), [condo!.id]);
  return (
    <div className="stack">
      <PageHead icon="package" title="Proveedores" sub={`Bitácora de trabajo de los proveedores de ${condo!.nombre}. Entran en siia.casa/proveedores.`}>
        {gestiona && (
          <button className="btn-app" onClick={() => setCrear(true)}>
            <Icon name="plus" />
            Crear proveedor
          </button>
        )}
      </PageHead>
      {crear && <EditarProveedor p={null} onClose={() => setCrear(false)} onDone={() => (setCrear(false), setTab('proveedores'), lista.reload(true))} />}
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ['reportes', 'Reportes'],
          ['asistencia', 'Asistencia (check-in)'],
          ['proveedores', `Proveedores${lista.data ? ` (${lista.data.length})` : ''}`],
        ]}
      />
      {lista.loading && !lista.data ? (
        <Loading />
      ) : lista.error ? (
        <ErrorBox error={lista.error} retry={lista.reload} />
      ) : tab === 'reportes' ? (
        <Reportes proveedores={lista.data!} />
      ) : tab === 'asistencia' ? (
        <AsistenciaProveedores proveedores={lista.data!} />
      ) : (
        <ListaProveedores proveedores={lista.data!} gestiona={gestiona} recargar={() => lista.reload(true)} />
      )}
    </div>
  );
}

// ---------- Reportes por proveedor y mes ----------
function Reportes({ proveedores }: { proveedores: Proveedor[] }) {
  const { condo } = useAdmin();
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [proveedorId, setProveedorId] = useState('');
  const [destino, setDestino] = useState<DestinoReporte>('ADMIN');
  const { data, error, loading, reload } = useLoad(
    () => adminCall<ReporteProveedor[]>('proveedores.reportes', { condominioId: condo!.id, mes, proveedorId, destino }),
    [condo!.id, mes, proveedorId, destino],
  );
  return (
    <>
      <section className="panel">
        <div className="form-2">
          <Field label="Proveedor">
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.nombre || p.email}
                  {p.empresa ? ` · ${p.empresa}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mes">
            <input type="month" value={mes} max={hoy().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Seg
            value={destino}
            onChange={setDestino}
            options={[
              ['ADMIN', 'Para la administración'],
              ['RESIDENTES', 'Para los residentes'],
            ]}
          />
        </div>
      </section>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : data!.length ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {data!.length} reporte(s) en el mes.
          </p>
          {data!.map((r) => (
            <TarjetaReporte key={r.id} r={r} mostrarProveedor />
          ))}
        </>
      ) : (
        <section className="panel">
          <Empty icon="file">{proveedores.length ? 'No hay reportes con esos filtros.' : 'Aún no hay proveedores. Dalos de alta en la pestaña Proveedores.'}</Empty>
        </section>
      )}
    </>
  );
}

// ---------- Proveedores del condominio ----------
function ListaProveedores({ proveedores, gestiona, recargar }: { proveedores: Proveedor[]; gestiona: boolean; recargar: () => void }) {
  const [editar, setEditar] = useState<Proveedor | null>(null);
  const [contrasena, setContrasena] = useState<Proveedor | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const { run, busy } = useAction();
  const accion = (a: string, p: Proveedor, msg: string) => run(() => adminCall(a, { userId: p.userId }).then(recargar), msg);
  const fichaP = proveedores.find((p) => p.userId === ficha);
  return (
    <section className="panel">
      {proveedores.length ? (
        <Tarjetas>
          {proveedores.map((p) => (
            <Tarjeta
              key={p.userId}
              tono={p.estado !== 'APROBADO' ? 'mal' : p.accesoSinEnviar ? 'warn' : 'ok'}
              onClick={() => setFicha(p.userId)}
              media={<TarjetaIcono name="package" />}
              titulo={p.nombre || p.email}
              sub={`${p.nombrePublico ? `Los residentes lo ven como «${p.nombrePublico}» · ` : ''}${p.empresa || 'Personal propio'} · ${(p.servicios ?? []).filter(Boolean).join(' · ')}`}
              lado={
                <>
                  <Badge estado={p.estado === 'APROBADO' ? 'APROBADO' : 'SUSPENDIDO'}>{p.estado === 'APROBADO' ? 'Activo' : 'Suspendido'}</Badge>
                  {p.estado === 'APROBADO' && p.accesoSinEnviar && <Badge estado="PENDIENTE">Accesos sin enviar</Badge>}
                </>
              }
            />
          ))}
        </Tarjetas>
      ) : (
        <Empty icon="package">Este condominio aún no tiene proveedores. Usa «Crear proveedor».</Empty>
      )}
      {fichaP && (
        <Modal title={fichaP.nombre || fichaP.email || 'Proveedor'} onClose={() => setFicha(null)}>
          <div className="stack">
            <div className="row-actions">
              <Badge estado={fichaP.estado === 'APROBADO' ? 'APROBADO' : 'SUSPENDIDO'}>{fichaP.estado === 'APROBADO' ? 'Activo' : 'Suspendido'}</Badge>
              {fichaP.estado === 'APROBADO' && fichaP.accesoSinEnviar && <Badge estado="PENDIENTE">Accesos sin enviar</Badge>}
            </div>
            <Datos
              items={[
                ['Lo ven los residentes como', fichaP.nombrePublico || fichaP.empresa || 'Sin nombre para residentes'],
                ['Empresa', fichaP.empresa || 'Personal propio'],
                ['Correo', fichaP.email],
                ['Teléfono', fichaP.telefono],
                ['Servicios', (fichaP.servicios ?? []).filter(Boolean).join(' · ')],
              ]}
            />
            {gestiona && (
              <Acciones>
                <button className="btn-app secondary" onClick={() => (setEditar(fichaP), setFicha(null))}>
                  Editar
                </button>
                {fichaP.estado === 'APROBADO' ? (
                  <>
                    <button className="btn-app secondary" onClick={() => (setContrasena(fichaP), setFicha(null))}>
                      <Icon name="shield" />
                      Contraseña
                    </button>
                    <button
                      className="btn-app danger"
                      disabled={busy}
                      onClick={() => confirm(`¿Suspender el acceso de ${fichaP.nombre || fichaP.email}?`) && accion('suspender', fichaP, 'Acceso suspendido')}
                    >
                      Suspender
                    </button>
                  </>
                ) : (
                  <button className="btn-app secondary" disabled={busy} onClick={() => accion('reactivar', fichaP, 'Acceso reactivado')}>
                    Reactivar
                  </button>
                )}
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {editar && <EditarProveedor p={editar} onClose={() => setEditar(null)} onDone={() => (setEditar(null), recargar())} />}
      {contrasena && <Contrasena p={contrasena} sinPrimerIngreso={contrasena.cuenta === 'FORCE_CHANGE_PASSWORD'} onClose={() => (setContrasena(null), recargar())} />}
    </section>
  );
}

function EditarProveedor({ p, onClose, onDone }: { p: Proveedor | null; onClose: () => void; onDone: () => void }) {
  const { condo, condos } = useAdmin();
  const [f, setF] = useState({ nombre: p?.nombre ?? '', email: p?.email ?? '', telefono: p?.telefono ?? '', empresa: p?.empresa ?? '', nombrePublico: p?.nombrePublico ?? '' });
  const [servicios, setServicios] = useState<string[]>(((p?.servicios ?? []) as string[]).filter(Boolean));
  const [otro, setOtro] = useState('');
  // Condominios que atiende (solo se muestran los que administra quien edita)
  const [condominios, setCondominios] = useState<string[]>(() => (p ? ((p.condominiosServicio ?? []) as string[]).filter((id) => condos.some((c) => c.id === id)) : [condo!.id]));
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const alterna = <T,>(lista: T[], x: T) => (lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x]);
  const propios = servicios.filter((s) => s !== OTRO_SERVICIO && !(SERVICIOS_PROVEEDOR as readonly string[]).includes(s));
  const catalogo = [...SERVICIOS_PROVEEDOR, ...propios, OTRO_SERVICIO];
  const agregarOtro = () => {
    const t = otro.trim();
    if (t && !servicios.includes(t)) setServicios([...servicios, t]);
    setOtro('');
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { ...f, servicios, condominiosServicio: condominios };
    if (p) {
      if (await run(() => adminCall('proveedores.editar', { userId: p.userId, ...datos, enviarCorreo: false }), 'Proveedor actualizado')) onDone();
      return;
    }
    const enviarCorreo = conCorreo(e);
    let r: { correoEnviado?: boolean; correoPedido?: boolean } = {};
    const okk = await run(async () => {
      r = await adminCall('crearUsuario', { ...datos, rol: 'PROVEEDOR', enviarCorreo });
    });
    if (okk) {
      alert(`${avisoAlta(r, f.email)}\n\nEl proveedor entra en siia.casa/proveedores con su correo.`);
      onDone();
    }
  }

  const incompleto = !servicios.length || !condominios.length;
  return (
    <Modal title={p ? `Editar ${p.nombre || p.email}` : 'Nuevo proveedor'} onClose={onClose} wide>
      <form className="form" onSubmit={guardar}>
        <div className="form-2">
          <Field label="Nombre de la persona">
            <input required maxLength={120} value={f.nombre} onChange={set('nombre')} />
          </Field>
          <Field label="Empresa" hint="Déjalo vacío si es personal propio (de SIIA o del condominio).">
            <input maxLength={120} value={f.empresa} onChange={set('empresa')} placeholder="Ej. Jardines QRO" />
          </Field>
        </div>
        <Field label="Nombre que verán los residentes" hint="Así aparece en sus avisos de llegada y en los trabajos realizados, en lugar del nombre de la persona.">
          <input required maxLength={80} value={f.nombrePublico} onChange={set('nombrePublico')} placeholder={`Ej. ${servicios[0] && servicios[0] !== OTRO_SERVICIO ? servicios[0].split(' ')[0] : 'Jardinería'} SIIA`} />
        </Field>
        <div className="form-2">
          <Field label="Correo electrónico" hint="Es su usuario para entrar.">
            <input required type="email" value={f.email} onChange={set('email')} disabled={!!p && p.estado !== 'APROBADO'} />
          </Field>
          <Field label="Teléfono">
            <input type="tel" maxLength={20} value={f.telefono} onChange={set('telefono')} />
          </Field>
        </div>
        <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Mantenimientos que puede realizar</span>
          <div className="row-actions" style={{ margin: '4px 0 0' }}>
            <button type="button" className="linklike small" onClick={() => setServicios(catalogo)}>
              Marcar todos
            </button>
            <button type="button" className="linklike small" onClick={() => setServicios([])}>
              Quitar todos
            </button>
          </div>
          <div className="checks" style={{ marginTop: 6 }}>
            {catalogo.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={servicios.includes(s)} onChange={() => setServicios(alterna(servicios, s))} />
                {s === OTRO_SERVICIO ? ETIQUETA_OTRO : s}
              </label>
            ))}
          </div>
          <div className="row-actions" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 0 }} maxLength={60} value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Agregar un mantenimiento que no está en la lista…" />
            <button type="button" className="btn-app sm secondary" onClick={agregarOtro} disabled={!otro.trim()}>
              <Icon name="plus" />
              Agregar
            </button>
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            En su sesión, el proveedor solo verá los mantenimientos que marques aquí.
          </p>
        </fieldset>
        {condos.length > 1 && (
          <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Condominios a los que está asignado</span>
            <div className="checks" style={{ marginTop: 6 }}>
              {condos.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={condominios.includes(c.id)} onChange={() => setCondominios(alterna(condominios, c.id))} />
                  {c.nombre}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {p ? (
          <button className="btn-app" disabled={busy || incompleto}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        ) : (
          <BotonesAlta busy={busy} disabled={incompleto} texto="Dar de alta" />
        )}
      </form>
    </Modal>
  );
}

// ---------- Asistencia (check-in y check-out) ----------
type AsistenciaAdmin = {
  id: string;
  proveedorId: string;
  proveedorNombre?: string | null;
  nombrePublico?: string | null;
  estado: 'DENTRO' | 'SALIO';
  entradaEn: string;
  entradaDescripcion?: string | null;
  entradaFotoUrl?: string | null;
  salidaEn?: string | null;
  salidaDescripcion?: string | null;
  salidaFotoUrl?: string | null;
};

const duracion = (a: string, b?: string | null) => {
  if (!b) return null;
  const min = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
};

function AsistenciaProveedores({ proveedores }: { proveedores: Proveedor[] }) {
  const { condo } = useAdmin();
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [proveedorId, setProveedorId] = useState('');
  const [ficha, setFicha] = useState<AsistenciaAdmin | null>(null);
  const { data, error, loading, reload } = useLoad(
    () => adminCall<AsistenciaAdmin[]>('proveedores.asistencias', { condominioId: condo!.id, mes, proveedorId }),
    [condo!.id, mes, proveedorId],
  );
  return (
    <>
      <section className="panel">
        <div className="form-2">
          <Field label="Proveedor">
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.nombre || p.email}
                  {p.nombrePublico ? ` · ${p.nombrePublico}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mes">
            <input type="month" value={mes} max={hoy().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </Field>
        </div>
      </section>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : data!.length ? (
        <section className="panel">
          <Tarjetas>
            {data!.map((a) => (
              <Tarjeta
                key={a.id}
                tono={a.estado === 'DENTRO' ? 'info' : 'ok'}
                onClick={() => setFicha(a)}
                media={a.entradaFotoUrl ? <img className="tarjeta-foto" src={a.entradaFotoUrl} alt="" loading="lazy" /> : <TarjetaIcono name="login" />}
                titulo={`${a.nombrePublico || a.proveedorNombre || 'Proveedor'}${a.proveedorNombre && a.nombrePublico ? ` · ${a.proveedorNombre}` : ''}`}
                sub={`Entrada ${fechaHora(a.entradaEn)}${a.salidaEn ? ` · Salida ${fechaHora(a.salidaEn)}` : ''}${a.entradaDescripcion ? ` · ${a.entradaDescripcion}` : ''}`}
                lado={
                  <>
                    <Badge estado={a.estado === 'DENTRO' ? 'EN_PROCESO' : 'TERMINADO'}>{a.estado === 'DENTRO' ? 'En servicio' : 'Terminado'}</Badge>
                    {duracion(a.entradaEn, a.salidaEn) && <span className="small muted">{duracion(a.entradaEn, a.salidaEn)}</span>}
                  </>
                }
              />
            ))}
          </Tarjetas>
        </section>
      ) : (
        <section className="panel">
          <Empty icon="clock">Sin check-ins en ese mes. Los proveedores lo hacen desde siia.casa/proveedores al llegar.</Empty>
        </section>
      )}
      {ficha && (
        <Modal title={ficha.nombrePublico || ficha.proveedorNombre || 'Asistencia'} onClose={() => setFicha(null)} wide>
          <div className="stack">
            <Datos
              items={[
                ['Persona', ficha.proveedorNombre],
                ['Lo ven los residentes como', ficha.nombrePublico],
                ['Duración', duracion(ficha.entradaEn, ficha.salidaEn) ?? 'Sigue en servicio'],
              ]}
            />
            <div className="grid-2">
              <div className="stack" style={{ gap: 6 }}>
                <strong>Check-in · {fechaHora(ficha.entradaEn)}</strong>
                {ficha.entradaFotoUrl && <img className="foto-asistencia" src={ficha.entradaFotoUrl} alt="Foto al llegar" />}
                {ficha.entradaDescripcion && <span className="small">{ficha.entradaDescripcion}</span>}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <strong>Check-out · {ficha.salidaEn ? fechaHora(ficha.salidaEn) : 'pendiente'}</strong>
                {ficha.salidaFotoUrl && <img className="foto-asistencia" src={ficha.salidaFotoUrl} alt="Foto al salir" />}
                {ficha.salidaDescripcion && <span className="small">{ficha.salidaDescripcion}</span>}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
