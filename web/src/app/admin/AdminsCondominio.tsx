// Ficha del condominio › Datos generales: qué administradores lo administran (solo superadministrador).
// Asignar o quitar aquí equivale a marcar el condominio en Administradores › Editar.
import { useState } from 'react';
import { adminCall } from '../api';
import { Acciones, Badge, Datos, Empty, ErrorBox, Field, Loading, Modal, Tarjeta, TarjetaIcono, Tarjetas, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';

type Admin = { userId: string; nombre: string | null; email: string; estado: string; rol: string; todos: boolean; asignado: boolean; condominios: number | null };

export function AdminsCondominio() {
  const { condo } = useAdmin();
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useLoad(() => adminCall<Admin[]>('condominios.administradores', { condominioId: condo!.id }), [condo?.id]);
  const asignados = (data ?? []).filter((a) => a.asignado);
  const disponibles = (data ?? []).filter((a) => !a.asignado);
  const [ficha, setFicha] = useState<string | null>(null);
  const fichaA = asignados.find((a) => a.userId === ficha);

  async function cambiar(a: Admin, asignar: boolean) {
    const ok = await run(
      () => adminCall('condominios.asignarAdmin', { condominioId: condo!.id, userId: a.userId, asignar }),
      asignar ? `${a.nombre || a.email} ya administra ${condo!.nombre}.` : `${a.nombre || a.email} ya no administra ${condo!.nombre}.`,
    );
    if (ok) reload(true);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: '1.1rem' }}>Administradores de este condominio</h2>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Los superadministradores tienen acceso a todos los condominios. Aquí eliges qué administradores atienden este; cada uno trabaja según su rol.
      </p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <>
          {asignados.length ? (
            <Tarjetas>
              {asignados.map((a) => (
                <Tarjeta
                  key={a.userId}
                  tono={a.estado === 'APROBADO' ? 'ok' : 'mal'}
                  onClick={() => setFicha(a.userId)}
                  media={<TarjetaIcono name="users" />}
                  titulo={a.nombre || a.email}
                  sub={`${a.email}${a.todos ? ' · todos los condominios' : a.condominios && a.condominios > 1 ? ` · ${a.condominios} condominios` : ''}`}
                  lado={
                    <>
                      <Badge>{a.rol}</Badge>
                      {a.estado !== 'APROBADO' && <Badge estado={a.estado} />}
                    </>
                  }
                />
              ))}
            </Tarjetas>
          ) : (
            <Empty icon="shield">Ningún administrador asignado; solo los superadministradores lo ven.</Empty>
          )}
          {fichaA && (
            <Modal title={fichaA.nombre || fichaA.email} onClose={() => setFicha(null)}>
              <div className="stack">
                <div className="row-actions">
                  <Badge>{fichaA.rol}</Badge>
                  {fichaA.estado !== 'APROBADO' && <Badge estado={fichaA.estado} />}
                </div>
                <Datos
                  items={[
                    ['Correo', fichaA.email],
                    ['Condominios', fichaA.todos ? 'Todos los condominios' : fichaA.condominios ? String(fichaA.condominios) : null],
                  ]}
                />
                {fichaA.todos ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    Atiende todos los condominios; se cambia en Administradores.
                  </p>
                ) : (
                  <Acciones>
                    <button className="btn-app danger" disabled={busy} onClick={() => (setFicha(null), cambiar(fichaA, false))}>
                      Quitar de este condominio
                    </button>
                  </Acciones>
                )}
              </div>
            </Modal>
          )}
          {disponibles.length > 0 && (
            <Field label="Asignar administrador">
              <select
                value=""
                disabled={busy}
                onChange={(e) => {
                  const a = disponibles.find((x) => x.userId === e.target.value);
                  if (a) cambiar(a, true);
                }}
              >
                <option value="">Elige un administrador…</option>
                {disponibles.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.nombre || a.email} · {a.rol}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
    </section>
  );
}
