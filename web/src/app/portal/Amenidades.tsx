import { useState } from 'react';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, fecha, hoy, money, useAction, useLoad } from '../ui';
import type { ModProps } from './PortalApp';

export type Amenidad = {
  id: string;
  nombre: string;
  descripcion?: string;
  horaApertura?: string;
  horaCierre?: string;
  maxHoras?: number;
  capacidad?: number;
  costo?: number;
  requiereAprobacion?: boolean;
  reglas?: string;
};
type Reserva = { id: string; amenidadId: string; fecha: string; horaInicio: string; horaFin: string; invitados?: number; estado: string; nota?: string };

export function Amenidades(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<{ amenidades: Amenidad[]; misReservas: Reserva[] }>('amenidades.lista'));
  const [reservar, setReservar] = useState<Amenidad | null>(null);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { amenidades, misReservas } = data!;
  const nombre = (id: string) => amenidades.find((a) => a.id === id)?.nombre ?? 'Amenidad';
  const hoyStr = hoy();

  const cancelar = (r: Reserva) =>
    confirm('¿Cancelar esta reserva?') && run(() => portal('amenidades.cancelar', { reservaId: r.id }).then(() => reload(true)), 'Reserva cancelada');

  return (
    <div className="stack">
      <PageHead icon="calendar" title="Reservas de amenidades" sub="Aparta las áreas comunes de tu condominio." />

      {amenidades.length ? (
        <div className="grid-cards">
          {amenidades.map((a) => (
            <article key={a.id} className="panel" style={{ marginTop: 0 }}>
              <h3>{a.nombre}</h3>
              {a.descripcion && <p className="small">{a.descripcion}</p>}
              <ul className="small muted" style={{ paddingLeft: 18, margin: '0 0 12px' }}>
                {(a.horaApertura || a.horaCierre) && (
                  <li>
                    Horario {a.horaApertura ?? '00:00'} – {a.horaCierre ?? '23:59'}
                  </li>
                )}
                {a.maxHoras ? <li>Máximo {a.maxHoras} h por reserva</li> : null}
                {a.capacidad ? <li>Capacidad {a.capacidad} personas</li> : null}
                {a.costo ? <li>Costo {money(a.costo)}</li> : null}
                {a.requiereAprobacion && <li>Requiere aprobación de la administración</li>}
              </ul>
              <button className="btn-app sm" onClick={() => setReservar(a)}>
                <Icon name="calendar" />
                Reservar
              </button>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty icon="calendar">La administración aún no da de alta amenidades.</Empty>
        </section>
      )}

      <section className="panel">
        <h2>Mis reservas</h2>
        {misReservas.length ? (
          <ul className="list">
            {misReservas.map((r) => (
              <li key={r.id}>
                <div className="list-main">
                  <strong>{nombre(r.amenidadId)}</strong> <Badge estado={r.estado} />
                  <div className="list-sub">
                    {fecha(r.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} · {r.horaInicio}–{r.horaFin}
                    {r.invitados ? ` · ${r.invitados} invitados` : ''}
                  </div>
                  {r.nota && <div className="small">{r.nota}</div>}
                </div>
                {['SOLICITADA', 'APROBADA'].includes(r.estado) && r.fecha >= hoyStr && (
                  <button className="btn-app sm danger" onClick={() => cancelar(r)}>
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="calendar">Aún no tienes reservas.</Empty>
        )}
      </section>

      {reservar && (
        <Reservar
          amenidad={reservar}
          onClose={() => setReservar(null)}
          onDone={() => {
            setReservar(null);
            reload(true);
          }}
        />
      )}
    </div>
  );
}

function Reservar({ amenidad, onClose, onDone }: { amenidad: Amenidad; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fecha: hoy(), horaInicio: amenidad.horaApertura ?? '10:00', horaFin: '', invitados: '', nota: '' });
  const ocup = useLoad(
    () => portal<{ horaInicio: string; horaFin: string; estado: string }[]>('amenidades.disponibilidad', { amenidadId: amenidad.id, fecha: f.fecha }),
    [f.fecha],
  );
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(
      () => portal('amenidades.reservar', { amenidadId: amenidad.id, ...f, invitados: Number(f.invitados) || 0 }),
      amenidad.requiereAprobacion ? 'Solicitud enviada; la administración la aprobará.' : 'Reserva confirmada',
    );
    if (okk) onDone();
  }

  return (
    <Modal title={`Reservar ${amenidad.nombre}`} onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        {amenidad.reglas && <div className="alert small pre">{amenidad.reglas}</div>}
        <Field label="Fecha">
          <input required type="date" min={hoy()} value={f.fecha} onChange={set('fecha')} />
        </Field>
        <div className="small">
          <strong>Ocupado ese día: </strong>
          {ocup.loading ? 'consultando…' : ocup.data?.length ? ocup.data.map((o) => `${o.horaInicio}–${o.horaFin}`).join(', ') : 'todo el día disponible'}
        </div>
        <div className="form-2">
          <Field label="Desde">
            <input required type="time" min={amenidad.horaApertura} max={amenidad.horaCierre} value={f.horaInicio} onChange={set('horaInicio')} />
          </Field>
          <Field label="Hasta">
            <input required type="time" min={amenidad.horaApertura} max={amenidad.horaCierre} value={f.horaFin} onChange={set('horaFin')} />
          </Field>
        </div>
        <Field label="Número de invitados">
          <input type="number" min="0" max={amenidad.capacidad || undefined} value={f.invitados} onChange={set('invitados')} />
        </Field>
        <Field label="Comentarios (opcional)">
          <textarea maxLength={500} value={f.nota} onChange={set('nota')} />
        </Field>
        <button className="btn-app block" disabled={busy}>
          {busy ? 'Enviando…' : amenidad.requiereAprobacion ? 'Solicitar reserva' : 'Reservar'}
        </button>
      </form>
    </Modal>
  );
}
