// Control de accesos de un residente: llaveros, tarjetas, controles de portón… (hasta 6), cada uno Activado o
// Suspendido. Tipo y código no se modifican; el estado sí (aquí o con el Excel). Solo el superadministrador da de baja.
type EstadoNuevo = 'ACTIVO' | 'SUSPENDIDO';
import { useState } from 'react';
import { adminCall, type Schema } from '../api';
import { Field, Icon, Modal, fecha, useAction } from '../ui';
import { useAdmin } from './AdminApp';
import { MAX_ACCESOS, TIPOS_ACCESO, accesosDe, estadoDeAcceso, type Acceso } from '../../../amplify/functions/shared/accesos';

type Perfil = Schema['Perfil']['type'];

/** Accesos de un residente en una línea: «Llavero de proximidad 12345 · Control remoto de portón A7». */
export function ListaAccesos({ p }: { p: Perfil }) {
  const accesos = accesosDe(p.accesos);
  if (!accesos.length) return null;
  return (
    <div className="accesos">
      <span className="small muted">Accesos:</span>
      {accesos.map((a) => (
        <span
          key={a.id}
          className={`acceso-chip ${estadoDeAcceso(a) === 'SUSPENDIDO' ? 'suspendido' : ''}`}
          title={`Alta: ${fecha(a.alta)}${a.porNombre || a.por ? ` · ${a.porNombre || a.por}` : ''}${estadoDeAcceso(a) === 'SUSPENDIDO' ? ` · Suspendido${a.estadoEn ? ` el ${fecha(a.estadoEn)}` : ''}` : ''}`}
        >
          {a.tipo} <strong>{a.codigo}</strong>
          {estadoDeAcceso(a) === 'SUSPENDIDO' && <em> · suspendido</em>}
        </span>
      ))}
    </div>
  );
}

export function ControlAccesos({ p, unidad, onClose, onDone }: { p: Perfil; unidad: string; onClose: () => void; onDone: () => void }) {
  const { superadmin } = useAdmin();
  const [actuales, setActuales] = useState<Acceso[]>(() => accesosDe(p.accesos));
  const libres = MAX_ACCESOS - actuales.length;
  const [nuevos, setNuevos] = useState<{ tipo: string; codigo: string; estado: EstadoNuevo }[]>(() => (libres > 0 ? [{ tipo: '', codigo: '', estado: 'ACTIVO' }] : []));
  const { run, busy } = useAction();
  const [cambiado, setCambiado] = useState(false);
  const cambia = (i: number, k: 'tipo' | 'codigo' | 'estado', v: string) => setNuevos(nuevos.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  // Activar o suspender un acceso ya registrado
  const alternar = (a: Acceso) => {
    const estado = estadoDeAcceso(a) === 'SUSPENDIDO' ? 'ACTIVO' : 'SUSPENDIDO';
    if (estado === 'SUSPENDIDO' && !confirm(`¿Suspender «${a.tipo} ${a.codigo}»?`)) return;
    run(async () => {
      await adminCall('accesos.estados', { cambios: [{ userId: p.userId, accesoId: a.id, estado }] });
      setActuales(actuales.map((x) => (x.id === a.id ? { ...x, estado, estadoEn: new Date().toISOString() } : x)));
      setCambiado(true);
    }, estado === 'SUSPENDIDO' ? 'Acceso suspendido' : 'Acceso activado');
  };
  const completos = nuevos.filter((x) => x.tipo && x.codigo.trim());

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (nuevos.some((x) => (x.tipo && !x.codigo.trim()) || (!x.tipo && x.codigo.trim()))) return alert('Completa el tipo y el código de cada acceso.');
    if (!confirm('El tipo y el código ya no se podrán modificar ni borrar (solo el superadministrador); el estado sí lo podrás cambiar. ¿Continuar?')) return;
    const okk = await run(async () => {
      await adminCall('accesos.agregar', { userId: p.userId, accesos: completos.map((x) => ({ tipo: x.tipo, codigo: x.codigo.trim(), estado: x.estado })) });
    }, completos.length === 1 ? 'Acceso registrado' : `${completos.length} accesos registrados`);
    if (okk) onDone();
  }
  const baja = (id: string, texto: string) =>
    confirm(`¿Dar de baja «${texto}»? Esta acción solo la puede hacer el superadministrador.`) &&
    run(async () => {
      const r = await adminCall<{ accesos: Acceso[] }>('accesos.eliminar', { userId: p.userId, accesoId: id });
      setActuales(r.accesos);
    }, 'Acceso dado de baja');

  return (
    <Modal title={`Control de accesos · ${unidad}`} onClose={cambiado ? onDone : onClose}>
      <form className="form" onSubmit={guardar}>
        <div className="alert small">
          <strong>{p.nombre || p.email}</strong> · {actuales.length} de {MAX_ACCESOS} accesos registrados
        </div>
        {actuales.length > 0 && (
          <ul className="list">
            {actuales.map((a) => (
              <li key={a.id}>
                <div className="list-main">
                  <strong>{a.tipo}</strong> · <span style={{ letterSpacing: '0.04em' }}>{a.codigo}</span>{' '}
                  <span className={`pill sm ${estadoDeAcceso(a) === 'SUSPENDIDO' ? 'mal' : 'ok'}`}>{estadoDeAcceso(a) === 'SUSPENDIDO' ? 'Suspendido' : 'Activado'}</span>
                  <div className="list-sub">
                    Alta el {fecha(a.alta)}
                    {(a.porNombre || a.por) && ` por ${a.porNombre || a.por}`}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className={`btn-app sm ${estadoDeAcceso(a) === 'SUSPENDIDO' ? '' : 'secondary'}`}
                    disabled={busy}
                    onClick={() => alternar(a)}
                  >
                    {estadoDeAcceso(a) === 'SUSPENDIDO' ? 'Activar' : 'Suspender'}
                  </button>
                  {superadmin && (
                    <button type="button" className="linklike" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => baja(a.id, `${a.tipo} ${a.codigo}`)}>
                      Dar de baja
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {libres > 0 ? (
          <>
            <h3 style={{ margin: '4px 0 0', fontSize: '1rem' }}>Registrar accesos</h3>
            {nuevos.map((x, i) => (
              <div key={i} className="acceso-fila">
                <Field label="Tipo de acceso">
                  <select value={x.tipo} onChange={(e) => cambia(i, 'tipo', e.target.value)}>
                    <option value="">Selecciona…</option>
                    {TIPOS_ACCESO.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Código o número">
                  <input maxLength={40} value={x.codigo} onChange={(e) => cambia(i, 'codigo', e.target.value)} placeholder="Ej. 0012345" />
                </Field>
                <Field label="Estado">
                  <select value={x.estado} onChange={(e) => cambia(i, 'estado', e.target.value)}>
                    <option value="ACTIVO">Activado</option>
                    <option value="SUSPENDIDO">Suspendido</option>
                  </select>
                </Field>
                {nuevos.length > 1 && (
                  <button type="button" className="icon-btn" aria-label="Quitar renglón" title="Quitar renglón" onClick={() => setNuevos(nuevos.filter((_, j) => j !== i))}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
            ))}
            {nuevos.length < libres && (
              <button type="button" className="linklike" style={{ justifySelf: 'start' }} onClick={() => setNuevos([...nuevos, { tipo: '', codigo: '', estado: 'ACTIVO' }])}>
                <Icon name="plus" /> Agregar otro
              </button>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              El tipo y el código ya no se pueden modificar ni borrar (solo el superadministrador puede dar de baja un acceso, por ejemplo si se pierde). El estado lo puedes cambiar después con «Suspender» o «Activar».
            </p>
            <button className="btn-app" disabled={busy || !completos.length}>
              {busy ? 'Guardando…' : 'Registrar accesos'}
            </button>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Este residente ya tiene el máximo de {MAX_ACCESOS} accesos.{superadmin ? '' : ' Para cambiar alguno, pide al superadministrador que dé de baja el anterior.'}
          </p>
        )}
      </form>
    </Modal>
  );
}
