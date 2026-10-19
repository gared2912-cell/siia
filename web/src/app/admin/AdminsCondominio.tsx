// Ficha del condominio › Datos generales: qué administradores lo administran (solo superadministrador).
// Asignar o quitar aquí equivale a marcar el condominio en Administradores › Editar.
import { adminCall } from '../api';
import { Badge, Empty, ErrorBox, Field, Loading, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';

type Admin = { userId: string; nombre: string | null; email: string; estado: string; rol: string; todos: boolean; asignado: boolean; condominios: number | null };

export function AdminsCondominio() {
  const { condo } = useAdmin();
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useLoad(() => adminCall<Admin[]>('condominios.administradores', { condominioId: condo!.id }), [condo?.id]);
  const asignados = (data ?? []).filter((a) => a.asignado);
  const disponibles = (data ?? []).filter((a) => !a.asignado);

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
            <ul className="list">
              {asignados.map((a) => (
                <li key={a.userId}>
                  <div className="list-main">
                    <strong>{a.nombre || a.email}</strong> <Badge>{a.rol}</Badge> {a.estado !== 'APROBADO' && <Badge estado={a.estado} />}
                    <div className="list-sub" style={{ overflowWrap: 'anywhere' }}>
                      {a.email}
                      {a.todos ? ' · todos los condominios' : a.condominios && a.condominios > 1 ? ` · ${a.condominios} condominios` : ''}
                    </div>
                  </div>
                  {!a.todos && (
                    <button className="linklike" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => cambiar(a, false)}>
                      Quitar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="shield">Ningún administrador asignado; solo los superadministradores lo ven.</Empty>
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
