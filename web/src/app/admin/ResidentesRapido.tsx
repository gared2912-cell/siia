// Panel › Residentes: cada casa o departamento con su estado de pago (al corriente o saldo pendiente), su residente
// (acceso a SIIA activado o suspendido, y sus llaveros, tarjetas o controles) y las acciones del día a día:
// historial de pagos, chat, control de accesos y contraseña. La gestión completa está en Condominios › Residentes.
import { useState } from 'react';
import { adminCall, all, db, type Schema } from '../api';
import { Acciones, Empty, ErrorBox, Icon, Loading, Modal, PageHead, Tarjeta, TarjetaIcono, Tarjetas, hoy, money, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';
import { ChatUnidad } from './Comunicacion';
import { Contrasena } from './Residentes';
import { ControlAccesos, ListaAccesos } from './ControlAccesos';
import { RegistroActivaciones } from './RegistroActivaciones';
import { HistorialVista } from '../HistorialVista';
import type { DatosHistorial } from '../historialPdf';
import type { CambioAcceso } from './excelAccesos';

type Perfil = Schema['Perfil']['type'];
type Cargo = Schema['Cargo']['type'];
type Pago = Schema['Pago']['type'];
type Unidad = Schema['Unidad']['type'];
type Cuenta = { status?: string };

export function ResidentesRapido({ go }: { go: (k: string) => void }) {
  const { condo, unidades, puede, firmaReporte } = useAdmin();
  const veChat = puede('chat');
  const veFinanzas = puede('finanzas');
  const cambiaContrasena = puede('usuarios', 'editar');
  const veUsuarios = puede('usuarios');
  const cid = condo!.id;
  const datos = useLoad(async () => {
    const [perfiles, cuentas, cargos, pagos] = await Promise.all([
      all<Perfil>((o) => db.models.Perfil.list(o)),
      cambiaContrasena ? adminCall<Record<string, Cuenta>>('estadoCuentas') : Promise.resolve({} as Record<string, Cuenta>),
      veFinanzas ? all<Cargo>((o) => db.models.Cargo.cargosPorCondominio({ condominioId: cid }, o)) : Promise.resolve([] as Cargo[]),
      veFinanzas ? all<Pago>((o) => db.models.Pago.pagosPorCondominio({ condominioId: cid }, o)) : Promise.resolve([] as Pago[]),
    ]);
    return {
      perfiles: perfiles.filter((p) => p.condominioId === cid && p.rol === 'RESIDENTE' && (p.estado === 'APROBADO' || p.estado === 'SUSPENDIDO')),
      cuentas,
      cargos,
      pagos,
    };
  }, [cid]);
  const [buscar, setBuscar] = useState('');
  const [chat, setChat] = useState<{ unidadId: string; titulo: string } | null>(null);
  const [contrasena, setContrasena] = useState<Perfil | null>(null);
  const [accesos, setAccesos] = useState<{ p: Perfil; unidad: string } | null>(null);
  const [historial, setHistorial] = useState<DatosHistorial | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [importar, setImportar] = useState(false);
  const [registro, setRegistro] = useState(false);
  const { run, busy } = useAction();

  if (registro) return <RegistroActivaciones puedeCortar={cambiaContrasena} onBack={() => (setRegistro(false), datos.reload(true))} />;
  const titulo = condo!.tipoUnidad === 'DEPARTAMENTO' ? 'Departamentos' : condo!.tipoUnidad === 'CASA' ? 'Casas' : 'Unidades';
  if (datos.loading && !datos.data) return <Loading />;
  if (datos.error) return <ErrorBox error={datos.error} retry={datos.reload} />;
  const { perfiles, cuentas, cargos, pagos } = datos.data!;
  const h = hoy();
  // Al corriente: sin cargos con la fecha límite vencida. Saldo pendiente: lo vencido sin pagar.
  const vencidoDe = (id: string) => cargos.filter((c) => c.unidadId === id && c.estado === 'PENDIENTE' && c.vence && c.vence < h).reduce((s, c) => s + c.monto, 0);
  const nombres = (rs: Perfil[]) => rs.map((p) => p.nombre || p.email).join(', ');
  const q = buscar.trim().toLowerCase();
  const filas = unidades
    .map((u) => ({ u, rs: perfiles.filter((p) => p.unidadId === u.id) }))
    .filter(({ u, rs }) => !q || `${u.etiqueta} ${rs.map((p) => `${p.nombre ?? ''} ${p.email}`).join(' ')}`.toLowerCase().includes(q));
  const fichaU = filas.find((x) => x.u.id === ficha) ?? (ficha ? { u: unidades.find((u) => u.id === ficha)!, rs: perfiles.filter((p) => p.unidadId === ficha) } : null);
  const abrirHistorial = (u: Unidad, rs: Perfil[]) =>
    setHistorial({
      condominio: condo!.nombre,
      direccion: condo!.direccion,
      unidad: u.etiqueta,
      residente: nombres(rs) || u.propietario,
      cargos: cargos.filter((c) => c.unidadId === u.id),
      pagos: pagos.filter((p) => p.unidadId === u.id),
      hoy: h,
      generadoPor: firmaReporte,
    });

  // Excel de control de accesos: una fila por residente (o por casa sin residente), ordenado por casa.
  const descargar = () =>
    run(async () => {
      const { descargarExcelAccesos } = await import('./excelAccesos');
      await descargarExcelAccesos({
        condominio: condo!.nombre,
        hoy: h,
        generadoPor: firmaReporte,
        filas: unidades.flatMap((u) => {
          const rs = perfiles.filter((p) => p.unidadId === u.id);
          const vencido = veFinanzas ? vencidoDe(u.id) : null;
          return rs.length ? rs.map((p) => ({ u, p, vencido })) : [{ u, vencido }];
        }),
      });
    }, 'Excel de control de accesos descargado');

  return (
    <div className="stack">
      <div>
        <button className="linklike" onClick={() => go('panel')}>
          <Icon name="back" /> Panel
        </button>
      </div>
      <PageHead icon="users" title="Residentes" sub={`${condo!.nombre} · ${unidades.length} ${titulo.toLowerCase()}`}>
        <button className="btn-app secondary" disabled={busy} onClick={descargar}>
          <Icon name="download" />
          {busy ? 'Generando…' : 'Descargar Excel'}
        </button>
        {cambiaContrasena && (
          <button className="btn-app secondary" onClick={() => setImportar(true)}>
            <Icon name="upload" />
            Importar información
          </button>
        )}
        {veUsuarios && (
          <button className="btn-app secondary" onClick={() => setRegistro(true)}>
            <Icon name="clock" />
            Registro de activaciones
          </button>
        )}
      </PageHead>
      <section className="panel">
        <div className="panel-head">
          <h2>{titulo}</h2>
          <input className="input" style={{ maxWidth: 260 }} placeholder="Buscar casa o nombre…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        {filas.length ? (
          <Tarjetas>
            {filas.map(({ u, rs }) => {
              const vencido = vencidoDe(u.id);
              const suspendido = rs.some((p) => p.estado !== 'APROBADO');
              return (
                <Tarjeta
                  key={u.id}
                  tono={veFinanzas ? (vencido > 0 ? 'mal' : 'ok') : !rs.length ? 'neutro' : suspendido ? 'mal' : 'ok'}
                  onClick={() => setFicha(u.id)}
                  media={<TarjetaIcono name="building" />}
                  titulo={u.etiqueta}
                  sub={nombres(rs) || 'Sin residente con acceso'}
                  lado={
                    <>
                      {veFinanzas &&
                        (vencido > 0 ? (
                          <span className="pill mal">
                            Debe <b>{money(vencido)}</b>
                          </span>
                        ) : (
                          <span className="pill ok">Al corriente</span>
                        ))}
                      {suspendido && <span className="pill sm mal">Acceso suspendido</span>}
                    </>
                  }
                />
              );
            })}
          </Tarjetas>
        ) : (
          <Empty icon="users">{q ? 'Sin resultados.' : `El condominio no tiene ${titulo.toLowerCase()}.`}</Empty>
        )}
      </section>
      {importar && (
        <ImportarAccesos
          perfiles={perfiles}
          etiqueta={(id) => unidades.find((u) => u.id === id)?.etiqueta ?? '—'}
          onClose={() => setImportar(false)}
          onDone={() => (setImportar(false), datos.reload(true))}
        />
      )}
      {fichaU && (
        <Modal title={fichaU.u.etiqueta} onClose={() => setFicha(null)}>
          <div className="stack">
            {veFinanzas && (
              <div>
                {vencidoDe(fichaU.u.id) > 0 ? (
                  <span className="pill mal">
                    Saldo pendiente <b>{money(vencidoDe(fichaU.u.id))}</b>
                  </span>
                ) : (
                  <span className="pill ok">Al corriente</span>
                )}
              </div>
            )}
            {fichaU.rs.length ? (
              fichaU.rs.map((p) => (
                <div key={p.userId} className="res-persona">
                  <div className="res-persona-info">
                    <span className="res-nombre">{p.nombre || p.email}</span>
                    <span className={`pill sm ${p.estado === 'APROBADO' ? 'ok' : 'mal'}`}>
                      <span className="pill-punto" />
                      {p.estado === 'APROBADO' ? 'Acceso activado' : 'Acceso suspendido'}
                    </span>
                    {p.estado === 'APROBADO' && p.accesoSinEnviar && <span className="pill sm mal">Accesos sin enviar</span>}
                    <ListaAccesos p={p} />
                  </div>
                  {cambiaContrasena && (
                    <div className="res-acciones">
                      <button className="btn-app sm secondary" onClick={() => (setAccesos({ p, unidad: fichaU.u.etiqueta }), setFicha(null))}>
                        <Icon name="package" />
                        Control de accesos
                      </button>
                      {p.estado === 'APROBADO' && (
                        <button className="btn-app sm secondary" onClick={() => (setContrasena(p), setFicha(null))}>
                          <Icon name="shield" />
                          Contraseña
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Sin residente con acceso.
              </p>
            )}
            {(veFinanzas || (veChat && fichaU.rs.length > 0)) && (
              <Acciones>
                {veFinanzas && (
                  <button className="btn-app secondary" onClick={() => (abrirHistorial(fichaU.u, fichaU.rs), setFicha(null))}>
                    <Icon name="file" />
                    Historial de pagos
                  </button>
                )}
                {veChat && fichaU.rs.length > 0 && (
                  <button className="btn-app" onClick={() => (setChat({ unidadId: fichaU.u.id, titulo: `${fichaU.u.etiqueta} · ${nombres(fichaU.rs)}` }), setFicha(null))}>
                    <Icon name="chat" />
                    Chat
                  </button>
                )}
              </Acciones>
            )}
          </div>
        </Modal>
      )}
      {historial && <HistorialVista datos={historial} onClose={() => setHistorial(null)} />}
      {chat && (
        <Modal title={`Chat con ${chat.titulo}`} onClose={() => setChat(null)} wide>
          <ChatUnidad unidadId={chat.unidadId} />
        </Modal>
      )}
      {accesos && (
        <ControlAccesos
          p={accesos.p}
          unidad={accesos.unidad}
          onClose={() => (setAccesos(null), datos.reload(true))}
          onDone={() => (setAccesos(null), datos.reload(true))}
        />
      )}
      {contrasena && (
        <Contrasena p={contrasena} sinPrimerIngreso={cuentas[contrasena.userId]?.status === 'FORCE_CHANGE_PASSWORD'} onClose={() => (setContrasena(null), datos.reload(true))} />
      )}
    </div>
  );
}

/** Importa el Excel de control de accesos: muestra qué accesos cambian de estado y los aplica al confirmar. */
function ImportarAccesos({
  perfiles,
  etiqueta,
  onClose,
  onDone,
}: {
  perfiles: Perfil[];
  etiqueta: (unidadId?: string | null) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [leido, setLeido] = useState<{ cambios: CambioAcceso[]; avisos: string[] } | null>(null);
  const { run, busy } = useAction();
  const leer = (f?: File) =>
    f &&
    run(async () => {
      const { leerExcelAccesos } = await import('./excelAccesos');
      setLeido(await leerExcelAccesos(f, perfiles, etiqueta));
    });
  const aplicar = async () => {
    const okk = await run(
      () => adminCall('accesos.estados', { cambios: leido!.cambios.map(({ userId, accesoId, estado }) => ({ userId, accesoId, estado })) }),
      `${leido!.cambios.length} acceso(s) actualizado(s)`,
    );
    if (okk) onDone();
  };
  const susp = leido?.cambios.filter((c) => c.estado === 'SUSPENDIDO').length ?? 0;
  return (
    <Modal title="Importar control de accesos" onClose={onClose} wide>
      <div className="form">
        <p className="small muted" style={{ margin: 0 }}>
          Sube el Excel descargado de esta sección con el estado de cada acceso (Activado o Suspendido). Antes de guardar verás qué cambia.
        </p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => (leer(e.target.files?.[0]), (e.target.value = ''))} />
        {leido && (
          <>
            {leido.cambios.length ? (
              <>
                <div className="alert small">
                  {leido.cambios.length} acceso(s) cambian: <strong>{susp} a Suspendido</strong> y <strong>{leido.cambios.length - susp} a Activado</strong>.
                </div>
                <div className="table-wrap">
                  <table className="tbl tbl-tarjetas">
                    <thead>
                      <tr>
                        <th>Casa</th>
                        <th>Residente</th>
                        <th>Acceso</th>
                        <th>Cambio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leido.cambios.map((c) => (
                        <tr key={c.accesoId}>
                          <td className="tt-titulo">{c.unidad}</td>
                          <td data-label="Residente">{c.residente}</td>
                          <td data-label="Acceso">{c.acceso}</td>
                          <td data-label="Cambio">
                            <span className={`pill sm ${c.estado === 'SUSPENDIDO' ? 'mal' : 'ok'}`}>{c.estado === 'SUSPENDIDO' ? 'Suspendido' : 'Activado'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="alert small">El archivo no trae cambios: todos los accesos tienen el mismo estado que en SIIA.</div>
            )}
            {leido.avisos.length > 0 && (
              <details className="small">
                <summary>{leido.avisos.length} renglón(es) no se tomaron en cuenta</summary>
                <ul>
                  {leido.avisos.slice(0, 50).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
            {leido.cambios.length > 0 && (
              <button className="btn-app" disabled={busy} onClick={aplicar}>
                {busy ? 'Guardando…' : `Aplicar ${leido.cambios.length} cambio(s)`}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
