// Panel › Asistencia técnica: solicitudes de «Pide ayuda» (siia.casa/ayuda) de residentes que no pueden entrar al
// portal: no recibieron sus accesos, vencieron u olvidaron su contraseña. Antes caían en Cotizaciones. Cada solicitud
// trae condominio, casa o departamento y el correo de la cuenta; si el correo es de una cuenta que este administrador
// gestiona, se le reenvía el acceso o se le asigna contraseña desde aquí mismo. Sigue pendiente (campana y contador)
// hasta que alguien la marca como atendida.
import { useMemo, useState } from 'react';
import { adminCall, type Schema } from '../api';
import { Badge, Datos, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, Tarjeta, TarjetaIcono, Tarjetas, useAction, useLoad } from '../ui';
import { useAdmin } from './AdminApp';
import { Contrasena } from './Residentes';
import { cerrarNotificaciones } from '../Campana';
import { fechaCompleta, type Cotizacion } from './Cotizaciones';

export type Cuenta = {
  userId: string;
  nombre?: string | null;
  email: string;
  rol: string;
  estado: string;
  condominio?: string | null;
  unidad?: string | null;
  status?: string | null;
};
export type SolicitudAyuda = Omit<Cotizacion, 'origen'> & { origen: 'SOPORTE'; unidad?: string | null; cuenta?: Cuenta | null };

export const listaAsistencia = () => adminCall<SolicitudAyuda[]>('asistencia.lista');

const ESTADO_CUENTA: Record<string, string> = {
  FORCE_CHANGE_PASSWORD: 'No ha hecho su primer ingreso',
  CONFIRMED: 'Ya entró al portal',
  RESET_REQUIRED: 'Debe restablecer su contraseña',
};

type Filtro = 'PENDIENTE' | 'RESPONDIDA' | 'TODAS';

export function AsistenciaAdmin({ abrir, onCambio }: { abrir?: string; onCambio?: () => void }) {
  const { puede } = useAdmin();
  const gestiona = puede('usuarios', 'editar');
  const { data, error, loading, reload } = useLoad(listaAsistencia);
  const [filtro, setFiltro] = useState<Filtro>('PENDIENTE');
  const [buscar, setBuscar] = useState('');
  const [abiertaId, setAbiertaId] = useState<string | null>(abrir ?? null);
  const lista = data ?? [];
  const pendientes = lista.filter((c) => c.estado === 'PENDIENTE').length;
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return lista.filter(
      (c) => (filtro === 'TODAS' || c.estado === filtro) && (!q || [c.nombre, c.telefono, c.correo, c.desarrollo, c.unidad, c.motivo].some((x) => x?.toLowerCase().includes(q))),
    );
  }, [lista, filtro, buscar]);
  const abierta = lista.find((c) => c.id === abiertaId) ?? null;
  const recargar = () => (reload(true), onCambio?.());

  return (
    <div className="stack">
      <PageHead icon="help" title="Asistencia técnica" sub="Residentes que piden ayuda para entrar al portal (accesos que no llegaron, vencidos o contraseña olvidada)." />
      <section className="panel">
        <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Seg
            value={filtro}
            onChange={setFiltro}
            options={[
              ['PENDIENTE', `Pendientes (${pendientes})`],
              ['RESPONDIDA', 'Atendidas'],
              ['TODAS', 'Todas'],
            ]}
          />
          <input className="input" style={{ maxWidth: 280 }} placeholder="Buscar nombre, correo, condominio…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
      </section>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : visibles.length ? (
        <section className="panel">
          <Tarjetas>
            {visibles.map((c) => (
              <Tarjeta
                key={c.id}
                tono={c.estado === 'PENDIENTE' ? 'warn' : 'ok'}
                onClick={() => setAbiertaId(c.id)}
                media={<TarjetaIcono name="help" />}
                titulo={`${c.nombre} · ${c.motivo ?? 'Ayuda'}`}
                sub={[c.desarrollo, c.unidad, c.correo, fechaCompleta(c.createdAt)].filter(Boolean).join(' · ')}
                lado={
                  <>
                    <Badge estado={c.estado === 'PENDIENTE' ? 'PENDIENTE' : 'APROBADO'}>{c.estado === 'PENDIENTE' ? 'Pendiente' : 'Atendida'}</Badge>
                    {c.cuenta ? <span className="pill ok">Cuenta encontrada</span> : <span className="pill warn">Sin cuenta con ese correo</span>}
                  </>
                }
              />
            ))}
          </Tarjetas>
        </section>
      ) : (
        <section className="panel">
          <Empty icon="check">{filtro === 'PENDIENTE' ? 'No hay solicitudes de ayuda pendientes.' : 'Sin solicitudes.'}</Empty>
        </section>
      )}
      {abierta && <FichaAyuda c={abierta} gestiona={gestiona} onClose={() => setAbiertaId(null)} onCambio={recargar} />}
    </div>
  );
}

function FichaAyuda({ c, gestiona, onClose, onCambio }: { c: SolicitudAyuda; gestiona: boolean; onClose: () => void; onCambio: () => void }) {
  const { superadmin } = useAdmin();
  const [contrasena, setContrasena] = useState(false);
  const [nota, setNota] = useState('');
  const { run, busy } = useAction();
  const cuenta = c.cuenta;
  const atender = async (texto: string) => {
    const ok = await run(() => adminCall('cotizaciones.responder', { id: c.id, nota: texto }), 'Solicitud marcada como atendida');
    if (ok) {
      cerrarNotificaciones((tag) => tag === `asistencia-${c.id}`);
      onCambio();
      onClose();
    }
  };
  const reenviar = async () => {
    if (!cuenta) return;
    const aviso = cuenta.status === 'FORCE_CHANGE_PASSWORD' ? '' : ' Su contraseña actual dejará de funcionar.';
    if (!confirm(`¿Enviar un acceso nuevo a ${cuenta.email}?${aviso}`)) return;
    const ok = await run(() => adminCall('reenviarAcceso', { userId: cuenta.userId }), `Accesos enviados a ${cuenta.email}`);
    if (ok && c.estado === 'PENDIENTE') await atender(`Se reenvió el acceso por correo a ${cuenta.email}.`);
  };
  return (
    <Modal title={`Asistencia · ${c.nombre}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row-actions">
          <Badge estado={c.estado === 'PENDIENTE' ? 'PENDIENTE' : 'APROBADO'}>{c.estado === 'PENDIENTE' ? 'Pendiente' : 'Atendida'}</Badge>
          <span className="small muted">{fechaCompleta(c.createdAt)}</span>
        </div>
        <Datos
          items={[
            ['Qué pasó', c.motivo],
            ['Condominio', c.desarrollo],
            ['Casa o departamento', c.unidad],
            ['Correo de su cuenta', c.correo],
            ['Teléfono', c.telefono],
            ['Mensaje', c.mensaje],
          ]}
        />
        <section className="panel" style={{ margin: 0, background: 'var(--bg-soft)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Cuenta en SIIA</h3>
          {cuenta ? (
            <>
              <Datos
                items={[
                  ['Nombre', cuenta.nombre],
                  ['Correo', cuenta.email],
                  ['Condominio', cuenta.condominio],
                  ['Casa o departamento', cuenta.unidad],
                  ['Estado', cuenta.estado === 'APROBADO' ? (ESTADO_CUENTA[cuenta.status ?? ''] ?? 'Activa') : cuenta.estado === 'SUSPENDIDO' ? 'Suspendida' : 'Sin autorizar'],
                ]}
              />
              {gestiona && cuenta.estado === 'APROBADO' && (
                <div className="row-actions" style={{ marginTop: 10 }}>
                  <button className="btn-app" disabled={busy} onClick={reenviar}>
                    <Icon name="mail" />
                    {cuenta.status === 'FORCE_CHANGE_PASSWORD' ? 'Enviar acceso por correo' : 'Reenviar acceso por correo'}
                  </button>
                  <button className="btn-app secondary" disabled={busy} onClick={() => setContrasena(true)}>
                    <Icon name="shield" />
                    Asignar contraseña
                  </button>
                </div>
              )}
              {cuenta.estado !== 'APROBADO' && <p className="small muted">La cuenta no está activa: revísala en Condominios › Residentes.</p>}
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              No encontramos una cuenta con ese correo en tus condominios. Búscalo en Condominios › Residentes por su nombre o casa (quizá escribió otro correo) o
              comunícate con él al {c.telefono ?? 'teléfono que dejó'}.
            </p>
          )}
        </section>
        {c.estado === 'PENDIENTE' ? (
          gestiona && (
            <div className="form">
              <Field label="Nota de cómo se atendió (opcional)">
                <input maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Le llamé y le reenvié su acceso…" />
              </Field>
              <div>
                <button className="btn-app secondary" disabled={busy} onClick={() => atender(nota)}>
                  <Icon name="check" />
                  Marcar como atendida
                </button>
              </div>
            </div>
          )
        ) : (
          <Datos
            items={[
              ['Atendida por', c.respondidaPor?.nombre ?? null],
              ['Cuándo', fechaCompleta(c.respondidaEn)],
              ['Nota', c.notaRespuesta],
            ]}
          />
        )}
        {superadmin && c.estado !== 'PENDIENTE' && (
          <div>
            <button className="linklike small" disabled={busy} onClick={() => run(() => adminCall('cotizaciones.reabrir', { id: c.id }).then(onCambio), 'Solicitud reabierta')}>
              Volver a pendiente
            </button>
          </div>
        )}
      </div>
      {contrasena && cuenta && (
        <Contrasena
          p={cuenta as unknown as Schema['Perfil']['type']}
          sinPrimerIngreso={cuenta.status === 'FORCE_CHANGE_PASSWORD'}
          onClose={() => {
            setContrasena(false);
            if (c.estado === 'PENDIENTE' && confirm('¿Marcar la solicitud como atendida?')) atender('Se asignó una contraseña nueva.');
          }}
        />
      )}
    </Modal>
  );
}
