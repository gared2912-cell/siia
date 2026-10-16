import { useState } from 'react';
import { portal } from '../api';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Seg, fecha, fechaHora, hoy, money, useAction, useLoad } from '../ui';
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
  parteDeId?: string | null;
};
type Reserva = { id: string; amenidadId: string; fecha: string; horaInicio: string; horaFin: string; invitados?: number; estado: string; nota?: string; limitePago?: string };
type Doc = { slot: string; titulo: string };
type Ocupado = { horaInicio: string; horaFin: string; estado: string; por: string | null };

/** Abre un documento de amenidades (reglamento o términos) en otra pestaña. */
async function abrirDocumento(slot: string) {
  const w = window.open('', '_blank');
  try {
    const { url } = await portal<{ url: string }>('amenidades.documento', { slot });
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    alert(e instanceof Error ? e.message : String(e));
  }
}

function Documentos({ docs }: { docs: Doc[] }) {
  return (
    <>
      {docs.map((d, i) => (
        <span key={d.slot}>
          {i > 0 && (i === docs.length - 1 ? ' y ' : ', ')}
          <button type="button" className="linklike" onClick={() => abrirDocumento(d.slot)}>
            {d.titulo}
          </button>
        </span>
      ))}
    </>
  );
}

export function Amenidades(_: ModProps) {
  const { data, error, loading, reload } = useLoad(() => portal<{ amenidades: Amenidad[]; documentos: Doc[]; misReservas: Reserva[] }>('amenidades.lista'));
  const [reservar, setReservar] = useState<Amenidad | null>(null);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { amenidades, misReservas } = data!;
  const documentos = data!.documentos ?? [];
  const principales = amenidades.filter((a) => !a.parteDeId || !amenidades.some((x) => x.id === a.parteDeId));
  const secciones = (id: string) => amenidades.filter((a) => a.parteDeId === id);
  const nombre = (id: string) => {
    const a = amenidades.find((x) => x.id === id);
    const padre = a?.parteDeId ? amenidades.find((x) => x.id === a.parteDeId) : undefined;
    return a ? (padre ? `${a.nombre} · ${padre.nombre}` : a.nombre) : 'Amenidad';
  };
  const hoyStr = hoy();

  const cancelar = (r: Reserva) =>
    confirm('¿Cancelar esta reserva?') && run(() => portal('amenidades.cancelar', { reservaId: r.id }).then(() => reload(true)), 'Reserva cancelada');

  return (
    <div className="stack">
      <PageHead icon="calendar" title="Reservas de amenidades" sub="Aparta las áreas comunes de tu condominio." />
      {documentos.length > 0 && (
        <div className="alert small">
          Consulta el <Documentos docs={documentos} /> antes de reservar.
        </div>
      )}

      {principales.length ? (
        <div className="grid-cards">
          {principales.map((a) => {
            const sec = secciones(a.id);
            return (
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
                  {a.costo ? <li>{sec.length ? 'Completa' : 'Costo'}: {money(a.costo)}</li> : null}
                  {sec.map((x) => (
                    <li key={x.id}>
                      {x.nombre}
                      {x.costo ? `: ${money(x.costo)}` : ''}
                    </li>
                  ))}
                  {a.requiereAprobacion && <li>Requiere aprobación de la administración</li>}
                </ul>
                {sec.length > 0 && <p className="small" style={{ margin: '0 0 12px' }}>Puedes reservarla completa o solo las secciones que necesites.</p>}
                <button className="btn-app sm" onClick={() => setReservar(a)}>
                  <Icon name="calendar" />
                  Reservar
                </button>
              </article>
            );
          })}
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
                  {r.estado === 'PENDIENTE_PAGO' && (
                    <div className="small">
                      Horario apartado para ti. Sube tu comprobante en Finanzas antes del{' '}
                      <strong>{r.limitePago ? fechaHora(r.limitePago) : '—'}</strong> o la reserva se cancelará automáticamente.
                    </div>
                  )}
                  {r.nota && <div className="small">{r.nota}</div>}
                </div>
                {['PENDIENTE_PAGO', 'SOLICITADA', 'APROBADA'].includes(r.estado) && r.fecha >= hoyStr && (
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
          principal={reservar}
          secciones={secciones(reservar.id)}
          documentos={documentos}
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

function Reservar({
  principal,
  secciones,
  documentos,
  onClose,
  onDone,
}: {
  principal: Amenidad;
  secciones: Amenidad[];
  documentos: Doc[];
  onClose: () => void;
  onDone: () => void;
}) {
  const conSecciones = secciones.length > 0;
  const [modo, setModo] = useState<'completa' | 'secciones'>('completa');
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [f, setF] = useState({ fecha: hoy(), horaInicio: principal.horaApertura ?? '10:00', horaFin: '', invitados: '', nota: '' });
  const opciones = [principal, ...secciones];
  const sel = !conSecciones || modo === 'completa' ? [principal] : secciones.filter((s) => elegidas.includes(s.id));
  const ocup = useLoad(
    async () =>
      Object.fromEntries(
        await Promise.all(opciones.map(async (a) => [a.id, await portal<Ocupado[]>('amenidades.disponibilidad', { amenidadId: a.id, fecha: f.fecha })] as const)),
      ) as Record<string, Ocupado[]>,
    [f.fecha],
  );
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  // Horario y límites comunes a lo elegido
  const abre = sel.map((a) => a.horaApertura).filter(Boolean).sort().pop();
  const cierra = sel.map((a) => a.horaCierre).filter(Boolean).sort()[0];
  const maxHoras = Math.min(...sel.map((a) => a.maxHoras || Infinity));
  const capacidad = sel.every((a) => a.capacidad) ? sel.reduce((s, a) => s + (a.capacidad ?? 0), 0) : 0;
  const total = sel.reduce((s, a) => s + (a.costo ?? 0), 0);
  const aprobacion = total === 0 && sel.some((a) => a.requiereAprobacion);

  const ocupado = (a: Amenidad) => {
    const o = ocup.data?.[a.id];
    if (ocup.loading && !o) return 'consultando…';
    const txt = (x: Ocupado) => `${x.horaInicio}–${x.horaFin}${x.por ? ` (${x.por})` : ''}`;
    const apartado = (o ?? []).filter((x) => x.estado === 'APROBADA');
    const espera = (o ?? []).filter((x) => x.estado !== 'APROBADA');
    if (!apartado.length && !espera.length) return 'disponible todo el día';
    return [apartado.length && `reservado ${apartado.map(txt).join(', ')}`, espera.length && `apartado en espera de pago ${espera.map(txt).join(', ')}`]
      .filter(Boolean)
      .join(' · ');
  };

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const okk = await run(async () => {
      if (!sel.length) throw new Error('Elige al menos una sección.');
      await portal('amenidades.reservar', {
        amenidadIds: sel.map((a) => a.id),
        ...f,
        invitados: Number(f.invitados) || 0,
        aceptaTerminos: documentos.length > 0,
      });
    }, total > 0 ? 'Reserva registrada; el cargo ya está en tu estado de cuenta.' : aprobacion ? 'Solicitud enviada; la administración la aprobará.' : 'Reserva confirmada');
    if (okk) onDone();
  }

  return (
    <Modal title={`Reservar ${principal.nombre}`} onClose={onClose}>
      <form className="form" onSubmit={enviar}>
        {conSecciones && (
          <>
            <Seg
              value={modo}
              onChange={setModo}
              options={[
                ['completa', `${principal.nombre} completa`],
                ['secciones', 'Solo algunas secciones'],
              ]}
            />
            {modo === 'secciones' && (
              <div className="checks">
                {secciones.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={elegidas.includes(s.id)}
                      onChange={() => setElegidas(elegidas.includes(s.id) ? elegidas.filter((x) => x !== s.id) : [...elegidas, s.id])}
                    />
                    {s.nombre}
                    {s.costo ? ` · ${money(s.costo)}` : ''}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {sel.filter((a) => a.reglas).map((a) => (
          <div key={a.id} className="alert small pre">
            {sel.length > 1 && <strong>{a.nombre}: </strong>}
            {a.reglas}
          </div>
        ))}
        <Field label="Fecha">
          <input required type="date" min={hoy()} value={f.fecha} onChange={set('fecha')} />
        </Field>
        <div className="small">
          <strong>Ocupado ese día</strong>
          {(sel.length ? sel : [principal]).map((a) => (
            <div key={a.id}>
              {(sel.length > 1 || conSecciones) && `${a.nombre}: `}
              {ocupado(a)}
            </div>
          ))}
        </div>
        <div className="form-2">
          <Field label="Desde">
            <input required type="time" min={abre} max={cierra} value={f.horaInicio} onChange={set('horaInicio')} />
          </Field>
          <Field label="Hasta">
            <input required type="time" min={abre} max={cierra} value={f.horaFin} onChange={set('horaFin')} />
          </Field>
        </div>
        {(abre || cierra || Number.isFinite(maxHoras)) && (
          <p className="small muted" style={{ margin: 0 }}>
            {abre || cierra ? `Horario ${abre ?? '00:00'}–${cierra ?? '23:59'}` : ''}
            {Number.isFinite(maxHoras) ? `${abre || cierra ? ' · ' : ''}máximo ${maxHoras} h` : ''}
          </p>
        )}
        <Field label="Número de invitados">
          <input type="number" min="0" max={capacidad || undefined} value={f.invitados} onChange={set('invitados')} />
        </Field>
        <Field label="Comentarios (opcional)">
          <textarea maxLength={500} value={f.nota} onChange={set('nota')} />
        </Field>
        {total > 0 && (
          <div className="alert small">
            Costo: <strong>{money(total)}</strong>
            {sel.length > 1 && <span> ({sel.map((a) => `${a.nombre} ${money(a.costo)}`).join(' + ')})</span>}. Se cargará a tu estado de cuenta al
            reservar y el horario queda apartado para ti. <strong>Tienes 48 horas para subir tu comprobante en Finanzas</strong>; si no, la reserva se
            cancela automáticamente. Se confirma cuando la administración valida tu pago.
          </div>
        )}
        {documentos.length > 0 && (
          <p className="small" style={{ margin: 0 }}>
            Al presionar «{total > 0 ? 'Reservar' : aprobacion ? 'Solicitar reserva' : 'Reservar'}» aceptas el <Documentos docs={documentos} />.
          </p>
        )}
        <button className="btn-app block" disabled={busy || !sel.length}>
          {busy ? 'Enviando…' : total > 0 ? `Reservar y cargar ${money(total)}` : aprobacion ? 'Solicitar reserva' : 'Reservar'}
        </button>
      </form>
    </Modal>
  );
}
