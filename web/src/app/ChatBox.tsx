// Conversación genérica (residente ↔ administración / caseta). Se actualiza cada pocos segundos.
import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Icon, Loading, fechaHora, useAction, useLoad, usePoll } from './ui';

export type Msg = { id: string; texto: string; autorNombre?: string; autorRol?: string; createdAt: string };

export function ChatBox({
  cargar,
  enviar,
  miRol,
  deps,
  placeholder = 'Escribe un mensaje…',
}: {
  cargar: () => Promise<Msg[]>;
  enviar: (texto: string) => Promise<unknown>;
  miRol: string;
  deps: unknown[];
  placeholder?: string;
}) {
  const { data, error, loading, reload } = useLoad(cargar, deps);
  const [texto, setTexto] = useState('');
  const { run, busy } = useAction();
  const log = useRef<HTMLDivElement>(null);
  usePoll(() => reload(true), 7000);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [data?.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    const okk = await run(() => enviar(t));
    if (okk) {
      setTexto('');
      reload(true);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={log} aria-live="polite">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} retry={reload} />
        ) : data!.length ? (
          data!.map((m) => (
            <div key={m.id} className={`bubble ${m.autorRol === miRol ? 'mine' : ''}`}>
              <small>
                {m.autorNombre} · {fechaHora(m.createdAt)}
              </small>
              {m.texto}
            </div>
          ))
        ) : (
          <Empty icon="chat">Aún no hay mensajes. Escribe el primero.</Empty>
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} maxLength={2000} aria-label="Mensaje" />
        <button className="btn-app" disabled={busy || !texto.trim()} aria-label="Enviar">
          <Icon name="arrow" />
          Enviar
        </button>
      </form>
    </div>
  );
}
