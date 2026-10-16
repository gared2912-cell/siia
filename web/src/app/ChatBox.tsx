// Conversación genérica (residente ↔ administración / caseta). Se actualiza cada pocos segundos.
// Se puede adjuntar una foto: tomarla con la cámara o elegirla de la galería (se reduce antes de subirla).
import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Icon, Loading, fechaHora, useAction, useLoad, usePoll } from './ui';
import { comprimirImagen } from './camara';

export type Msg = { id: string; texto: string; autorNombre?: string; autorRol?: string; createdAt: string; imagenUrl?: string };

/** Texto que lleva un mensaje que solo es foto (se usa en avisos y listas de conversaciones). */
export const TEXTO_FOTO = '📷 Foto';

export function ChatBox({
  cargar,
  enviar,
  miRol,
  deps,
  placeholder = 'Escribe un mensaje…',
}: {
  cargar: () => Promise<Msg[]>;
  /** Sin `enviar`, la conversación es de solo lectura. La foto llega ya reducida. */
  enviar?: (texto: string, imagen?: File) => Promise<unknown>;
  miRol: string;
  deps: unknown[];
  placeholder?: string;
}) {
  const { data, error, loading, reload } = useLoad(cargar, deps);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [vista, setVista] = useState('');
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const { run, busy } = useAction();
  const log = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  usePoll(() => reload(true), 7000);

  // En celular, al abrir la conversación se desplaza la página para que la caja de escribir quede visible
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) caja.current?.scrollIntoView({ block: 'end' });
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [data?.length]);

  useEffect(() => () => void (vista && URL.revokeObjectURL(vista)), [vista]);

  const elegir = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return alert('Adjunta una imagen.');
    setFoto(f);
    setVista(URL.createObjectURL(f));
  };
  const quitar = () => {
    setFoto(null);
    setVista('');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if ((!t && !foto) || !enviar) return;
    const okk = await run(async () => enviar(t, foto ? await comprimirImagen(foto) : undefined));
    if (okk) {
      setTexto('');
      quitar();
      reload(true);
    }
  }

  return (
    <div className="chat" ref={caja}>
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
              {m.imagenUrl && (
                <button type="button" className="chat-foto" onClick={() => setAmpliada(m.imagenUrl!)} aria-label="Ver foto completa">
                  <img src={m.imagenUrl} alt="Foto enviada" loading="lazy" />
                </button>
              )}
              {!(m.imagenUrl && m.texto === TEXTO_FOTO) && m.texto}
            </div>
          ))
        ) : (
          <Empty icon="chat">Aún no hay mensajes. Escribe el primero.</Empty>
        )}
      </div>
      {enviar ? (
        <>
          {vista && (
            <div className="chat-adjunto">
              <img src={vista} alt="Foto por enviar" />
              <span className="small muted">Foto lista para enviar. Puedes agregar un mensaje.</span>
              <button type="button" className="icon-btn" onClick={quitar} aria-label="Quitar foto" title="Quitar foto">
                <Icon name="x" />
              </button>
            </div>
          )}
          <form className="chat-form" onSubmit={submit}>
            <button type="button" className="icon-btn chat-clip" onClick={() => camara.current?.click()} aria-label="Tomar foto" title="Tomar foto" disabled={busy}>
              <Icon name="camera" />
            </button>
            <button type="button" className="icon-btn chat-clip" onClick={() => galeria.current?.click()} aria-label="Adjuntar imagen" title="Adjuntar imagen" disabled={busy}>
              <Icon name="image" />
            </button>
            <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (elegir(e.target.files?.[0]), (e.target.value = ''))} />
            <input ref={galeria} type="file" accept="image/*" hidden onChange={(e) => (elegir(e.target.files?.[0]), (e.target.value = ''))} />
            <input
              className="input"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={foto ? 'Agrega un mensaje (opcional)…' : placeholder}
              maxLength={2000}
              aria-label="Mensaje"
            />
            <button className="btn-app" disabled={busy || (!texto.trim() && !foto)} aria-label="Enviar">
              <Icon name="arrow" />
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </form>
        </>
      ) : (
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Solo lectura: tu rol no permite responder mensajes.
        </p>
      )}
      {ampliada && (
        <div className="foto-completa" role="dialog" aria-label="Foto" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt="Foto" />
          <button type="button" className="icon-btn" aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
